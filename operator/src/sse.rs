use std::{
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpStream},
    time::{Duration, Instant},
};

const HEADER_BYTES: usize = 16 * 1024;
const HEADER_LINES: usize = 128;
const PAYLOAD_BYTES: usize = 512_000;
const WIRE_LINE_BYTES: usize = PAYLOAD_BYTES + 8;
const HEADER_TIMEOUT: Duration = Duration::from_secs(3);
const LINE_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) struct SseConnection {
    reader: BufReader<TcpStream>,
    line_timeout: Duration,
}

impl SseConnection {
    pub(super) fn open(
        capability: &str,
        selected: Option<&str>,
        active: &impl Fn() -> bool,
    ) -> Result<Self, ()> {
        Self::connect(
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, 43127),
            capability,
            selected,
            HEADER_TIMEOUT,
            LINE_TIMEOUT,
            active,
        )
    }

    fn connect(
        address: SocketAddrV4,
        capability: &str,
        selected: Option<&str>,
        header_timeout: Duration,
        line_timeout: Duration,
        active: &impl Fn() -> bool,
    ) -> Result<Self, ()> {
        if *address.ip() != Ipv4Addr::LOCALHOST
            || capability.len() != 64
            || !capability.bytes().all(|b| b.is_ascii_hexdigit())
            || selected.is_some_and(|id| !super::route_id(id))
            || !active()
        {
            return Err(());
        }
        let mut stream =
            TcpStream::connect_timeout(&address.into(), CONNECT_TIMEOUT).map_err(|_| ())?;
        let route = selected
            .map(|id| format!("/v1/events?selected={id}"))
            .unwrap_or_else(|| "/v1/events".into());
        // HTTP/1.0 selects EOF framing even if Node replies HTTP/1.1 with keep-alive.
        let request = format!(
            "GET {route} HTTP/1.0\r\nHost: {address}\r\nAuthorization: Bearer {capability}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n"
        );
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let mut remaining = request.as_bytes();
        while !remaining.is_empty() {
            if !active() {
                return Err(());
            }
            stream
                .set_write_timeout(Some(time_left(deadline)?))
                .map_err(|_| ())?;
            let written = stream.write(remaining).map_err(|_| ())?;
            if written == 0 {
                return Err(());
            }
            remaining = &remaining[written..];
        }
        time_left(deadline)?;
        let mut connection = Self {
            reader: BufReader::new(stream),
            line_timeout,
        };
        connection.headers(Instant::now() + header_timeout, active)?;
        Ok(connection)
    }

    fn headers(&mut self, deadline: Instant, active: &impl Fn() -> bool) -> Result<(), ()> {
        let mut remaining = HEADER_BYTES;
        let mut content_type = false;
        for index in 0..HEADER_LINES {
            let line = self.wire_line(deadline, remaining, active)?;
            remaining -= line.len();
            let line = line.strip_suffix(b"\r\n").ok_or(())?;
            if index == 0 {
                let reason = line
                    .strip_prefix(b"HTTP/1.1 200 ")
                    .or_else(|| line.strip_prefix(b"HTTP/1.0 200 "))
                    .ok_or(())?;
                if !reason.iter().all(|b| (32..=126).contains(b)) {
                    return Err(());
                }
            } else if line.is_empty() {
                return content_type.then_some(()).ok_or(());
            } else {
                let colon = line.iter().position(|b| *b == b':').ok_or(())?;
                let name = &line[..colon];
                let value = &line[colon + 1..];
                if name.is_empty()
                    || !name
                        .iter()
                        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(b))
                    || !value.iter().all(|b| *b == b'\t' || (32..=126).contains(b))
                {
                    return Err(());
                }
                if [
                    b"content-length".as_slice(),
                    b"transfer-encoding",
                    b"content-encoding",
                ]
                .iter()
                .any(|critical| name.eq_ignore_ascii_case(critical))
                {
                    return Err(());
                }
                if name.eq_ignore_ascii_case(b"content-type") {
                    let value = value.trim_ascii();
                    if content_type || value != b"text/event-stream" {
                        return Err(());
                    }
                    content_type = true;
                }
            }
        }
        Err(())
    }

    pub(super) fn read_line(&mut self, active: &impl Fn() -> bool) -> Result<String, ()> {
        // A stalled read delays cancellation by at most this line's 15-second deadline.
        let line = self.wire_line(Instant::now() + self.line_timeout, WIRE_LINE_BYTES, active)?;
        let line = line.strip_suffix(b"\n").ok_or(())?;
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line
            .strip_prefix(b"data: ")
            .is_some_and(|data| data.len() > PAYLOAD_BYTES)
        {
            return Err(());
        }
        String::from_utf8(line.to_vec()).map_err(|_| ())
    }

    fn wire_line(
        &mut self,
        deadline: Instant,
        limit: usize,
        active: &impl Fn() -> bool,
    ) -> Result<Vec<u8>, ()> {
        let mut line = Vec::new();
        loop {
            if !active() {
                return Err(());
            }
            self.reader
                .get_ref()
                .set_read_timeout(Some(time_left(deadline)?))
                .map_err(|_| ())?;
            let buffered = self.reader.fill_buf().map_err(|_| ())?;
            time_left(deadline)?;
            if !active() || buffered.is_empty() {
                return Err(());
            }
            let newline = buffered.iter().position(|b| *b == b'\n');
            let count = newline.map_or(buffered.len(), |index| index + 1);
            if count > limit - line.len() {
                return Err(());
            }
            line.extend_from_slice(&buffered[..count]);
            self.reader.consume(count);
            if newline.is_some() {
                return Ok(line);
            }
            if line.len() == limit {
                return Err(());
            }
        }
    }

    #[cfg(test)]
    pub(super) fn open_test(address: SocketAddrV4) -> Result<Self, ()> {
        Self::connect(
            address,
            &"f".repeat(64),
            None,
            HEADER_TIMEOUT,
            LINE_TIMEOUT,
            &|| true,
        )
    }
}

