mod client;
mod input;
mod theme;

use client::{Artifact, ArtifactState, ArtifactView, Client, Selected, Snapshot};
use gpui::{prelude::*, *};
use input::NoteInput;
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf, time::Duration};
use theme::{StatusInk, THEME};

actions!(eitri, [Quit]);
struct Operator {
    client: Client,
    view: Option<Snapshot>,
    selected: Option<String>,
    input: Entity<NoteInput>,
    status: String,
    notice: String,
    filter: String,
    pending_note: Option<(String, String, String)>,
    drafts: HashMap<String, String>,
    confirm_cleanup: bool,
    artifact_view: Option<ArtifactView>,
    artifact_revision: u64,
}
impl Operator {
    fn new(cx: &mut Context<Self>) -> Self {
        let directory = std::env::var_os("EITRI_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap())
                    .join("Library/Application Support/eitri")
            });
        cx.spawn(async move |this, cx| {
            loop {
                Timer::after(Duration::from_millis(50)).await;
                if this.update(cx, |this, cx| this.pump(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            client: Client::new(directory.join("connection.json")),
            view: None,
            selected: None,
            input: cx.new(NoteInput::new),
            status: "Connecting…".into(),
            notice: "Scripted mode · no live model, worker, credentials, or publication".into(),
            filter: "all".into(),
            pending_note: None,
            drafts: HashMap::new(),
            confirm_cleanup: false,
            artifact_view: None,
            artifact_revision: 0,
        }
    }
    fn pump(&mut self, cx: &mut Context<Self>) {
        let (snapshot, status, acknowledgments, artifact_view, artifact_revision) = {
            let mut update = self.client.update.lock().unwrap();
            (
                update.snapshot.take(),
                update.status.clone(),
                std::mem::take(&mut update.acknowledgments),
                update.artifact_view.clone(),
                update.artifact_revision,
            )
        };
        let changed = snapshot.is_some()
            || self.status != status
            || !acknowledgments.is_empty()
            || self.artifact_revision != artifact_revision;
        if self.artifact_revision != artifact_revision {
            self.clear_artifact(cx);
            self.artifact_view = artifact_view;
            self.artifact_revision = artifact_revision;
        }
        if let Some(snapshot) = snapshot {
            self.view = Some(snapshot);
        }
        if !status.is_empty() {
            self.status = status;
        }
        for (id, accepted) in acknowledgments {
            self.notice = if accepted {
                "Command accepted durably"
            } else {
                "Command not confirmed. Draft retained; refresh state before retrying."
            }
            .into();
            if let Some((pending, case_id, text)) = &self.pending_note
                && *pending == id
            {
                if accepted {
                    let text = text.clone();
                    if self.selected.as_ref() == Some(case_id) {
                        self.input.update(cx, |input, cx| input.clear_if(&text, cx));
                    }
                    if self.drafts.get(case_id) == Some(&text) {
                        self.drafts.remove(case_id);
                    }
                }
                self.pending_note = None;
            }
        }
        if changed {
            cx.notify();
        }
    }
    fn clear_artifact(&mut self, cx: &mut Context<Self>) {
        if let Some(ArtifactView {
            state: ArtifactState::Png(image),
            ..
        }) = self.artifact_view.take()
        {
            cx.defer(move |cx| {
                for window in cx.windows() {
                    let _ = window.update(cx, |_, window, cx| {
                        if let Some(rendered) = image.clone().get_render_image(window, cx) {
                            cx.drop_image(rendered, Some(window));
                        }
                    });
                }
                image.remove_asset(cx);
            });
        }
    }
    fn artifact_card(
        &self,
        selected: &Selected,
        artifact: &Artifact,
        cx: &mut Context<Self>,
    ) -> Div {
        let mut card = div()
            .p_3()
            .rounded(px(THEME.radius))
            .bg(rgb(THEME.input))
            .border_1()
            .border_color(rgb(THEME.border))
            .flex_shrink_0()
            .flex()
            .flex_col()
            .gap_2()
            .child(artifact.label.clone())
            .child(
                div()
                    .text_size(px(THEME.metadata_size))
                    .text_color(rgb(THEME.muted))
                    .font_family(THEME.mono_family)
                    .child(format!(
                        "{} · {} bytes\nSHA-256\n{}",
                        artifact.mime.as_str(),
                        artifact.size,
                        artifact.sha256
                    )),
            );
        if selected.linked_artifact(&artifact.id).is_none() {
            return card.child("Unavailable or incomplete provenance. Not check evidence.");
        }
        if !self.status.starts_with("Connected") {
            return card
                .child("Artifact unavailable while disconnected. Reconnect before viewing.");
        }
        let id = artifact.id.clone();
        card = card.child(
            div()
                .id(SharedString::from(format!("view-{id}")))
                .min_h(px(THEME.control_height))
                .border_1()
                .border_color(rgb(THEME.border))
                .hover(|s| s.bg(rgb(THEME.hover)))
                .px_3()
                .py_2()
                .rounded(px(THEME.radius))
                .bg(rgb(THEME.surface))
                .cursor_pointer()
                .child("View")
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.client.view_artifact(&id).is_err() {
                        this.notice =
                            "Artifact unavailable or viewer busy. Nothing was started.".into();
                    }
                    this.pump(cx);
                    cx.notify();
                })),
        );
        if artifact.mime == client::ArtifactMime::Png {
            card = card.child("Screenshot records appearance. It is not correctness proof.");
        }
        if let Some(view) = &self.artifact_view
            && view.key.case_id == selected.case.id
            && view.key.artifact_id == artifact.id
            && view.artifact == *artifact
        {
            card = match &view.state {
                ArtifactState::Loading => card.child("Loading one artifact…"),
                ArtifactState::Unavailable => card.child(
                    "Artifact unavailable, invalid, or unsupported. No validation inferred.",
                ),
                ArtifactState::Text(text) => card.child(
                    div()
                        .font_family(THEME.mono_family)
                        .text_size(px(THEME.metadata_size))
                        .child(text.to_string()),
                ),
                ArtifactState::Png(image) => {
                    card.child(img(image.clone()).w_full().h(px(360.0)).with_fallback(|| {
                        div()
                            .child("PNG could not be displayed.")
                            .into_any_element()
                    }))
                }
            };
        }
        card
    }
    fn send(&mut self, intent: Value, version: Option<u64>, cx: &mut Context<Self>) {
        match self.client.command(intent, version) {
            Ok(_) => self.notice = "Sending command…".into(),
            Err(_) => self.notice = "Command queue busy; nothing was sent".into(),
        }
        cx.notify();
    }
    fn button(
        &self,
        id: &'static str,
        label: &'static str,
        intent: Value,
        version: Option<u64>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .min_h(px(THEME.control_height))
            .flex_shrink_0()
            .border_1()
            .border_color(rgb(THEME.border))
            .px_3()
            .py_2()
            .rounded(px(THEME.radius))
            .bg(rgb(THEME.surface))
            .text_size(px(THEME.metadata_size))
            .cursor_pointer()
            .hover(|s| s.bg(rgb(THEME.hover)))
            .on_click(cx.listener(move |this, _, _, cx| this.send(intent.clone(), version, cx)))
            .child(label)
    }
}
impl Render for Operator {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let snapshot = self.view.clone();
        let cases = snapshot
            .as_ref()
            .map(|v| v.cases.clone())
            .unwrap_or_default();
        let selected = snapshot
            .as_ref()
            .and_then(|v| v.selected.clone())
            .filter(|s| Some(&s.case.id) == self.selected.as_ref());
        let mut detail = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .p(px(THEME.detail_padding))
            .gap(px(THEME.gap));
        if let Some(selected) = selected {
            let c = selected.case.clone();
            detail = detail
                .child(
                    div()
                        .flex_shrink_0()
                        .text_size(px(THEME.heading_size))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(
                            c.issue["title"]
                                .as_str()
                                .unwrap_or("Investigation")
                                .to_owned(),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .flex_shrink_0()
                        .child(
                            div()
                                .text_color(rgb(THEME.muted))
                                .child(format!("Phase  {}", c.phase)),
                        )
                        .child(
                            div()
                                .text_color(rgb(
                                    THEME.status_color(StatusInk::for_session(&c.status))
                                ))
                                .child(format!("Status  {}", c.status)),
                        )
                        .child(
                            div()
                                .font_family(THEME.mono_family)
                                .text_size(px(THEME.metadata_size))
                                .text_color(rgb(THEME.muted))
                                .child(format!(
                                    "Allowance  {}s remaining\nVersion  {}",
                                    c.remaining_ms / 1000,
                                    c.version
                                )),
                        ),
                );
            if !c.reason.is_empty() {
                detail = detail.child(
                    div()
                        .p_3()
                        .rounded(px(THEME.radius))
                        .flex_shrink_0()
                        .border_l_2()
                        .border_color(rgb(THEME.status_color(StatusInk::Attention)))
                        .bg(rgb(THEME.warning))
                        .child(c.reason.clone()),
                );
            }
            if let Some(warning) = &c.warning {
                detail = detail.child(
                    div()
                        .p_3()
                        .rounded(px(THEME.radius))
                        .flex_shrink_0()
                        .border_l_2()
                        .border_color(rgb(THEME.status_color(StatusInk::Negative)))
                        .bg(rgb(THEME.danger))
                        .child(format!("History warning: {warning}")),
                );
            }
            let mut controls = div().flex().flex_wrap().flex_shrink_0().gap_2();
            let version = Some(c.version);
            if self.status.starts_with("Connected") {
                if ["running", "queued", "provisioning", "pause-requested"]
                    .contains(&c.status.as_str())
                {
                    controls = controls.child(self.button(
                        "pause",
                        "Pause",
                        json!({"type":"pause","caseId":c.id}),
                        None,
                        cx,
                    ));
                }
                if c.status == "paused" {
                    controls = controls.child(self.button(
                        "continue",
                        "Continue",
                        json!({"type":"continue","caseId":c.id}),
                        version,
                        cx,
                    ));
                }
                let note = self.input.read(cx).text();
                if !note.trim().is_empty() {
                    if c.status == "needs-attention" {
                        controls = controls.child(self.button(
                            "retry",
                            "Retry · new allowance",
                            json!({"type":"retry","caseId":c.id,"note":note}),
                            version,
                            cx,
                        ));
                    }
                    if ["paused", "queued", "needs-attention"].contains(&c.status.as_str()) {
                        controls = controls.child(self.button(
                            "dismiss",
                            "Dismiss locally",
                            json!({"type":"dismiss","caseId":c.id,"note":note}),
                            version,
                            cx,
                        ));
                    }
                    if c.status == "terminal" {
                        controls = controls.child(self.button(
                            "requeue",
                            "Requeue · new linked session",
                            json!({"type":"requeue","caseId":c.id,"note":note}),
                            version,
                            cx,
                        ));
                    }
                }
                if c.status == "terminal" && c.native != "expired" {
                    if self.confirm_cleanup {
                        controls = controls.child(self.button(
                            "confirm-cleanup",
                            "Confirm loss of detailed history",
                            json!({"type":"details-cleanup","caseId":c.id,"confirmed":true}),
                            version,
                            cx,
                        ));
                    } else {
                        controls = controls.child(
                            div()
                                .id("ask-cleanup")
                                .min_h(px(THEME.control_height))
                                .border_1()
                                .border_color(rgb(THEME.border))
                                .hover(|s| {
                                    s.border_color(rgb(THEME.status_color(StatusInk::Negative)))
                                })
                                .px_3()
                                .py_2()
                                .rounded(px(THEME.radius))
                                .flex_shrink_0()
                                .border_l_2()
                                .border_color(rgb(THEME.status_color(StatusInk::Negative)))
                                .bg(rgb(THEME.danger))
                                .cursor_pointer()
                                .child("Delete detailed history…")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.confirm_cleanup = true;
                                    cx.notify();
                                })),
                        );
                    }
                }
            }
            detail = detail.child(controls);
            if c.native == "expired" || c.native == "missing" || c.native == "deleting" {
                detail = detail.child(div().p_5().child(format!(
                    "Detailed history {}. Compact ownership and outcome remain recorded.",
                    c.native
                )));
            } else {
                let mut history = div()
                    .id("history")
                    .flex()
                    .flex_col()
                    .gap_3()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll();
                history =
                    history.child(div().text_color(rgb(THEME.muted)).child(
                        "Recorded checks · observed results, not complete correctness proof",
                    ));
                if selected.checks.is_empty() {
                    history = history.child(
                        "No recorded checks. Artifact manifests alone are not validation evidence.",
                    );
                }
                for check in &selected.checks {
                    let mut card = div()
                        .p_3()
                        .flex_shrink_0()
                        .border_t_1()
                        .border_color(rgb(THEME.border))
                        .bg(rgb(THEME.surface))
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(
                            div()
                                .text_color(rgb(
                                    THEME.status_color(StatusInk::for_check(check.passed))
                                ))
                                .child(format!(
                                    "{} · observed outcome {} · {}",
                                    check.kind,
                                    if check.passed { "passed" } else { "failed" },
                                    if check.simulated {
                                        "simulated"
                                    } else {
                                        "not simulated"
                                    }
                                )),
                        )
                        .child(
                            div()
                                .font_family(THEME.mono_family)
                                .border_t_1()
                                .border_color(rgb(THEME.border))
                                .pt_2()
                                .text_size(px(THEME.metadata_size))
                                .text_color(rgb(THEME.muted))
                                .child(format!(
                                    "Revision\n{}\nConfiguration\n{}\nCheck {}\nAction {}",
                                    check.candidate, check.configuration, check.id, check.action_id
                                )),
                        );
                    for id in &check.artifacts {
                        if let Some(artifact) = selected
                            .linked_artifact(id)
                            .filter(|a| a.check_id == check.id)
                        {
                            card = card.child(self.artifact_card(&selected, artifact, cx));
                        } else {
                            card = card.child("Linked artifact unavailable or incomplete. Not validation evidence.");
                        }
                    }
                    history = history.child(card);
                }
                for artifact in &selected.artifacts {
                    if selected.linked_artifact(&artifact.id).is_none() {
                        history = history.child(self.artifact_card(&selected, artifact, cx));
                    }
                }
                if selected.more {
                    history = history.child(
                        "Showing the latest page. Earlier details are retained by the controller.",
                    );
                }
                for message in selected.messages {
                    let body = serde_json::to_string_pretty(&message.data).unwrap_or_default();
                    let preview: String = body.chars().take(6000).collect();
                    history = history.child(
                        div()
                            .id(SharedString::from(message.id))
                            .flex_shrink_0()
                            .p_3()
                            .border_t_1()
                            .border_color(rgb(THEME.border))
                            .bg(rgb(THEME.surface))
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_color(rgb(THEME.muted))
                                    .text_size(px(THEME.metadata_size))
                                    .child(message.kind),
                            )
                            .child(
                                div()
                                    .font_family(THEME.mono_family)
                                    .text_size(px(THEME.metadata_size))
                                    .child(if body.chars().count() > 6000 {
                                        format!("{preview}\n[Preview truncated]")
                                    } else {
                                        preview
                                    }),
                            ),
                    );
                }
                detail = detail.child(history).child(div().flex_shrink_0().text_size(px(THEME.metadata_size)).text_color(rgb(THEME.muted)).child("Notes are saved without inference when parked. Enter inserts a new line. Retry / Dismiss / Requeue use this text as their reason."))
                    .child(self.input.clone());
                let case_id = c.id.clone();
                detail = detail.child(
                    div()
                        .id("save-note")
                        .min_h(px(THEME.control_height))
                        .flex_shrink_0()
                        .border_1()
                        .border_color(rgb(THEME.accent))
                        .text_color(rgb(THEME.on_accent))
                        .hover(|s| s.bg(rgb(THEME.focus)))
                        .px_4()
                        .py_2()
                        .rounded(px(THEME.radius))
                        .bg(rgb(THEME.accent))
                        .cursor_pointer()
                        .child(if self.pending_note.is_some() {
                            "Saving…"
                        } else {
                            "Save message / note"
                        })
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let text = this.input.read(cx).text();
                            if text.trim().is_empty() || this.pending_note.is_some() {
                                return;
                            }
                            match this.client.command(
                                json!({"type":"post-message","caseId":case_id,"text":text}),
                                None,
                            ) {
                                Ok(id) => {
                                    this.pending_note = Some((id, case_id.clone(), text));
                                    this.notice = "Saving note…".into();
                                }
                                Err(_) => this.notice = "Queue busy; draft retained".into(),
                            }
                            cx.notify();
                        })),
                );
            }
        } else {
            detail = detail.justify_center().child(anvil_mark()).child(div().text_size(px(THEME.heading_size)).font_weight(FontWeight::SEMIBOLD).child("Choose an investigation"))
            .child("Check now creates synthetic cases for the native operator exercise. It does not contact Sentry or run a live model.");
        }
        let mut sidebar = div()
            .w(px(THEME.sidebar_width))
            .flex_shrink_0()
            .bg(rgb(THEME.sidebar))
            .border_r_1()
            .border_color(rgb(THEME.border))
            .p_4()
            .flex()
            .flex_col()
            .gap_3();
        let mut filters = div().flex().flex_wrap().flex_shrink_0().gap_2();
        for filter in ["all", "active", "parked", "history"] {
            filters = filters.child(
                div()
                    .id(filter)
                    .min_h(px(32.0))
                    .border_1()
                    .border_color(rgb(if self.filter == filter {
                        THEME.accent
                    } else {
                        THEME.border
                    }))
                    .hover(|s| s.border_color(rgb(THEME.accent)))
                    .px_2()
                    .py_1()
                    .rounded(px(THEME.radius))
                    .bg(rgb(if self.filter == filter {
                        THEME.selection
                    } else {
                        THEME.surface
                    }))
                    .cursor_pointer()
                    .child(filter)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.filter = filter.into();
                        cx.notify();
                    })),
            );
        }
        sidebar = sidebar
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Investigations"),
            )
            .child(filters);
        let mut list = div()
            .id("sessions")
            .flex()
            .flex_col()
            .gap_2()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll();
        let catalogue_empty = cases.is_empty();
        let mut visible_sessions = 0;
        for c in cases {
            if self.filter == "active"
                && !["running", "queued", "provisioning", "pause-requested"]
                    .contains(&c.status.as_str())
            {
                continue;
            }
            if self.filter == "parked"
                && !["paused", "needs-attention", "awaiting-merge"].contains(&c.status.as_str())
            {
                continue;
            }
            if self.filter == "history" && c.status != "terminal" {
                continue;
            }
            visible_sessions += 1;
            let id = c.id.clone();
            list = list.child(
                div()
                    .id(SharedString::from(c.id.clone()))
                    .min_h(px(84.0))
                    .flex_shrink_0()
                    .border_l_2()
                    .border_color(rgb(if self.selected.as_ref() == Some(&c.id) {
                        THEME.accent
                    } else {
                        THEME.border
                    }))
                    .hover(|s| s.border_color(rgb(THEME.accent)))
                    .p_3()
                    .rounded(px(THEME.radius))
                    .bg(rgb(if self.selected.as_ref() == Some(&c.id) {
                        THEME.selection
                    } else {
                        THEME.surface
                    }))
                    .cursor_pointer()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(c.issue["title"].as_str().unwrap_or("Issue").to_owned())
                    .child(
                        div()
                            .text_size(px(THEME.metadata_size))
                            .text_color(rgb(THEME.muted))
                            .child(format!("Phase  {}", c.phase)),
                    )
                    .child(
                        div()
                            .text_size(px(THEME.metadata_size))
                            .text_color(rgb(THEME.status_color(StatusInk::for_session(&c.status))))
                            .child(format!("Status  {}", c.status)),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(old) = &this.selected {
                            this.drafts.insert(old.clone(), this.input.read(cx).text());
                        }
                        let draft = this.drafts.get(&id).cloned().unwrap_or_default();
                        this.input.update(cx, |input, cx| input.set_text(draft, cx));
                        this.selected = Some(id.clone());
                        this.confirm_cleanup = false;
                        this.client.select(Some(id.clone()));
                        this.clear_artifact(cx);
                        cx.notify();
                    })),
            );
        }
        if visible_sessions == 0 {
            list = list.child(div().text_color(rgb(THEME.muted)).child(if catalogue_empty {
                if snapshot.is_none() {
                    "Investigations unavailable. Waiting for the controller connection."
                } else {
                    "No investigations yet. Use Check now to create synthetic cases."
                }
            } else {
                "No investigations in this filter. Choose another filter to see retained sessions."
            }));
        }
        sidebar = sidebar.child(list);
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(THEME.canvas))
            .font_family(THEME.body_family)
            .text_color(rgb(THEME.text))
            .text_size(px(THEME.body_size))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_3()
                    .items_center()
                    .justify_between()
                    .min_h(px(THEME.header_height))
                    .flex_shrink_0()
                    .px_4()
                    .py_3()
                    .border_b_1()
                    .border_color(rgb(THEME.border))
                    .bg(rgb(THEME.sidebar))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(anvil_mark())
                            .child(
                                div()
                                    .text_size(px(THEME.heading_size))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("eitri"),
                            )
                            .child(div().text_color(rgb(THEME.muted)).child("operator")),
                    )
                    .child(
                        div()
                            .text_size(px(THEME.metadata_size))
                            .child(self.status.clone()),
                    )
                    .child(self.button(
                        "check-now",
                        "Check now · scripted",
                        json!({"type":"check-now"}),
                        None,
                        cx,
                    )),
            )
            .child(div().flex().flex_1().min_h_0().child(sidebar).child(detail))
            .child(
                div()
                    .min_h(px(THEME.footer_height))
                    .flex_shrink_0()
                    .px_4()
                    .py(px(6.0))
                    .border_t_1()
                    .border_color(rgb(THEME.border))
                    .text_size(px(THEME.metadata_size))
                    .text_color(rgb(THEME.muted))
                    .bg(rgb(THEME.sidebar))
                    .child(self.notice.clone()),
            )
    }
}
fn anvil_mark() -> impl IntoElement {
    canvas(
        |_, _, _| (),
        |bounds, _, window, _| {
            let mut path = PathBuilder::fill();
            let points = [
                (0.0, 3.0),
                (24.0, 3.0),
                (20.0, 8.0),
                (15.0, 8.0),
                (15.0, 13.0),
                (20.0, 17.0),
                (20.0, 20.0),
                (4.0, 20.0),
                (4.0, 17.0),
                (9.0, 13.0),
                (9.0, 8.0),
                (4.0, 8.0),
            ];
            path.move_to(bounds.origin + point(px(points[0].0), px(points[0].1)));
            for (x, y) in &points[1..] {
                path.line_to(bounds.origin + point(px(*x), px(*y)));
            }
            path.close();
            if let Ok(path) = path.build() {
                window.paint_path(path, rgb(THEME.accent));
            }
        },
    )
    .w(px(24.0))
    .h(px(20.0))
    .flex_shrink_0()
}

fn main() {
    Application::new().run(|cx: &mut App| {
        input::bind(cx);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        let bounds = Bounds::centered(None, size(px(1200.0), px(820.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Eitri · scripted operator".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            |_, cx| cx.new(Operator::new),
        )
        .unwrap();
        cx.activate(true);
    });
}
