use super::*;
use client::{Check, Session};
use core::prelude::v1::test;
use std::{fs, os::unix::fs::DirBuilderExt};

struct PrivateDirectory(PathBuf);

impl PrivateDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("eitri-layout-{}", uuid::Uuid::new_v4()));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
}

impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        fs::remove_dir(&self.0).unwrap();
    }
}

fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        window.refresh();
        window.draw(cx).clear();
    });
}

fn scroll(cx: &mut VisualTestContext, position: Point<Pixels>, y: f32) {
    cx.simulate_event(ScrollWheelEvent {
        position,
        delta: ScrollDelta::Pixels(point(px(0.0), px(y))),
        ..Default::default()
    });
    draw(cx);
}

fn paused_detail<'a>(
    cx: &'a mut TestAppContext,
    directory: &PrivateDirectory,
) -> (Session, String, Entity<Operator>, &'a mut VisualTestContext) {
    let case = Session {
        id: "11111111-1111-4111-8111-111111111111".into(),
        issue: json!({"title": "Paused investigation with recorded checks"}),
        phase: "testing".into(),
        status: "paused".into(),
        remaining_ms: 120_000,
        version: 7,
        reason: "The remediation session is paused for operator review. The candidate revision and recorded checks remain available. Review this explanation before continuing.\nNo live model or worker is running. The operator can retain a multiline note without starting inference.".into(),
        native: "ready".into(),
        ..Default::default()
    };
    let checks = (0..8)
        .map(|index| Check {
            id: format!("check-{index}"),
            case_id: case.id.clone(),
            action_id: format!("action-{index}"),
            kind: "unit test".into(),
            candidate: "a".repeat(40),
            configuration: "b".repeat(64),
            passed: true,
            simulated: true,
            artifacts: Vec::new(),
        })
        .collect();
    let selected = Selected {
        case: case.clone(),
        checks,
        messages: Vec::new(),
        artifacts: Vec::new(),
        more: false,
    };
    let draft = "A long draft stays inside the bounded note editor.\n".repeat(30);
    let (view, cx) = cx.add_window_view(|_, cx| {
        let input = cx.new(NoteInput::new);
        input.update(cx, |input, cx| input.set_text(draft.clone(), cx));
        Operator {
            client: Client::new(directory.0.join("connection.json")),
            view: Some(Snapshot {
                protocol: 1,
                boot_id: "layout-test".into(),
                mode: "scripted".into(),
                cases: vec![case.clone()],
                selected: Some(selected),
            }),
            selected: Some(case.id.clone()),
            input,
            status: "Connected · scripted layout test".into(),
            notice: "Scripted layout test".into(),
            filter: "all".into(),
            pending_note: None,
            drafts: HashMap::new(),
            confirm_cleanup: false,
            artifact_view: None,
            artifact_revision: 0,
        }
    });
    (case, draft, view, cx)
}

