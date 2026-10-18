use crate::theme::THEME;
use gpui::{prelude::*, *};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

actions!(
    note_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        Up,
        Down,
        Newline,
        Paste,
        Copy,
        Cut
    ]
);

#[derive(Default)]
struct Buffer {
    text: String,
    selection: Range<usize>,
    anchor: usize,
    marked: Option<Range<usize>>,
}
impl Buffer {
    fn cursor(&self) -> usize {
        if self.anchor == self.selection.end {
            self.selection.start
        } else {
            self.selection.end
        }
    }
    fn select(&mut self, offset: usize, extend: bool) {
        if !extend {
            self.anchor = offset;
        }
        self.selection = self.anchor.min(offset)..self.anchor.max(offset);
    }
    fn utf16_to_byte(&self, offset: usize) -> usize {
        let mut units = 0;
        for (index, ch) in self.text.char_indices() {
            if units >= offset {
                return index;
            }
            units += ch.len_utf16();
        }
        self.text.len()
    }
    fn to_utf16(&self, offset: usize) -> usize {
        self.text[..offset].encode_utf16().count()
    }
    fn range(&self, range: Range<usize>) -> Range<usize> {
        self.utf16_to_byte(range.start)..self.utf16_to_byte(range.end)
    }
    fn utf16(&self, range: Range<usize>) -> Range<usize> {
        self.to_utf16(range.start)..self.to_utf16(range.end)
    }
    fn replace(&mut self, range: Option<Range<usize>>, text: &str) -> bool {
        let range = range
            .map(|r| self.range(r))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        if self.text.len() - (range.end - range.start) + text.len() > 16000 {
            return false;
        }
        self.text.replace_range(range.clone(), text);
        self.marked = None;
        self.select(range.start + text.len(), false);
        true
    }
    fn previous(&self) -> usize {
        self.text
            .grapheme_indices(true)
            .rev()
            .find(|(i, _)| *i < self.cursor())
            .map(|(i, _)| i)
            .unwrap_or(0)
    }
    fn next(&self) -> usize {
        self.text
            .grapheme_indices(true)
            .find(|(i, _)| *i > self.cursor())
            .map(|(i, _)| i)
            .unwrap_or(self.text.len())
    }
    fn vertical(&self, down: bool) -> usize {
        let cursor = self.cursor();
        let start = self.text[..cursor].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let column = self.text[start..cursor].chars().count();
        let target = if down {
            self.text[cursor..].find('\n').map(|i| cursor + i + 1)
        } else {
            start
                .checked_sub(1)
                .map(|end| self.text[..end].rfind('\n').map(|i| i + 1).unwrap_or(0))
        };
        target
            .map(|start| {
                let line = self.text[start..].split('\n').next().unwrap();
                start
                    + line
                        .char_indices()
                        .nth(column)
                        .map(|(i, _)| i)
                        .unwrap_or(line.len())
            })
            .unwrap_or(cursor)
    }
}

