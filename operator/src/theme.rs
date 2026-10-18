#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatusInk {
    Neutral,
    Active,
    Paused,
    Attention,
    Handoff,
    Positive,
    Negative,
}

impl StatusInk {
    pub fn for_session(status: &str) -> Self {
        match status {
            "provisioning" | "running" => Self::Active,
            "pause-requested" | "paused" => Self::Paused,
            "needs-attention" => Self::Attention,
            "awaiting-merge" => Self::Handoff,
            _ => Self::Neutral,
        }
    }

    pub fn for_check(passed: bool) -> Self {
        if passed {
            Self::Positive
        } else {
            Self::Negative
        }
    }
}

pub struct Theme {
    pub canvas: u32,
    pub sidebar: u32,
    pub surface: u32,
    pub input: u32,
    pub text: u32,
    pub muted: u32,
    pub border: u32,
    pub accent: u32,
    pub selection: u32,
    pub focus: u32,
    pub on_accent: u32,
    pub hover: u32,
    pub warning: u32,
    pub danger: u32,
    pub editor_selection: u32,
    pub caret: u32,
    pub neutral_ink: u32,
    pub active_ink: u32,
    pub paused_ink: u32,
    pub attention_ink: u32,
    pub handoff_ink: u32,
    pub positive_ink: u32,
    pub negative_ink: u32,
    pub body_family: &'static str,
    pub mono_family: &'static str,
    pub body_size: f32,
    pub heading_size: f32,
    pub metadata_size: f32,
    pub editor_line_height: f32,
    pub sidebar_width: f32,
    pub header_height: f32,
    pub footer_height: f32,
    pub detail_padding: f32,
    pub gap: f32,
    pub radius: f32,
    pub control_height: f32,
}

impl Theme {
    pub fn status_color(&self, ink: StatusInk) -> u32 {
        match ink {
            StatusInk::Neutral => self.neutral_ink,
            StatusInk::Active => self.active_ink,
            StatusInk::Paused => self.paused_ink,
            StatusInk::Attention => self.attention_ink,
            StatusInk::Handoff => self.handoff_ink,
            StatusInk::Positive => self.positive_ink,
            StatusInk::Negative => self.negative_ink,
        }
    }
}

pub const THEME: Theme = Theme {
    canvas: 0x171a1c,
    sidebar: 0x1e2225,
    surface: 0x262b2e,
    input: 0x131719,
    text: 0xf2eee7,
    muted: 0xb5b3ac,
    border: 0x454b4d,
    accent: 0xd69a70,
    selection: 0x3b3029,
    focus: 0xd69a70,
    on_accent: 0x171a1c,
    hover: 0x343b3f,
    warning: 0x342e24,
    danger: 0x463334,
    editor_selection: 0x4c4037,
    caret: 0xd69a70,
    neutral_ink: 0xb5b3ac,
    active_ink: 0x8bbbd5,
    paused_ink: 0xd6bb7a,
    attention_ink: 0xf0b169,
    handoff_ink: 0xbdb0e1,
    positive_ink: 0x96c4a8,
    negative_ink: 0xef9d96,
    body_family: "Helvetica Neue",
    mono_family: "Menlo",
    body_size: 14.0,
    heading_size: 20.0,
    metadata_size: 12.0,
    editor_line_height: 22.0,
    sidebar_width: 304.0,
    header_height: 64.0,
    footer_height: 32.0,
    detail_padding: 24.0,
    gap: 16.0,
    radius: 6.0,
    control_height: 34.0,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn luminance(color: u32) -> f64 {
        let channels = [color >> 16, color >> 8, color].map(|c| {
            let c = f64::from(c & 255) / 255.0;
            if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        });
        channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }

    fn contrast(foreground: u32, background: u32) -> f64 {
        let a = luminance(foreground);
        let b = luminance(background);
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    #[test]
    fn workshop_text_meets_wcag_aa_contrast() {
        for background in [
            THEME.canvas,
            THEME.sidebar,
            THEME.surface,
            THEME.input,
            THEME.selection,
            THEME.hover,
            THEME.warning,
            THEME.danger,
        ] {
            for foreground in [THEME.text, THEME.muted, THEME.accent].into_iter().chain(
                [
                    StatusInk::Neutral,
                    StatusInk::Active,
                    StatusInk::Paused,
                    StatusInk::Attention,
                    StatusInk::Handoff,
                    StatusInk::Positive,
                    StatusInk::Negative,
                ]
                .map(|ink| THEME.status_color(ink)),
            ) {
                let ratio = contrast(foreground, background);
                assert!(
                    ratio >= 4.5,
                    "{foreground:06x} on {background:06x}: {ratio:.2}:1"
                );
            }
        }
        assert!(contrast(THEME.text, THEME.editor_selection) >= 4.5);
        assert!(contrast(THEME.on_accent, THEME.accent) >= 4.5);
        assert!(contrast(THEME.focus, THEME.input) >= 3.0);
        assert!(contrast(THEME.caret, THEME.editor_selection) >= 3.0);
    }

    #[test]
    fn session_status_never_implies_a_passed_check() {
        for (status, expected) in [
            ("queued", StatusInk::Neutral),
            ("terminal", StatusInk::Neutral),
            ("unknown", StatusInk::Neutral),
            ("provisioning", StatusInk::Active),
            ("running", StatusInk::Active),
            ("pause-requested", StatusInk::Paused),
            ("paused", StatusInk::Paused),
            ("needs-attention", StatusInk::Attention),
            ("awaiting-merge", StatusInk::Handoff),
        ] {
            assert_eq!(StatusInk::for_session(status), expected);
        }
        assert_eq!(THEME.status_color(StatusInk::for_check(true)), 0x96c4a8);
        assert_eq!(THEME.status_color(StatusInk::for_check(false)), 0xef9d96);
    }
}
