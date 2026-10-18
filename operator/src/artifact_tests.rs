use super::*;
use std::{
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpListener},
};

pub(super) const CONTROLLER: &str = r#"
import { Controller } from './src/controller.ts';
import { serve } from './src/http.ts';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
await serve(async () => {
const controller = await Controller.open({
  directory: process.env.EITRI_DATA_DIR, policy,
  issues: async () => ['profile-name', 'cart-total'].map(id => ({ ...policy, id, title: id,
    priority: 'high', status: 'unresolved', regressed: false, escalating: false })),
  providerForCase: () => {
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Scripted attention'),
    ]);
    return { provider: faux.provider, modelId: faux.getModel().id };
  },
  check: async (_id, kind) => ({ kind, candidate: 'a'.repeat(40), configuration: 'b'.repeat(64),
    simulated: true, passed: true, outputs: [
      { label: 'Assertions', mime: 'text/plain', bytes: Buffer.from('Simulated assertions passed.\n') },
      { label: 'Screenshot', mime: 'image/png', bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') },
    ] }),
});
const read = controller.artifact.bind(controller);
let first = true;
controller.artifact = async (...ids) => {
  const value = await read(...ids);
  if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 1200)); }
  return value;
};
return controller;
});
"#;
#[test]
fn sse_heartbeats_survive_the_response_header_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let SocketAddr::V4(address) = listener.local_addr().unwrap() else {
        unreachable!()
    };
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = BufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            request.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n").unwrap();
        for _ in 0..5 {
            if stream.write_all(b": heartbeat\n").is_err() {
                break;
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
    let mut reader = SseConnection::open_test(address).unwrap();
    let result = (|| -> Result<usize, ()> {
        for _ in 0..5 {
            assert_eq!(reader.read_line(&|| true)?, ": heartbeat");
        }
        Ok(5)
    })();
    drop(reader);
    server.join().unwrap();
    assert_eq!(result.unwrap(), 5);
}

const PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0,
    5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];
