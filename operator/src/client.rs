use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub phase: String,
    pub status: String,
    pub version: u64,
    pub remaining_ms: u64,
    pub reason: String,
    pub native: String,
    pub issue: Value,
}
#[derive(Clone, Deserialize)]
pub struct Message {
    pub id: String,
    pub kind: String,
    pub data: Value,
}
#[derive(Clone, Deserialize)]
pub struct Selected {
    pub case: Session,
    pub messages: Vec<Message>,
    pub more: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub protocol: u64,
    pub boot_id: String,
    pub mode: String,
    pub cases: Vec<Session>,
    pub selected: Option<Selected>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    protocol: u64,
    boot_id: String,
    sequence: u64,
    snapshot: Snapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    protocol: u64,
    boot_id: String,
    url: String,
    capability: String,
}
#[derive(Default)]
pub struct Update {
    pub snapshot: Option<Snapshot>,
    pub status: String,
    pub acknowledgments: Vec<(String, bool)>,
}
enum Job {
    Refresh(u64),
    Command(Value),
}
pub struct Client {
    jobs: mpsc::SyncSender<Job>,
    pub update: Arc<Mutex<Update>>,
    selection: Arc<Mutex<Option<String>>>,
    generation: Arc<AtomicU64>,
    stopped: Arc<AtomicBool>,
}
fn connection(path: &PathBuf) -> Result<Connection, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o077 != 0 || metadata.len() > 4096 {
        return Err(());
    }
    let c: Connection = serde_json::from_slice(&fs::read(path).map_err(|_| ())?).map_err(|_| ())?;
    if c.protocol != 1
        || c.url != "http://127.0.0.1:43127"
        || c.capability.len() != 64
        || !c.capability.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(());
    }
    Ok(c)
}
fn agent(stream: bool) -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .proxy(None)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(2)))
        .timeout_recv_response(Some(Duration::from_secs(3)))
        .timeout_recv_body(Some(Duration::from_secs(if stream { 15 } else { 3 })))
        .build()
        .into()
}
fn valid(snapshot: &Snapshot, c: &Connection) -> bool {
    snapshot.protocol == 1 && snapshot.boot_id == c.boot_id && snapshot.mode == "scripted"
}
fn selected_path(selection: &Arc<Mutex<Option<String>>>, route: &str) -> String {
    let selected = selection.lock().unwrap();
    selected
        .as_ref()
        .map(|id| format!("{route}?selected={id}"))
        .unwrap_or_else(|| route.to_owned())
}
impl Client {
    pub fn new(path: PathBuf) -> Self {
        let (send, receive) = mpsc::sync_channel(32);
        let update = Arc::new(Mutex::new(Update::default()));
        let selection = Arc::new(Mutex::new(None));
        let generation = Arc::new(AtomicU64::new(1));
        let stopped = Arc::new(AtomicBool::new(false));
        {
            let (path, update, selection, generation, stopped) = (
                path.clone(),
                update.clone(),
                selection.clone(),
                generation.clone(),
                stopped.clone(),
            );
            thread::spawn(move || {
                let agent = agent(false);
                while let Ok(job) = receive.recv() {
                    if stopped.load(Ordering::Relaxed) {
                        break;
                    }
                    match job {
                        Job::Refresh(g) => {
                            let result = (|| {
                                let c = connection(&path)?;
                                let url = format!(
                                    "{}{}",
                                    c.url,
                                    selected_path(&selection, "/v1/snapshot")
                                );
                                let mut r = agent
                                    .get(url)
                                    .header("authorization", format!("Bearer {}", c.capability))
                                    .call()
                                    .map_err(|_| ())?;
                                if r.status() != 200 {
                                    return Err(());
                                }
                                let body = r
                                    .body_mut()
                                    .with_config()
                                    .limit(512000)
                                    .read_to_string()
                                    .map_err(|_| ())?;
                                let view: Snapshot = serde_json::from_str(&body).map_err(|_| ())?;
                                if !valid(&view, &c) {
                                    return Err(());
                                }
                                Ok(view)
                            })();
                            if generation.load(Ordering::Relaxed) == g {
                                let mut u = update.lock().unwrap();
                                match result {
                                    Ok(view) => {
                                        u.snapshot = Some(view);
                                        u.status = "Connected · scripted".into();
                                    }
                                    Err(_) => u.status = "Disconnected · retrying".into(),
                                }
                            }
                        }
                        Job::Command(body) => {
                            let id = body["requestId"].as_str().unwrap_or_default().to_owned();
                            let mut result = false;
                            for _ in 0..3 {
                                let Ok(c) = connection(&path) else {
                                    thread::sleep(Duration::from_millis(200));
                                    continue;
                                };
                                let response = agent
                                    .post(format!("{}/v1/commands", c.url))
                                    .header("authorization", format!("Bearer {}", c.capability))
                                    .header("content-type", "application/json")
                                    .send(body.to_string().as_bytes());
                                if let Ok(mut response) = response {
                                    if response.status() == 200 {
                                        if let Ok(text) = response
                                            .body_mut()
                                            .with_config()
                                            .limit(4096)
                                            .read_to_string()
                                        {
                                            if let Ok(receipt) =
                                                serde_json::from_str::<Value>(&text)
                                            {
                                                result = receipt["requestId"] == id;
                                            }
                                        }
                                    }
                                    break;
                                }
                            }
                            let mut u = update.lock().unwrap();
                            u.acknowledgments.push((id, result));
                            if !result {
                                u.status =
                                    "Command not confirmed · draft retained; refresh before retry"
                                        .into();
                            }
                        }
                    }
                }
            });
        }
        {
            let (update, selection, generation, stopped) = (
                update.clone(),
                selection.clone(),
                generation.clone(),
                stopped.clone(),
            );
            thread::spawn(move || {
                let agent = agent(true);
                while !stopped.load(Ordering::Relaxed) {
                    let g = generation.load(Ordering::Relaxed);
                    let result = (|| {
                        let c = connection(&path)?;
                        let url = format!("{}{}", c.url, selected_path(&selection, "/v1/events"));
                        let response = agent
                            .get(url)
                            .header("authorization", format!("Bearer {}", c.capability))
                            .call()
                            .map_err(|_| ())?;
                        if response.status() != 200 {
                            return Err(());
                        }
                        let mut reader = BufReader::new(response.into_body().into_reader());
                        let mut sequence = 0;
                        loop {
                            if stopped.load(Ordering::Relaxed)
                                || generation.load(Ordering::Relaxed) != g
                            {
                                return Ok(());
                            }
                            let mut line = String::new();
                            let n = (&mut reader)
                                .take(512001)
                                .read_line(&mut line)
                                .map_err(|_| ())?;
                            if n == 0 || n > 512000 {
                                return Err(());
                            }
                            if let Some(data) = line.strip_prefix("data: ") {
                                let frame: Frame = serde_json::from_str(data).map_err(|_| ())?;
                                if frame.protocol != 1
                                    || frame.boot_id != c.boot_id
                                    || frame.sequence <= sequence
                                    || !valid(&frame.snapshot, &c)
                                {
                                    return Err(());
                                }
                                sequence = frame.sequence;
                                if generation.load(Ordering::Relaxed) == g {
                                    let mut u = update.lock().unwrap();
                                    u.snapshot = Some(frame.snapshot);
                                    u.status = "Connected · scripted".into();
                                }
                            }
                        }
                    })();
                    if result.is_err() {
                        update.lock().unwrap().status = "Disconnected · retrying".into();
                        thread::sleep(Duration::from_millis(500));
                    }
                }
            });
        }
        Self {
            jobs: send,
            update,
            selection,
            generation,
            stopped,
        }
    }
    pub fn select(&self, id: Option<String>) {
        *self.selection.lock().unwrap() = id;
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.jobs.try_send(Job::Refresh(generation));
    }
    pub fn command(&self, intent: Value, version: Option<u64>) -> Result<String, ()> {
        let id = uuid::Uuid::new_v4().to_string();
        let mut body = json!({ "requestId": id, "intent": intent });
        if let Some(v) = version {
            body["expectedControlVersion"] = json!(v);
        }
        self.jobs.try_send(Job::Command(body)).map_err(|_| ())?;
        Ok(id)
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::{
        process::{Child, Command, Stdio},
        time::Instant,
    };
    struct Running {
        child: Child,
        directory: PathBuf,
    }
    impl Drop for Running {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
    fn snapshot(client: &Client, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if let Some(view) = client.update.lock().unwrap().snapshot.as_ref() {
                if predicate(view) {
                    return view.clone();
                }
            }
            assert!(
                Instant::now() < deadline,
                "Timed out waiting for controller projection"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn real_http_sse_notes_reconnection_and_expired_history() {
        let directory =
            std::env::temp_dir().join(format!("eitri-native-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let directory = fs::canonicalize(directory).unwrap();
        let child = Command::new("node")
            .arg("src/main.ts")
            .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap())
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap())
            .env("HOME", std::env::var_os("HOME").unwrap())
            .env("EITRI_DATA_DIR", &directory)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let running = Running {
            child,
            directory: directory.clone(),
        };
        let client = Client::new(directory.join("connection.json"));
        snapshot(&client, |v| v.cases.is_empty());
        client.command(json!({"type":"check-now"}), None).unwrap();
        let view = snapshot(&client, |v| {
            v.cases.len() == 2 && v.cases.iter().all(|c| c.status == "needs-attention")
        });
        let case = view.cases[0].clone();
        client.select(Some(case.id.clone()));
        snapshot(&client, |v| {
            v.selected.as_ref().is_some_and(|s| s.case.id == case.id)
        });
        let text = "Native client note 🔨\nSecond line";
        let request_id = client
            .command(
                json!({"type":"post-message","caseId":case.id,"text":text}),
                None,
            )
            .unwrap();
        snapshot(&client, |v| {
            v.selected
                .as_ref()
                .is_some_and(|s| s.messages.iter().any(|m| m.data["text"] == text))
        });
        assert!(
            client
                .update
                .lock()
                .unwrap()
                .acknowledgments
                .iter()
                .any(|(id, ok)| id == &request_id && *ok)
        );
        drop(client);
        let reopened = Client::new(directory.join("connection.json"));
        reopened.select(Some(case.id.clone()));
        let view = snapshot(&reopened, |v| {
            v.selected.as_ref().is_some_and(|s| s.case.id == case.id)
        });
        assert_eq!(
            view.selected.as_ref().unwrap().case.remaining_ms,
            case.remaining_ms
        );
        assert_eq!(view.selected.as_ref().unwrap().case.version, case.version);
        reopened
            .command(
                json!({"type":"dismiss","caseId":case.id,"note":"Native cleanup exercise"}),
                Some(case.version),
            )
            .unwrap();
        let view = snapshot(&reopened, |v| {
            v.selected
                .as_ref()
                .is_some_and(|s| s.case.status == "terminal")
        });
        let version = view.selected.unwrap().case.version;
        reopened
            .command(
                json!({"type":"details-cleanup","caseId":case.id,"confirmed":true}),
                Some(version),
            )
            .unwrap();
        let view = snapshot(&reopened, |v| {
            v.selected
                .as_ref()
                .is_some_and(|s| s.case.native == "expired")
        });
        assert!(view.selected.unwrap().messages.is_empty());
        drop(reopened);
        drop(running);
    }
}