pub struct NoteInput {
    buffer: Buffer,
    focus: FocusHandle,
    lines: Vec<ShapedLine>,
    bounds: Option<Bounds<Pixels>>,
    selecting: bool,
}
impl NoteInput {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            buffer: Buffer::default(),
            focus: cx.focus_handle(),
            lines: vec![],
            bounds: None,
            selecting: false,
        }
    }
    pub fn text(&self) -> String {
        self.buffer.text.clone()
    }
    pub fn set_text(&mut self, text: String, cx: &mut Context<Self>) {
        self.buffer = Buffer::default();
        self.buffer.replace(None, &text);
        cx.notify();
    }
    pub fn clear_if(&mut self, submitted: &str, cx: &mut Context<Self>) {
        if self.buffer.text == submitted {
            self.buffer = Buffer::default();
            cx.notify();
        }
    }
    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        let i = if self.buffer.selection.is_empty() {
            self.buffer.previous()
        } else {
            self.buffer.selection.start
        };
        self.buffer.select(i, false);
        cx.notify();
    }
    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        let i = if self.buffer.selection.is_empty() {
            self.buffer.next()
        } else {
            self.buffer.selection.end
        };
        self.buffer.select(i, false);
        cx.notify();
    }
    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(self.buffer.previous(), true);
        cx.notify();
    }
    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(self.buffer.next(), true);
        cx.notify();
    }
    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.anchor = 0;
        self.buffer.selection = 0..self.buffer.text.len();
        cx.notify();
    }
    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(0, false);
        cx.notify();
    }
    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(self.buffer.text.len(), false);
        cx.notify();
    }
    fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(self.buffer.vertical(false), false);
        cx.notify();
    }
    fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        self.buffer.select(self.buffer.vertical(true), false);
        cx.notify();
    }
    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.buffer.selection.is_empty() {
            self.buffer.select(self.buffer.previous(), true);
        }
        self.replace_text_in_range(None, "", window, cx);
    }
    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.buffer.selection.is_empty() {
            self.buffer.select(self.buffer.next(), true);
        }
        self.replace_text_in_range(None, "", window, cx);
    }
    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        self.replace_text_in_range(None, "\n", window, cx);
    }
    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &text.replace("\r\n", "\n"), window, cx);
        }
    }
    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.buffer.selection.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.buffer.text[self.buffer.selection.clone()].to_owned(),
            ));
        }
    }
    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        self.copy(&Copy, window, cx);
        self.replace_text_in_range(None, "", window, cx);
    }
    fn index(&self, position: Point<Pixels>) -> usize {
        let Some(bounds) = self.bounds else {
            return 0;
        };
        let line = (((position.y - bounds.top()) / px(THEME.editor_line_height)).max(0.0) as usize)
            .min(self.lines.len().saturating_sub(1));
        let offset: usize = self
            .buffer
            .text
            .split('\n')
            .take(line)
            .map(|s| s.len() + 1)
            .sum();
        offset
            + self
                .lines
                .get(line)
                .map(|l| {
                    l.closest_index_for_x(position.x - bounds.left())
                        .min(l.text.len())
                })
                .unwrap_or(0)
    }
    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus);
        self.selecting = true;
        self.buffer
            .select(self.index(event.position), event.modifiers.shift);
        cx.notify();
    }
    fn mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.selecting {
            self.buffer.select(self.index(event.position), true);
            cx.notify();
        }
    }
    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
    }
}
impl Focusable for NoteInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl EntityInputHandler for NoteInput {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.buffer.range(range);
        *actual = Some(self.buffer.utf16(range.clone()));
        Some(self.buffer.text[range].to_owned())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.buffer.utf16(self.buffer.selection.clone()),
            reversed: self.buffer.anchor == self.buffer.selection.end,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.buffer.marked.clone().map(|r| self.buffer.utf16(r))
    }
    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.buffer.marked = None;
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.buffer.replace(range, text);
        cx.notify();
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selection: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let start = range
            .clone()
            .map(|r| self.buffer.range(r).start)
            .or(self.buffer.marked.as_ref().map(|r| r.start))
            .unwrap_or(self.buffer.selection.start);
        if !self.buffer.replace(range, text) {
            return;
        }
        if !text.is_empty() {
            self.buffer.marked = Some(start..start + text.len());
        }
        if let Some(range) = selection {
            let prefix = self.buffer.to_utf16(start);
            self.buffer.selection = self.buffer.range(prefix + range.start..prefix + range.end);
            self.buffer.anchor = self.buffer.selection.start;
        }
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.buffer.range(range);
        let index = self.buffer.text[..range.start].matches('\n').count();
        let start = self.buffer.text[..range.start]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        let line = self.lines.get(index)?;
        Some(Bounds::new(
            point(
                bounds.left() + line.x_for_index(range.start - start),
                bounds.top() + px(index as f32 * THEME.editor_line_height),
            ),
            size(px(2.0), px(THEME.editor_line_height)),
        ))
    }
    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(self.buffer.to_utf16(self.index(position)))
    }
}
struct InputElement {
    entity: Entity<NoteInput>,
}
struct Paint {
    lines: Vec<ShapedLine>,
    selections: Vec<PaintQuad>,
    cursor: Option<PaintQuad>,
}
impl IntoElement for InputElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for InputElement {
    type RequestLayoutState = ();
    type PrepaintState = Paint;
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.0).into();
        style.size.height = px(
            self.entity.read(cx).buffer.text.split('\n').count().max(5) as f32
                * THEME.editor_line_height,
        )
        .into();
        (window.request_layout(style, [], cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Paint {
        let input = self.entity.read(cx);
        let buffer = &input.buffer;
        let style = window.text_style();
        let mut lines = vec![];
        let mut selections = vec![];
        let mut caret = None;
        let mut start = 0;
        for (index, text) in buffer.text.split('\n').enumerate() {
            let run = TextRun {
                len: text.len(),
                font: style.font(),
                color: style.color,
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            let line = window.text_system().shape_line(
                text.to_owned().into(),
                style.font_size.to_pixels(window.rem_size()),
                &[run],
                None,
            );
            let y = bounds.top() + px(index as f32 * THEME.editor_line_height);
            let end = start + text.len();
            if !buffer.selection.is_empty()
                && buffer.selection.start <= end
                && buffer.selection.end > start
            {
                let left =
                    line.x_for_index(buffer.selection.start.saturating_sub(start).min(text.len()));
                let right =
                    line.x_for_index(buffer.selection.end.saturating_sub(start).min(text.len()));
                selections.push(fill(
                    Bounds::new(
                        point(bounds.left() + left, y),
                        size((right - left).max(px(3.0)), px(THEME.editor_line_height)),
                    ),
                    rgb(THEME.editor_selection),
                ));
            }
            if buffer.cursor() >= start && buffer.cursor() <= end {
                caret = Some(fill(
                    Bounds::new(
                        point(bounds.left() + line.x_for_index(buffer.cursor() - start), y),
                        size(px(2.0), px(THEME.editor_line_height)),
                    ),
                    rgb(THEME.caret),
                ));
            }
            lines.push(line);
            start = end + 1;
        }
        Paint {
            lines,
            selections,
            cursor: caret,
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        state: &mut Paint,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.entity.read(cx).focus.clone();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.entity.clone()),
            cx,
        );
        for selection in state.selections.drain(..) {
            window.paint_quad(selection);
        }
        for (index, line) in state.lines.iter().enumerate() {
            let _ = line.paint(
                point(
                    bounds.left(),
                    bounds.top() + px(index as f32 * THEME.editor_line_height),
                ),
                px(THEME.editor_line_height),
                window,
                cx,
            );
        }
        if focus.is_focused(window)
            && let Some(caret) = state.cursor.take()
        {
            window.paint_quad(caret);
        }
        self.entity.update(cx, |input, _| {
            input.lines = std::mem::take(&mut state.lines);
            input.bounds = Some(bounds);
        });
    }
}
impl Render for NoteInput {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("note-input")
            .debug_selector(|| "note-input".into())
            .key_context("NoteInput")
            .track_focus(&self.focus)
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .w_full()
            .min_h(px(110.0))
            .max_h(px(154.0))
            .flex_shrink_0()
            .overflow_scroll()
            .p_3()
            .bg(rgb(THEME.input))
            .border_1()
            .border_color(rgb(THEME.border))
            .focus(|s| s.border_color(rgb(THEME.focus)))
            .rounded(px(THEME.radius))
            .font_family(THEME.body_family)
            .text_color(rgb(THEME.text))
            .text_size(px(THEME.body_size))
            .line_height(px(THEME.editor_line_height))
            .child(InputElement {
                entity: cx.entity(),
            })
    }
}
pub fn bind(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some("NoteInput")),
        KeyBinding::new("delete", Delete, Some("NoteInput")),
        KeyBinding::new("left", Left, Some("NoteInput")),
        KeyBinding::new("right", Right, Some("NoteInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("NoteInput")),
        KeyBinding::new("shift-right", SelectRight, Some("NoteInput")),
        KeyBinding::new("up", Up, Some("NoteInput")),
        KeyBinding::new("down", Down, Some("NoteInput")),
        KeyBinding::new("cmd-a", SelectAll, Some("NoteInput")),
        KeyBinding::new("cmd-c", Copy, Some("NoteInput")),
        KeyBinding::new("cmd-v", Paste, Some("NoteInput")),
        KeyBinding::new("cmd-x", Cut, Some("NoteInput")),
        KeyBinding::new("cmd-left", Home, Some("NoteInput")),
        KeyBinding::new("cmd-right", End, Some("NoteInput")),
        KeyBinding::new("enter", Newline, Some("NoteInput")),
    ]);
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn native_handler_keyboard_clipboard_and_multiline(cx: &mut TestAppContext) {
        cx.update(bind);
        let (view, cx) = cx.add_window_view(|window, cx| {
            let input = NoteInput::new(cx);
            window.focus(&input.focus);
            input
        });
        cx.simulate_input("Hello 👩‍💻");
        cx.simulate_keystrokes("enter");
        cx.simulate_input("Second line 🦀");
        let expected = "Hello 👩‍💻\nSecond line 🦀";
        assert_eq!(cx.read(|cx| view.read(cx).text()), expected);
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert_eq!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .as_deref(),
            Some(expected)
        );
        cx.simulate_keystrokes("cmd-x");
        assert_eq!(cx.read(|cx| view.read(cx).text()), "");
        cx.simulate_keystrokes("cmd-v");
        assert_eq!(cx.read(|cx| view.read(cx).text()), expected);
        cx.simulate_keystrokes("shift-left backspace");
        assert_eq!(cx.read(|cx| view.read(cx).text()), "Hello 👩‍💻\nSecond line ");
    }
    #[::core::prelude::v1::test]
    fn unicode_selection_multiline_and_ime_ranges() {
        let mut b = Buffer::default();
        b.replace(None, "A👩‍💻\ne\u{301} 🦀");
        assert_eq!(b.utf16_to_byte(b.to_utf16(b.text.len())), b.text.len());
        b.select(1 + "👩‍💻".len(), false);
        assert_eq!(b.previous(), 1);
        b.select(b.text.len(), false);
        b.select(b.previous(), true);
        b.replace(None, "");
        assert_eq!(b.text, "A👩‍💻\ne\u{301} ");
        b.selection = 0..1;
        b.replace(Some(0..1), "é");
        assert!(b.text.starts_with('é'));
        b.select(0, false);
        let down = b.vertical(true);
        assert_eq!(&b.text[down..], "e\u{301} ");
    }
}