fn metadata(mime: ArtifactMime, bytes: &[u8]) -> Artifact {
    Artifact {
        id: "11111111-1111-4111-8111-111111111111".into(),
        case_id: "22222222-2222-4222-8222-222222222222".into(),
        action_id: "33333333-3333-4333-8333-333333333333".into(),
        check_id: "44444444-4444-4444-8444-444444444444".into(),
        revision: "a".repeat(40),
        configuration: "b".repeat(64),
        simulated: true,
        created_at: 0,
        label: "Assertions".into(),
        mime,
        size: bytes.len(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}
fn selected(a: &Artifact) -> Selected {
    Selected {
        case: Session {
            id: a.case_id.clone(),
            native: "ready".into(),
            ..Session::default()
        },
        messages: vec![],
        more: false,
        artifacts: vec![a.clone()],
        checks: vec![Check {
            id: a.check_id.clone(),
            case_id: a.case_id.clone(),
            action_id: a.action_id.clone(),
            kind: "browser".into(),
            candidate: a.revision.clone(),
            configuration: a.configuration.clone(),
            passed: true,
            simulated: a.simulated,
            artifacts: vec![a.id.clone()],
        }],
    }
}
fn projection(a: &Artifact) -> Snapshot {
    Snapshot {
        protocol: 1,
        boot_id: "boot".into(),
        mode: "scripted".into(),
        cases: vec![],
        selected: Some(selected(a)),
    }
}
fn loading(u: &mut Update, a: &Artifact) -> ArtifactJob {
    let key = ArtifactKey {
        boot_id: "boot".into(),
        generation: 7,
        case_id: a.case_id.clone(),
        artifact_id: a.id.clone(),
    };
    u.artifact_revision += 1;
    u.artifact_view = Some(ArtifactView {
        key: key.clone(),
        artifact: a.clone(),
        state: ArtifactState::Loading,
    });
    ArtifactJob {
        key,
        artifact: a.clone(),
        revision: u.artifact_revision,
    }
}
#[test]
fn artifact_acceptance_rejects_stale_boot_generation_case_expiry_and_disconnect() {
    let a = metadata(ArtifactMime::Text, b"hello\n");
    let selection = Some(a.case_id.clone());
    for mutation in 0..9 {
        let mut u = Update::default();
        u.apply_snapshot(projection(&a), 7, &selection);
        let job = loading(&mut u, &a);
        assert!(u.accepts_artifact(&job));
        match mutation {
            0 => {
                let mut v = projection(&a);
                v.boot_id = "restarted".into();
                u.apply_snapshot(v, 7, &selection);
            }
            1 => u.apply_snapshot(projection(&a), 8, &selection),
            2 => u.apply_snapshot(projection(&a), 7, &Some(uuid::Uuid::new_v4().to_string())),
            3..=5 => {
                let mut v = projection(&a);
                v.selected.as_mut().unwrap().case.native =
                    ["expired", "missing", "deleting"][mutation - 3].into();
                u.apply_snapshot(v, 7, &selection);
            }
            6 => u.disconnect(),
            7 => {
                u.clear_artifact();
                loading(&mut u, &a);
            }
            _ => {
                let mut v = projection(&a);
                v.selected.as_mut().unwrap().artifacts[0].sha256 = "c".repeat(64);
                u.apply_snapshot(v, 7, &selection);
            }
        }
        assert!(
            !u.accepts_artifact(&job),
            "accepted stale response {mutation}"
        );
    }
}
#[test]
fn artifact_provenance_requires_every_check_link() {
    let a = metadata(ArtifactMime::Text, b"hello\n");
    for mutation in 0..10 {
        let mut s = selected(&a);
        assert_eq!(s.linked_artifact(&a.id), Some(&a));
        match mutation {
            0 => s.checks[0].case_id.clear(),
            1 => s.checks[0].action_id.clear(),
            2 => s.checks[0].candidate.clear(),
            3 => s.checks[0].configuration.clear(),
            4 => s.checks[0].simulated = false,
            5 => s.checks[0].artifacts.clear(),
            6 => s.checks.clear(),
            7 => s.artifacts.push(a.clone()),
            8 => s.artifacts[0].id = "../escape".into(),
            _ => s.checks.push(s.checks[0].clone()),
        }
        assert!(
            s.linked_artifact(&a.id).is_none(),
            "accepted incomplete provenance {mutation}"
        );
    }
}
fn response(a: &Artifact, status: &str, headers: &str, body: &[u8]) -> Result<ArtifactState, ()> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let c = Connection {
        protocol: 1,
        boot_id: "boot".into(),
        url: format!("http://{}", listener.local_addr().unwrap()),
        capability: "f".repeat(64),
    };
    let expected = format!("GET /v1/cases/{}/artifacts/{} HTTP/1.1", a.case_id, a.id);
    let wire = format!("HTTP/1.1 {status}\r\nConnection: close\r\n{headers}\r\n").into_bytes();
    let body = body.to_vec();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = String::new();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            request.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        assert!(request.starts_with(&expected));
        assert!(
            request
                .to_lowercase()
                .contains(&format!("authorization: bearer {}\r\n", "f".repeat(64)))
        );
        let _ = stream.write_all(&wire);
        let _ = stream.write_all(&body);
    });
    let result = fetch_artifact(&agent(), &c, a);
    server.join().unwrap();
    result
}
#[test]
fn artifact_http_validates_exact_route_bearer_bytes_hash_status_type_and_length() {
    let bytes = b"hello\n";
    let a = metadata(ArtifactMime::Text, bytes);
    let headers = format!(
        "Content-Type: text/plain\r\nContent-Length: {}\r\n",
        bytes.len()
    );
    assert!(
        matches!(response(&a, "200 OK", &headers, bytes), Ok(ArtifactState::Text(text)) if &*text == "hello\n")
    );
    for (status, headers, body) in [
        ("404 Not Found", headers.clone(), bytes.as_slice()),
        ("410 Gone", headers.clone(), bytes.as_slice()),
        (
            "302 Found",
            format!("{headers}Location: http://127.0.0.1:1/\r\n"),
            bytes.as_slice(),
        ),
        (
            "200 OK",
            headers.replace("text/plain", "text/html"),
            bytes.as_slice(),
        ),
        (
            "200 OK",
            "Content-Type: text/plain\r\nContent-Length: 9999999\r\n".into(),
            bytes.as_slice(),
        ),
        (
            "200 OK",
            "Content-Type: text/plain\r\n".into(),
            bytes.as_slice(),
        ),
        ("200 OK", headers.clone(), b"short".as_slice()),
        ("200 OK", headers.clone(), b"wrong\n".as_slice()),
        (
            "200 OK",
            format!("{headers}Content-Encoding: gzip\r\n"),
            bytes.as_slice(),
        ),
    ] {
        assert!(response(&a, status, &headers, body).is_err());
    }
    let invalid = metadata(ArtifactMime::Text, &[255; 6]);
    assert!(response(&invalid, "200 OK", &headers, &[255; 6]).is_err());
    let png = metadata(ArtifactMime::Png, PNG);
    let headers = format!(
        "Content-Type: image/png\r\nContent-Length: {}\r\n",
        PNG.len()
    );
    assert!(
        matches!(response(&png, "200 OK", &headers, PNG), Ok(ArtifactState::Png(image)) if image.bytes() == PNG)
    );
    let malformed = metadata(ArtifactMime::Png, b"not a png");
    assert!(
        response(
            &malformed,
            "200 OK",
            "Content-Type: image/png\r\nContent-Length: 9\r\n",
            b"not a png"
        )
        .is_err()
    );
    for mime in [ArtifactMime::Text, ArtifactMime::Png] {
        let mut large = metadata(mime, b"x");
        large.size = mime.limit() + 1;
        assert!(selected(&large).linked_artifact(&large.id).is_none());
        let c = Connection {
            protocol: 1,
            boot_id: "boot".into(),
            url: "http://127.0.0.1:1".into(),
            capability: "f".repeat(64),
        };
        assert!(fetch_artifact(&agent(), &c, &large).is_err());
    }
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let redirect = format!(
        "Content-Length: 0\r\nLocation: http://{}/\r\n",
        target.local_addr().unwrap()
    );
    assert!(response(&a, "302 Found", &redirect, b"").is_err());
    assert_eq!(
        target.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
#[test]
fn artifact_body_timeout_does_not_wait_for_connection_close() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let c = Connection {
        protocol: 1,
        boot_id: "boot".into(),
        url: format!("http://{}", listener.local_addr().unwrap()),
        capability: "f".repeat(64),
    };
    let (release, wait) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\n\r\n")
            .unwrap();
        assert!(
            wait.recv_timeout(Duration::from_secs(8)).is_ok(),
            "body timeout did not return while socket was open"
        );
    });
    let result = fetch_artifact(&agent(), &c, &metadata(ArtifactMime::Text, b"hello\n"));
    let _ = release.send(());
    server.join().unwrap();
    assert!(result.is_err());
}
#[gpui::test]
fn native_png_decoder_accepts_exact_png_and_rejects_corrupt_pixel_data(
    cx: &mut gpui::TestAppContext,
) {
    cx.update(|cx| {
        let image = Image::from_bytes(ImageFormat::Png, PNG.to_vec());
        assert!(image.to_image_data(cx.svg_renderer()).is_ok());
        let mut corrupt = PNG.to_vec();
        corrupt[45] ^= 255;
        assert!(png_bounds(&corrupt).is_ok());
        assert!(
            Image::from_bytes(ImageFormat::Png, corrupt)
                .to_image_data(cx.svg_renderer())
                .is_err()
        );
    });
}
#[test]
fn png_rejects_dimensions_malformed_chunks_and_compressed_metadata_before_decode() {
    assert!(png_bounds(PNG).is_ok());
    for (width, height) in [(0u32, 1u32), (4097, 1), (1, 4097), (4096, 4096)] {
        let mut bytes = PNG.to_vec();
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        assert!(png_bounds(&bytes).is_err());
    }
    for kind in [b"zTXt", b"iTXt", b"iCCP", b"tEXt", b"acTL"] {
        let mut bytes = PNG[..33].to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 1]);
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(&[0; 5]);
        bytes.extend_from_slice(&PNG[33..]);
        assert!(png_bounds(&bytes).is_err());
    }
    for bytes in [b"not a png".as_slice(), &PNG[..24], &PNG[..PNG.len() - 1]] {
        assert!(png_bounds(bytes).is_err());
    }
}