#[gpui::test]
fn selected_paused_detail_keeps_history_and_save_reachable(cx: &mut TestAppContext) {
    let directory = PrivateDirectory::new();
    let (case, draft, view, cx) = paused_detail(cx, &directory);
    cx.simulate_resize(size(px(900.0), px(600.0)));
    draw(cx);
    let detail = cx.debug_bounds("detail").unwrap();
    let metadata = cx.debug_bounds("case-metadata").unwrap();
    let controls = cx.debug_bounds("case-controls").unwrap();
    let history = cx.debug_bounds("history").unwrap();
    let save = cx.debug_bounds("save-note").unwrap();
    let footer = cx.debug_bounds("footer").unwrap();
    eprintln!(
        "900x600 detail={detail:?} metadata={metadata:?} controls={controls:?} history={history:?} save={save:?} footer={footer:?}"
    );
    assert!(
        history.size.height >= px(120.0),
        "history needs a usable viewport, got {history:?}"
    );
    assert!(
        metadata.size.height >= px(80.0),
        "phase, status, allowance, and version need readable metadata"
    );
    assert!(metadata.top() >= detail.top());
    assert!(metadata.bottom() <= detail.bottom());
    assert!(controls.size.height >= px(34.0));
    assert!(controls.bottom() <= detail.bottom());
    assert!(detail.bottom() <= footer.top());

    let note_help = cx.debug_bounds("note-help").unwrap();
    assert!(
        (px(110.0)..=px(200.0)).contains(&(save.top() - note_help.bottom())),
        "a long draft must keep a usable, bounded composer"
    );
    let continue_button = cx.debug_bounds("continue").unwrap();
    assert!(continue_button.top() >= detail.top());
    assert!(continue_button.bottom() <= detail.bottom());

    let scroll_position = point(detail.right() - px(2.0), detail.center().y);
    let to_history = f32::from(detail.top() + px(12.0) - history.top());
    scroll(cx, scroll_position, to_history);
    let history = cx.debug_bounds("history").unwrap();
    assert!(history.top() >= detail.top());
    assert!(history.bottom() <= detail.bottom());
    let check_before = cx.debug_bounds("check-check-0").unwrap();
    scroll(cx, history.center(), -200.0);
    assert_eq!(
        cx.debug_bounds("history").unwrap(),
        history,
        "history scroll must not move the detail stack"
    );
    let check_after = cx.debug_bounds("check-check-0").unwrap();
    assert!(
        check_after.top() < check_before.top() - px(50.0),
        "recorded checks must scroll inside history"
    );

    scroll(cx, scroll_position, -10_000.0);
    let save = cx.debug_bounds("save-note").unwrap();
    assert!(
        save.top() >= detail.top(),
        "Save must fit inside the detail viewport"
    );
    assert!(
        save.bottom() <= detail.bottom(),
        "Save must scroll above the footer, got {save:?}"
    );
    eprintln!(
        "900x600 after scrolling history={history:?} first_check_before={check_before:?} first_check_after={check_after:?} save={save:?}"
    );
    cx.simulate_click(save.center(), Modifiers::none());
    cx.read(|cx| {
        let operator = view.read(cx);
        let (_, case_id, text) = operator
            .pending_note
            .as_ref()
            .expect("Save click must reach the note handler");
        assert_eq!(case_id, &case.id);
        assert_eq!(text, &draft);
        assert_eq!(operator.notice, "Saving note…");
    });

    for (width, height) in [(1200.0, 820.0), (700.0, 480.0), (900.0, 600.0)] {
        cx.simulate_resize(size(px(width), px(height)));
        draw(cx);
        let detail = cx.debug_bounds("detail").unwrap();
        let footer = cx.debug_bounds("footer").unwrap();
        assert!(detail.bottom() <= footer.top());
        assert!(cx.debug_bounds("history").unwrap().size.height >= px(120.0));
        let scroll_position = point(detail.right() - px(2.0), detail.center().y);
        for selector in ["case-metadata", "continue", "history", "save-note"] {
            let bounds = cx.debug_bounds(selector).unwrap();
            let delta = f32::from(detail.center().y - bounds.center().y);
            scroll(cx, scroll_position, delta);
            let bounds = cx.debug_bounds(selector).unwrap();
            assert!(
                bounds.top() >= detail.top() && bounds.bottom() <= detail.bottom(),
                "{selector} must be reachable after resizing to {width}x{height}, got {bounds:?} in {detail:?}"
            );
        }
    }
}

fn editor_index(
    view: &Entity<Operator>,
    cx: &mut VisualTestContext,
    position: Point<Pixels>,
) -> usize {
    cx.update(|window, cx| {
        let input = view.read(cx).input.clone();
        input.update(cx, |input, cx| {
            input
                .character_index_for_point(position, window, cx)
                .unwrap()
        })
    })
}

