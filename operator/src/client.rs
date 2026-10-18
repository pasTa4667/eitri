#[path = "sse.rs"]
mod sse;

use gpui::{Image, ImageFormat};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sse::SseConnection;
use std::{
    fs,
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
    pub warning: Option<String>,
    pub native: String,
    pub issue: Value,
}
#[derive(Clone, Deserialize)]
pub struct Message {
    pub id: String,
    pub kind: String,
    pub data: Value,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub case_id: String,
    pub action_id: String,
    pub kind: String,
    pub candidate: String,
    pub configuration: String,
    pub passed: bool,
    pub simulated: bool,
    pub artifacts: Vec<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum ArtifactMime {
    #[serde(rename = "text/plain")]
    Text,
    #[serde(rename = "image/png")]
    Png,
}
impl ArtifactMime {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text/plain",
            Self::Png => "image/png",
        }
    }
    fn limit(self) -> usize {
        match self {
            Self::Text => 256 * 1024,
            Self::Png => 4 * 1024 * 1024,
        }
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub case_id: String,
    pub action_id: String,
    pub check_id: String,
    pub revision: String,
    pub configuration: String,
    pub simulated: bool,
    pub created_at: u64,
    pub label: String,
    pub mime: ArtifactMime,
    pub size: usize,
    pub sha256: String,
}
#[derive(Clone, Deserialize)]
pub struct Selected {
    pub case: Session,
    pub messages: Vec<Message>,
    pub more: bool,
    pub checks: Vec<Check>,
    pub artifacts: Vec<Artifact>,
}
fn route_id(id: &str) -> bool {
    id.len() == 36 && uuid::Uuid::parse_str(id).is_ok()
}
fn hex(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Selected {
    pub fn linked_artifact(&self, id: &str) -> Option<&Artifact> {
        if self.case.native != "ready" || self.checks.len() > 256 || self.artifacts.len() > 128 {
            return None;
        }
        let mut artifacts = self.artifacts.iter().filter(|a| a.id == id);
        let a = artifacts.next()?;
        if artifacts.next().is_some()
            || a.case_id != self.case.id
            || ![&a.id, &a.case_id, &a.action_id, &a.check_id]
                .into_iter()
                .all(|id| route_id(id))
            || !hex(&a.revision, 40, 64)
            || !hex(&a.configuration, 64, 64)
            || !hex(&a.sha256, 64, 64)
            || a.size == 0
            || a.size > a.mime.limit()
            || a.label.is_empty()
            || a.label.len() > 128
            || a.label.chars().any(char::is_control)
        {
            return None;
        }
        let mut checks = self.checks.iter().filter(|c| c.id == a.check_id);
        let c = checks.next()?;
        (checks.next().is_none()
            && c.case_id == a.case_id
            && c.action_id == a.action_id
            && c.candidate == a.revision
            && c.configuration == a.configuration
            && c.simulated == a.simulated
            && c.artifacts.iter().filter(|id| **id == a.id).count() == 1)
            .then_some(a)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactKey {
    pub boot_id: String,
    pub generation: u64,
    pub case_id: String,
    pub artifact_id: String,
}
#[derive(Clone)]
pub enum ArtifactState {
    Loading,
    Text(Arc<str>),
    Png(Arc<Image>),
    Unavailable,
}
#[derive(Clone)]
pub struct ArtifactView {
    pub key: ArtifactKey,
    pub artifact: Artifact,
    pub state: ArtifactState,
}
struct ArtifactJob {
    key: ArtifactKey,
    artifact: Artifact,
    revision: u64,
}
struct ArtifactContext {
    boot_id: String,
    generation: u64,
    selected: Selected,
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
    pub artifact_view: Option<ArtifactView>,
    pub artifact_revision: u64,
    context: Option<ArtifactContext>,
}
impl Update {
    fn clear_artifact(&mut self) {
        self.artifact_view = None;
        self.artifact_revision += 1;
    }
    fn disconnect(&mut self) {
        self.context = None;
        self.clear_artifact();
        self.status = "Disconnected · retrying".into();
    }
    fn apply_snapshot(&mut self, view: Snapshot, generation: u64, selected: &Option<String>) {
        self.context = view
            .selected
            .as_ref()
            .filter(|s| Some(&s.case.id) == selected.as_ref() && s.case.native == "ready")
            .map(|s| ArtifactContext {
                boot_id: view.boot_id.clone(),
                generation,
                selected: s.clone(),
            });
        if let Some(loaded) = &self.artifact_view
            && !self.context.as_ref().is_some_and(|context| {
                context.boot_id == loaded.key.boot_id
                    && context.generation == loaded.key.generation
                    && context.selected.case.id == loaded.key.case_id
                    && context.selected.linked_artifact(&loaded.key.artifact_id)
                        == Some(&loaded.artifact)
            })
        {
            self.clear_artifact();
        }
        self.snapshot = Some(view);
        self.status = "Connected · scripted".into();
    }
    fn accepts_artifact(&self, job: &ArtifactJob) -> bool {
        self.artifact_revision == job.revision
            && self
                .artifact_view
                .as_ref()
                .is_some_and(|v| v.key == job.key && v.artifact == job.artifact)
            && self.context.as_ref().is_some_and(|context| {
                context.boot_id == job.key.boot_id
                    && context.generation == job.key.generation
                    && context.selected.case.id == job.key.case_id
                    && context.selected.linked_artifact(&job.key.artifact_id) == Some(&job.artifact)
            })
    }
}
enum Job {
    Refresh(u64),
    Command(Value),
}
pub struct Client {
    jobs: mpsc::SyncSender<Job>,
    artifact_jobs: mpsc::SyncSender<ArtifactJob>,
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
fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .proxy(None)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .timeout_connect(Some(Duration::from_secs(2)))
        .timeout_recv_response(Some(Duration::from_secs(3)))
        .timeout_recv_body(Some(Duration::from_secs(3)))
        .build()
        .into()
}
fn png_bounds(bytes: &[u8]) -> Result<(), ()> {
    if bytes.get(..8) != Some(b"\x89PNG\r\n\x1a\n") {
        return Err(());
    }
    let mut offset = 8;
    let mut data = false;
    while offset + 12 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let end = offset
            .checked_add(length)
            .and_then(|n| n.checked_add(12))
            .ok_or(())?;
        if end > bytes.len() {
            return Err(());
        }
        match &bytes[offset + 4..offset + 8] {
            b"IHDR" if offset == 8 && length == 13 => {
                let width = u32::from_be_bytes(bytes[offset + 8..offset + 12].try_into().unwrap());
                let height =
                    u32::from_be_bytes(bytes[offset + 12..offset + 16].try_into().unwrap());
                if width == 0
                    || height == 0
                    || width > 4096
                    || height > 4096
                    || u64::from(width) * u64::from(height) > 16_000_000
                {
                    return Err(());
                }
            }
            b"IDAT" if offset > 8 => data = true,
            b"PLTE" | b"tRNS" if offset > 8 => (),
            b"sRGB" if offset > 8 && length == 1 => (),
            b"gAMA" if offset > 8 && length == 4 => (),
            b"cHRM" if offset > 8 && length == 32 => (),
            b"pHYs" if offset > 8 && length == 9 => (),
            b"IEND" if data && length == 0 && end == bytes.len() => return Ok(()),
            // Compressed metadata can expand independently of dimensions in the native decoder.
            _ => return Err(()),
        }
        offset = end;
    }
    Err(())
}
fn fetch_artifact(agent: &ureq::Agent, c: &Connection, a: &Artifact) -> Result<ArtifactState, ()> {
    if !route_id(&a.case_id) || !route_id(&a.id) || a.size == 0 || a.size > a.mime.limit() {
        return Err(());
    }
    let mut response = agent
        .get(format!(
            "{}/v1/cases/{}/artifacts/{}",
            c.url, a.case_id, a.id
        ))
        .header("authorization", format!("Bearer {}", c.capability))
        .call()
        .map_err(|_| ())?;
    let headers = response.headers();
    if response.status() != 200
        || headers.get_all("content-type").iter().count() != 1
        || headers.get("content-type").and_then(|v| v.to_str().ok()) != Some(a.mime.as_str())
        || headers.get_all("content-length").iter().count() != 1
        || headers
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<usize>().ok())
            != Some(a.size)
        || headers.contains_key("content-encoding")
        || headers.contains_key("transfer-encoding")
    {
        return Err(());
    }
    let bytes = response
        .body_mut()
        .with_config()
        .limit((a.size + 1) as u64)
        .read_to_vec()
        .map_err(|_| ())?;
    if bytes.len() != a.size || format!("{:x}", Sha256::digest(&bytes)) != a.sha256 {
        return Err(());
    }
    match a.mime {
        ArtifactMime::Text => Ok(ArtifactState::Text(
            String::from_utf8(bytes).map_err(|_| ())?.into(),
        )),
        ArtifactMime::Png => {
            png_bounds(&bytes)?;
            let image = Arc::new(Image::from_bytes(ImageFormat::Png, bytes));
            Ok(ArtifactState::Png(image))
        }
    }
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
fn receive_events(
    reader: &mut SseConnection,
    c: &Connection,
    g: u64,
    selection: &Mutex<Option<String>>,
    generation: &AtomicU64,
    stopped: &AtomicBool,
    update: &Mutex<Update>,
) -> Result<(), ()> {
    let active = || !stopped.load(Ordering::Relaxed) && generation.load(Ordering::Relaxed) == g;
    let mut sequence = 0;
    while active() {
        let line = match reader.read_line(&active) {
            Ok(line) => line,
            Err(_) if !active() => return Ok(()),
            Err(_) => return Err(()),
        };
        if let Some(data) = line.strip_prefix("data: ") {
            let frame: Frame = serde_json::from_str(data).map_err(|_| ())?;
            if frame.protocol != 1
                || frame.boot_id != c.boot_id
                || frame.sequence <= sequence
                || !valid(&frame.snapshot, c)
            {
                return Err(());
            }
            sequence = frame.sequence;
            let mut u = update.lock().unwrap();
            if active() {
                u.apply_snapshot(frame.snapshot, g, &selection.lock().unwrap());
            }
        }
    }
    Ok(())
}
impl Client {
    pub fn new(path: PathBuf) -> Self {
        let (send, receive) = mpsc::sync_channel(32);
        let (artifact_send, artifact_receive) = mpsc::sync_channel::<ArtifactJob>(1);
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
                let agent = agent();
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
                            let mut u = update.lock().unwrap();
                            if generation.load(Ordering::Relaxed) == g {
                                match result {
                                    Ok(view) => {
                                        u.apply_snapshot(view, g, &selection.lock().unwrap())
                                    }
                                    Err(_) => u.disconnect(),
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
                                    if response.status() == 200
                                        && let Ok(text) = response
                                            .body_mut()
                                            .with_config()
                                            .limit(4096)
                                            .read_to_string()
                                        && let Ok(receipt) = serde_json::from_str::<Value>(&text)
                                    {
                                        result = receipt["requestId"] == id;
                                    }
                                    break;
                                }
                            }
                            let mut u = update.lock().unwrap();
                            u.acknowledgments.push((id, result));
                            if !result {
                                u.disconnect();
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
            let (path, update, stopped) = (path.clone(), update.clone(), stopped.clone());
            thread::spawn(move || {
                let agent = agent();
                while let Ok(job) = artifact_receive.recv() {
                    if stopped.load(Ordering::Relaxed) {
                        break;
                    }
                    if !update.lock().unwrap().accepts_artifact(&job) {
                        continue;
                    }
                    let result = (|| {
                        let c = connection(&path)?;
                        if c.boot_id != job.key.boot_id {
                            return Err(());
                        }
                        let content = fetch_artifact(&agent, &c, &job.artifact)?;
                        if connection(&path)?.boot_id != job.key.boot_id {
                            return Err(());
                        }
                        Ok(content)
                    })();
                    let mut u = update.lock().unwrap();
                    if u.accepts_artifact(&job) {
                        u.artifact_view.as_mut().unwrap().state =
                            result.unwrap_or(ArtifactState::Unavailable);
                        u.artifact_revision += 1;
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
                while !stopped.load(Ordering::Relaxed) {
                    let g = generation.load(Ordering::Relaxed);
                    let active = || {
                        !stopped.load(Ordering::Relaxed) && generation.load(Ordering::Relaxed) == g
                    };
                    let result = (|| {
                        let c = connection(&path)?;
                        let selected = selection.lock().unwrap().clone();
                        let mut reader =
                            SseConnection::open(&c.capability, selected.as_deref(), &active)?;
                        receive_events(
                            &mut reader,
                            &c,
                            g,
                            &selection,
                            &generation,
                            &stopped,
                            &update,
                        )
                    })();
                    if result.is_err() {
                        {
                            let mut u = update.lock().unwrap();
                            if !stopped.load(Ordering::Relaxed)
                                && generation.load(Ordering::Relaxed) == g
                            {
                                u.disconnect();
                            }
                        }
                        thread::sleep(Duration::from_millis(500));
                    }
                }
            });
        }
        Self {
            jobs: send,
            artifact_jobs: artifact_send,
            update,
            selection,
            generation,
            stopped,
        }
    }
    pub fn select(&self, id: Option<String>) {
        let mut u = self.update.lock().unwrap();
        u.context = None;
        u.snapshot = None;
        u.clear_artifact();
        *self.selection.lock().unwrap() = id.filter(|id| route_id(id));
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.jobs.try_send(Job::Refresh(generation));
    }
    pub fn view_artifact(&self, artifact_id: &str) -> Result<(), ()> {
        let mut u = self.update.lock().unwrap();
        let context = u.context.as_ref().ok_or(())?;
        let artifact = context
            .selected
            .linked_artifact(artifact_id)
            .ok_or(())?
            .clone();
        let key = ArtifactKey {
            boot_id: context.boot_id.clone(),
            generation: context.generation,
            case_id: context.selected.case.id.clone(),
            artifact_id: artifact.id.clone(),
        };
        let revision = u.artifact_revision + 1;
        self.artifact_jobs
            .try_send(ArtifactJob {
                key: key.clone(),
                artifact: artifact.clone(),
                revision,
            })
            .map_err(|_| ())?;
        u.artifact_revision = revision;
        u.artifact_view = Some(ArtifactView {
            key,
            artifact,
            state: ArtifactState::Loading,
        });
        Ok(())
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
        self.update.lock().unwrap().disconnect();
    }
}

#[cfg(test)]
#[path = "artifact_tests.rs"]
mod artifact_tests;

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
            if let Some(view) = client.update.lock().unwrap().snapshot.as_ref()
                && predicate(view)
            {
                return view.clone();
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
            .args(["--input-type=module", "-e", artifact_tests::CONTROLLER])
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
        let view = snapshot(&client, |v| {
            v.selected
                .as_ref()
                .is_some_and(|s| s.case.id == case.id && s.artifacts.len() == 2)
        });
        artifact_tests::real_artifacts(&client, view.selected.as_ref().unwrap(), true);
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
        let selected = view.selected.unwrap();
        artifact_tests::real_artifacts(&reopened, &selected, false);
        snapshot(&reopened, |v| {
            v.selected.as_ref().is_some_and(|s| s.case.id == case.id)
        });
        reopened.view_artifact(&selected.artifacts[0].id).unwrap();
        let version = selected.case.version;
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
        assert!(reopened.update.lock().unwrap().artifact_view.is_none());
        assert!(reopened.view_artifact(&selected.artifacts[0].id).is_err());
        assert!(
            fetch_artifact(
                &agent(),
                &connection(&directory.join("connection.json")).unwrap(),
                &selected.artifacts[0]
            )
            .is_err()
        );
        drop(reopened);
        drop(running);
    }
}