pub(super) fn real_artifacts(client: &Client, selected: &Selected, delayed_first_read: bool) {
    assert_eq!(selected.checks.len(), 1);
    assert_eq!(selected.artifacts.len(), 2);
    assert!(client.update.lock().unwrap().artifact_view.is_none());
    if delayed_first_read {
        client.view_artifact(&selected.artifacts[0].id).unwrap();
        let request = client
            .command(
                json!({"type":"post-message", "caseId":selected.case.id,
            "text":"Passive note during artifact loading"}),
                None,
            )
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let u = client.update.lock().unwrap();
            if u.acknowledgments
                .iter()
                .any(|(id, ok)| *id == request && *ok)
            {
                assert!(matches!(
                    u.artifact_view.as_ref().unwrap().state,
                    ArtifactState::Loading
                ));
                break;
            }
            drop(u);
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        client.select(Some(selected.case.id.clone()));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while client.update.lock().unwrap().context.is_none() {
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        thread::sleep(Duration::from_millis(1400));
        let u = client.update.lock().unwrap();
        assert!(
            u.artifact_view.is_none(),
            "late artifact restored cleared bytes"
        );
        let current = &u.context.as_ref().unwrap().selected;
        assert_eq!(current.case.version, selected.case.version);
        assert_eq!(current.case.remaining_ms, selected.case.remaining_ms);
        assert_eq!(current.checks, selected.checks);
    }
    for a in &selected.artifacts {
        assert_eq!(selected.linked_artifact(&a.id), Some(a));
        client.view_artifact(&a.id).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let u = client.update.lock().unwrap();
            let view = u.artifact_view.as_ref().unwrap();
            if !matches!(view.state, ArtifactState::Loading) {
                match &view.state {
                    ArtifactState::Text(text) => {
                        assert_eq!(&**text, "Simulated assertions passed.\n")
                    }
                    ArtifactState::Png(image) => assert_eq!(image.bytes(), PNG),
                    _ => panic!("real artifact unavailable"),
                }
                break;
            }
            drop(u);
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
    }
    if delayed_first_read {
        let revision = client.update.lock().unwrap().artifact_revision;
        thread::sleep(Duration::from_secs(4));
        let u = client.update.lock().unwrap();
        assert_eq!(u.status, "Connected · scripted");
        assert_eq!(
            u.artifact_revision, revision,
            "healthy SSE invalidated cached bytes"
        );
        assert_eq!(
            u.context.as_ref().unwrap().selected.case.id,
            selected.case.id
        );
        assert!(
            matches!(&u.artifact_view.as_ref().unwrap().state, ArtifactState::Png(image) if image.bytes() == PNG)
        );
    }
    client.select(Some(selected.case.id.clone()));
    assert!(client.update.lock().unwrap().artifact_view.is_none());
}

fn sse_frame(sequence: u64, late: bool) -> Value {
    json!({
        "protocol": 1, "bootId": "boot", "sequence": sequence,
        "snapshot": { "protocol": 1, "bootId": "boot", "mode": "scripted",
            "cases": if late { vec![json!({"id":"late", "phase":"", "status":"", "version":0,
                "remainingMs":0, "reason":"", "warning":null, "native":"", "issue":{}})] } else { vec![] },
            "selected": null }
    })
}
fn sse_server(frames: Vec<Value>) -> (SseConnection, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let SocketAddr::V4(address) = listener.local_addr().unwrap() else {
        unreachable!()
    };
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = BufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            assert_ne!(request.read_line(&mut line).unwrap(), 0);
            if line == "\r\n" {
                break;
            }
        }
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n")
            .unwrap();
        for frame in frames {
            if writeln!(stream, "data: {frame}").is_err() {
                break;
            }
        }
    });
    (SseConnection::open_test(address).unwrap(), server)
}
fn sse_connection() -> Connection {
    Connection {
        protocol: 1,
        boot_id: "boot".into(),
        url: "http://127.0.0.1:43127".into(),
        capability: "f".repeat(64),
    }
}