fn assert_inner_wheel_ownership(cx: &mut TestAppContext, selector: &'static str, delta: f32) {
    let directory = PrivateDirectory::new();
    let (_, draft, view, cx) = paused_detail(cx, &directory);
    cx.simulate_resize(size(px(900.0), px(600.0)));
    draw(cx);
    let detail = cx.debug_bounds("detail").unwrap();
    let margin = point(detail.right() - px(2.0), detail.center().y);
    let top = cx.debug_bounds("case-metadata").unwrap().top();
    scroll(cx, margin, -10_000.0);
    let bottom = cx.debug_bounds("case-metadata").unwrap().top();
    let travel = top - bottom;
    assert!(travel > px(88.0), "outer scroller must have room both ways");
    scroll(cx, margin, f32::from(travel / 2.0));
    let midpoint = cx.debug_bounds("case-metadata").unwrap();
    scroll(cx, margin, 22.0);
    assert_eq!(
        cx.debug_bounds("case-metadata").unwrap().top(),
        midpoint.top() + px(22.0)
    );
    scroll(cx, margin, -44.0);
    assert_eq!(
        cx.debug_bounds("case-metadata").unwrap().top(),
        midpoint.top() - px(22.0)
    );
    scroll(cx, margin, 22.0);

    let inner = cx.debug_bounds(selector).unwrap();
    let position = point(
        inner.center().x,
        (inner.top().max(detail.top()) + inner.bottom().min(detail.bottom())) / 2.0,
    );
    assert!(inner.contains(&position) && detail.contains(&position));
    scroll(cx, position, -200.0);
    let shifted = cx.debug_bounds("case-metadata").unwrap();
    scroll(cx, margin, f32::from(midpoint.top() - shifted.top()));
    assert_eq!(cx.debug_bounds("case-metadata").unwrap(), midpoint);
    assert!(top - midpoint.top() > px(delta.abs()));
    assert!(midpoint.top() - bottom > px(delta.abs()));

    let history = cx.debug_bounds("history").unwrap();
    let editor = cx.debug_bounds("note-input").unwrap();
    let check = cx.debug_bounds("check-check-0").unwrap();
    let index = editor_index(&view, cx, position);
    scroll(cx, position, delta);
    let check_after = cx.debug_bounds("check-check-0").unwrap();
    let index_after = editor_index(&view, cx, position);
    eprintln!(
        "{selector} delta={delta} outer_before={midpoint:?} outer_after={:?} check_before={check:?} check_after={check_after:?} editor_index={index}->{index_after}",
        cx.debug_bounds("case-metadata").unwrap()
    );
    assert_eq!(cx.debug_bounds("detail").unwrap(), detail);
    assert_eq!(
        cx.debug_bounds("case-metadata").unwrap(),
        midpoint,
        "{selector} wheel must not scroll the outer detail in either direction"
    );
    assert_eq!(cx.debug_bounds("history").unwrap(), history);
    assert_eq!(cx.debug_bounds("note-input").unwrap(), editor);
    if selector == "history" {
        assert_eq!(check_after.top(), check.top() + px(delta));
    } else {
        let line_units = draft.lines().next().unwrap().encode_utf16().count() + 1;
        assert_eq!(
            index_after as isize,
            index as isize - (delta / 22.0) as isize * line_units as isize
        );
        assert_eq!(check_after, check);
    }

    for edge in [10_000.0, -10_000.0] {
        scroll(cx, position, edge);
        let check_at_edge = cx.debug_bounds("check-check-0").unwrap();
        let index_at_edge = editor_index(&view, cx, position);
        scroll(cx, position, edge);
        assert_eq!(
            cx.debug_bounds("case-metadata").unwrap(),
            midpoint,
            "{selector} owns wheel events even at a clamped edge"
        );
        assert_eq!(cx.debug_bounds("history").unwrap(), history);
        assert_eq!(cx.debug_bounds("note-input").unwrap(), editor);
        assert_eq!(cx.debug_bounds("check-check-0").unwrap(), check_at_edge);
        assert_eq!(editor_index(&view, cx, position), index_at_edge);
    }
    scroll(cx, margin, 22.0);
    assert_eq!(
        cx.debug_bounds("case-metadata").unwrap().top(),
        midpoint.top() + px(22.0)
    );
    scroll(cx, margin, -44.0);
    assert_eq!(
        cx.debug_bounds("case-metadata").unwrap().top(),
        midpoint.top() - px(22.0)
    );
    assert_eq!(cx.debug_bounds("detail").unwrap(), detail);
    assert_eq!(cx.read(|cx| view.read(cx).input.read(cx).text()), draft);
}

#[gpui::test]
fn history_wheel_down_does_not_scroll_detail(cx: &mut TestAppContext) {
    assert_inner_wheel_ownership(cx, "history", -44.0);
}

#[gpui::test]
fn history_wheel_up_does_not_scroll_detail(cx: &mut TestAppContext) {
    assert_inner_wheel_ownership(cx, "history", 44.0);
}

#[gpui::test]
fn editor_wheel_down_does_not_scroll_detail(cx: &mut TestAppContext) {
    assert_inner_wheel_ownership(cx, "note-input", -44.0);
}

#[gpui::test]
fn editor_wheel_up_does_not_scroll_detail(cx: &mut TestAppContext) {
    assert_inner_wheel_ownership(cx, "note-input", 44.0);
}