fn time_left(deadline: Instant) -> Result<Duration, ()> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
        .ok_or(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        net::{SocketAddr, TcpListener},
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        thread::{self, JoinHandle},
    };

    const HEADERS: &[u8] =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n";
    const SHORT: Duration = Duration::from_millis(150);

    fn serve(
        handler: impl FnOnce(TcpStream, String) + Send + 'static,
    ) -> (SocketAddrV4, JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let SocketAddr::V4(address) = listener.local_addr().unwrap() else {
            unreachable!()
        };
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            loop {
                let mut line = String::new();
                assert_ne!(reader.read_line(&mut line).unwrap(), 0);
                request.push_str(&line);
                assert!(request.len() < 1024);
                if line == "\r\n" {
                    break;
                }
            }
            assert!(request.contains(&format!("\r\nHost: {address}\r\n")));
            assert!(request.contains(&format!("\r\nAuthorization: Bearer {}\r\n", "f".repeat(64))));
            handler(stream, request);
        });
        (address, server)
    }

    fn open(address: SocketAddrV4) -> Result<SseConnection, ()> {
        SseConnection::connect(address, &"f".repeat(64), None, SHORT, SHORT, &|| true)
    }

    #[test]
    fn healthy_heartbeats_outlive_both_production_deadlines_on_one_connection() {
        let (address, server) = serve(|mut stream, request| {
            assert!(request.starts_with("GET /v1/events HTTP/1.0\r\n"));
            stream.write_all(HEADERS).unwrap();
            for _ in 0..17 {
                stream.write_all(b": heartbeat\r\n").unwrap();
                thread::sleep(Duration::from_secs(1));
            }
        });
        let mut connection = SseConnection::open_test(address).unwrap();
        let started = Instant::now();
        for _ in 0..17 {
            assert_eq!(connection.read_line(&|| true), Ok(": heartbeat".into()));
        }
        assert!(started.elapsed() > Duration::from_secs(15));
        drop(connection);
        server.join().unwrap();
    }

    #[test]
    fn header_stall_byte_trickle_and_complete_header_lines_share_one_deadline() {
        for mode in 0..3 {
            let (release, wait) = mpsc::channel();
            let (address, server) = serve(move |mut stream, _| {
                if mode == 1 {
                    for byte in HEADERS {
                        if stream.write_all(&[*byte]).is_err() {
                            break;
                        }
                        if wait.recv_timeout(Duration::from_millis(30)).is_ok() {
                            return;
                        }
                    }
                } else if mode == 2 {
                    stream.write_all(b"HTTP/1.1 200 OK\r\n").unwrap();
                    for _ in 0..10 {
                        if stream.write_all(b"X-Test: complete\r\n").is_err() {
                            break;
                        }
                        if wait.recv_timeout(Duration::from_millis(40)).is_ok() {
                            return;
                        }
                    }
                } else {
                    wait.recv_timeout(Duration::from_secs(2)).unwrap();
                }
            });
            let started = Instant::now();
            assert!(open(address).is_err());
            let elapsed = started.elapsed();
            let _ = release.send(());
            server.join().unwrap();
            assert!(elapsed >= Duration::from_millis(100), "{mode}: {elapsed:?}");
            assert!(elapsed < SHORT * 2, "{mode}: {elapsed:?}");
        }
    }

    #[test]
    fn partial_body_line_trickle_cannot_restart_the_deadline() {
        let (release, wait) = mpsc::channel();
        let (address, server) = serve(move |mut stream, _| {
            stream.write_all(HEADERS).unwrap();
            for byte in b"data: incomplete and never terminated" {
                if stream.write_all(&[*byte]).is_err() {
                    break;
                }
                if wait.recv_timeout(Duration::from_millis(30)).is_ok() {
                    return;
                }
            }
        });
        let mut connection = open(address).unwrap();
        let started = Instant::now();
        assert_eq!(connection.read_line(&|| true), Err(()));
        let elapsed = started.elapsed();
        let _ = release.send(());
        server.join().unwrap();
        assert!(elapsed >= Duration::from_millis(100));
        assert!(elapsed < Duration::from_secs(1));
    }

    #[test]
    fn expired_deadline_and_cancellation_reject_already_buffered_lines() {
        let (address, server) = serve(|mut stream, _| {
            let mut wire = HEADERS.to_vec();
            wire.extend_from_slice(b": first\n: buffered\n");
            stream.write_all(&wire).unwrap();
        });
        let mut connection = open(address).unwrap();
        assert_eq!(connection.read_line(&|| true), Ok(": first".into()));
        assert_eq!(connection.reader.fill_buf().unwrap(), b": buffered\n");
        assert_eq!(
            connection.wire_line(Instant::now() - Duration::from_millis(1), 100, &|| true),
            Err(())
        );
        assert_eq!(connection.read_line(&|| false), Err(()));
        assert_eq!(connection.reader.buffer(), b": buffered\n");
        server.join().unwrap();
    }

    #[test]
    fn stalled_line_cancellation_finishes_within_the_line_deadline() {
        let active = Arc::new(AtomicBool::new(true));
        let cancel = active.clone();
        let (release, wait) = mpsc::channel();
        let (address, server) = serve(move |mut stream, _| {
            stream.write_all(HEADERS).unwrap();
            thread::sleep(Duration::from_millis(40));
            cancel.store(false, Ordering::Relaxed);
            wait.recv_timeout(Duration::from_secs(2)).unwrap();
        });
        let mut connection = open(address).unwrap();
        let started = Instant::now();
        assert_eq!(
            connection.read_line(&|| active.load(Ordering::Relaxed)),
            Err(())
        );
        let elapsed = started.elapsed();
        let _ = release.send(());
        server.join().unwrap();
        assert!(elapsed < Duration::from_secs(1));
        assert!(!active.load(Ordering::Relaxed));
    }

    #[test]
    fn payload_limit_counts_json_bytes_not_data_prefix_or_crlf() {
        for ending in ["\n", "\r\n"] {
            for size in [512_000, 512_001] {
                let wire = format!("data: \"{}\"{ending}", "x".repeat(size - 2));
                let (address, server) = serve(move |mut stream, _| {
                    stream.write_all(HEADERS).unwrap();
                    let _ = stream.write_all(wire.as_bytes());
                });
                let result = open(address).unwrap().read_line(&|| true);
                if size == 512_000 {
                    let line = result.unwrap();
                    let value: String =
                        serde_json::from_str(line.strip_prefix("data: ").unwrap()).unwrap();
                    assert_eq!(value.len(), 511_998);
                } else {
                    assert_eq!(result, Err(()));
                }
                server.join().unwrap();
            }
        }
    }

    #[test]
    fn malformed_status_headers_framing_and_encoding_are_rejected() {
        for wire in [
            "HTTP/1.1 2000 OK\r\nContent-Type: text/event-stream\r\n\r\n",
            "HTTP/2 200 OK\r\nContent-Type: text/event-stream\r\n\r\n",
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\n\r\n",
            "HTTP/1.1 100 Continue\r\n\r\n",
            "HTTP/1.1 200 OK\nContent-Type: text/event-stream\n\n",
            "HTTP/1.1 200 OK\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\ncontent-type: text/event-stream\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Encoding: gzip\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Encoding:\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n folded\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type : text/event-stream\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Test: \0\r\n\r\n",
        ] {
            let (address, server) = serve(move |mut stream, _| {
                let _ = stream.write_all(wire.as_bytes());
            });
            assert!(open(address).is_err(), "accepted {wire:?}");
            server.join().unwrap();
        }
    }

    #[test]
    fn header_bytes_and_line_count_are_bounded() {
        for headers in [
            format!("X-Test: {}\r\n", "x".repeat(16_384)),
            "X-Test: x\r\n".repeat(128),
        ] {
            let (address, server) = serve(move |mut stream, _| {
                let wire =
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n{headers}\r\n");
                let _ = stream.write_all(wire.as_bytes());
            });
            assert!(open(address).is_err());
            server.join().unwrap();
        }
    }

    #[test]
    fn exact_header_byte_and_line_limits_and_http10_status_are_accepted() {
        for size in [16_384, 16_385] {
            let prefix = "HTTP/1.0 200 OK\r\nCONTENT-TYPE:\ttext/event-stream \r\nX-Test: ";
            let wire = format!("{prefix}{}\r\n\r\n", "x".repeat(size - prefix.len() - 4));
            let (address, server) = serve(move |mut stream, _| {
                let _ = stream.write_all(wire.as_bytes());
            });
            assert_eq!(open(address).is_ok(), size == 16_384);
            server.join().unwrap();
        }
        for count in [125, 126] {
            let wire = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n{}\r\n",
                "X-Test: x\r\n".repeat(count)
            );
            let (address, server) = serve(move |mut stream, _| {
                let _ = stream.write_all(wire.as_bytes());
            });
            assert_eq!(open(address).is_ok(), count == 125);
            server.join().unwrap();
        }
    }

    #[test]
    fn request_route_bearer_and_numeric_loopback_host_are_validated() {
        let id = "11111111-1111-4111-8111-111111111111";
        let (address, server) = serve(move |mut stream, request| {
            assert_eq!(
                request.lines().next().unwrap(),
                format!("GET /v1/events?selected={id} HTTP/1.0")
            );
            stream.write_all(HEADERS).unwrap();
        });
        assert!(
            SseConnection::connect(address, &"f".repeat(64), Some(id), SHORT, SHORT, &|| true)
                .is_ok()
        );
        server.join().unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let SocketAddr::V4(address) = listener.local_addr().unwrap() else {
            unreachable!()
        };
        for (capability, selected) in [
            ("f".repeat(63), None),
            (format!("{}\r\n", "f".repeat(62)), None),
            ("f".repeat(64), Some("../escape")),
            (
                "f".repeat(64),
                Some("11111111-1111-4111-8111-11111111\r\nX: x"),
            ),
        ] {
            assert!(
                SseConnection::connect(address, &capability, selected, SHORT, SHORT, &|| true)
                    .is_err()
            );
        }
        assert!(
            SseConnection::connect(
                SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 2), address.port()),
                &"f".repeat(64),
                None,
                SHORT,
                SHORT,
                &|| true
            )
            .is_err()
        );
        assert!(
            SseConnection::connect(address, &"f".repeat(64), None, SHORT, SHORT, &|| false)
                .is_err()
        );
        listener.set_nonblocking(true).unwrap();
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn eof_partial_lines_invalid_utf8_and_overlong_wire_lines_are_rejected() {
        for body in [b"data: {".to_vec(), vec![255, b'\n'], vec![b'x'; 512_009]] {
            let (address, server) = serve(move |mut stream, _| {
                stream.write_all(HEADERS).unwrap();
                let _ = stream.write_all(&body);
            });
            assert_eq!(open(address).unwrap().read_line(&|| true), Err(()));
            server.join().unwrap();
        }
    }
}