#[test]
fn sse_frames_reject_protocol_boot_snapshot_and_sequence_changes_before_applying() {
    for mutation in 0..7 {
        let mut frame = sse_frame(1, true);
        match mutation {
            0 => frame["protocol"] = json!(2),
            1 => frame["bootId"] = json!("restarted"),
            2 => frame["snapshot"]["protocol"] = json!(2),
            3 => frame["snapshot"]["bootId"] = json!("restarted"),
            4 => frame["snapshot"]["mode"] = json!("live"),
            5 => frame["sequence"] = json!(0),
            _ => (),
        }
        let frames = if mutation == 6 {
            vec![sse_frame(1, false), frame]
        } else {
            vec![frame]
        };
        let (mut stream, server) = sse_server(frames);
        let update = Mutex::new(Update::default());
        assert_eq!(
            receive_events(
                &mut stream,
                &sse_connection(),
                7,
                &Mutex::new(None),
                &AtomicU64::new(7),
                &AtomicBool::new(false),
                &update
            ),
            Err(())
        );
        let u = update.lock().unwrap();
        if mutation == 6 {
            assert_eq!(u.status, "Connected · scripted");
            assert!(
                u.snapshot.as_ref().unwrap().cases.is_empty(),
                "duplicate sequence applied"
            );
        } else {
            assert!(u.snapshot.is_none(), "invalid frame {mutation} applied");
        }
        server.join().unwrap();
    }
}

#[test]
fn sse_generation_and_stop_checks_prevent_buffered_late_frames_from_applying() {
    for stop in [false, true] {
        let (mut stream, server) = sse_server(vec![sse_frame(1, true)]);
        let a = metadata(ArtifactMime::Text, b"hello\n");
        let selection = Arc::new(Mutex::new(Some(a.case_id.clone())));
        let update = Arc::new(Mutex::new(Update::default()));
        let generation = Arc::new(AtomicU64::new(7));
        let stopped = Arc::new(AtomicBool::new(false));
        let mut u = update.lock().unwrap();
        u.apply_snapshot(projection(&a), 7, &Some(a.case_id.clone()));
        let job = loading(&mut u, &a);
        let worker = {
            let (update, selection, generation, stopped) = (
                update.clone(),
                selection.clone(),
                generation.clone(),
                stopped.clone(),
            );
            thread::spawn(move || {
                receive_events(
                    &mut stream,
                    &sse_connection(),
                    7,
                    &selection,
                    &generation,
                    &stopped,
                    &update,
                )
            })
        };
        thread::sleep(Duration::from_millis(50));
        if stop {
            stopped.store(true, Ordering::Relaxed);
        } else {
            generation.store(8, Ordering::Relaxed);
        }
        drop(u);
        assert_eq!(worker.join().unwrap(), Ok(()));
        let u = update.lock().unwrap();
        assert!(u.snapshot.as_ref().unwrap().cases.is_empty());
        assert_eq!(u.context.as_ref().unwrap().selected.case.id, a.case_id);
        assert!(
            u.accepts_artifact(&job),
            "late frame changed artifact context"
        );
        server.join().unwrap();
    }
}
