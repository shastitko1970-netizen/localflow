use crate::dictionary::{apply_dictionary, load_dictionary};
use crate::snippets::{apply_snippets, load_snippets};
use once_cell::sync::Lazy;
use regex::Regex;

static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
static FILLERS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(um+|uh+|er+|ah+|hmm+|типа|как бы|ну+|ээ+|эм+)\b[,.]?").unwrap()
});

/// Lightweight offline cleanup (Phase B). No cloud.
pub fn cleanup_text(raw: &str, level: &str, apply_dict: bool) -> String {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return text;
    }

    if let Some(idx) = find_correction_pivot(&text) {
        text = text[idx..].trim().to_string();
    }

    if level != "off" {
        text = FILLERS.replace_all(&text, " ").to_string();
    }

    text = text.replace(" ,", ",").replace(" .", ".");
    text = MULTI_SPACE.replace_all(&text, " ").to_string();

    if level == "medium" || level == "high" {
        text = capitalize_sentences(&text);
    }

    if apply_dict {
        let dict = load_dictionary();
        text = apply_dictionary(&text, &dict);
        let snips = load_snippets();
        text = apply_snippets(&text, &snips);
    }

    text.trim().to_string()
}

fn find_correction_pivot(text: &str) -> Option<usize> {
    let markers = [" actually ", " no, ", " wait, ", " i mean ", " точнее ", " нет, "];
    let lower = text.to_lowercase();
    markers
        .iter()
        .filter_map(|m| lower.rfind(m).map(|i| i + m.len()))
        .max()
}

fn capitalize_sentences(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut capitalize = true;
    for ch in input.chars() {
        if capitalize && ch.is_alphabetic() {
            for c in ch.to_uppercase() {
                out.push(c);
            }
            capitalize = false;
        } else {
            out.push(ch);
            if matches!(ch, '.' | '!' | '?' | '\n') {
                capitalize = true;
            }
        }
    }
    out
}

/// Offline command-mode heuristics (Phase B).
pub fn apply_command(instruction: &str, selected: &str) -> String {
    let instr = instruction.to_lowercase();
    if instr.contains("upper") || instr.contains("заглав") {
        return selected.to_uppercase();
    }
    if instr.contains("lower") || instr.contains("строчн") {
        return selected.to_lowercase();
    }
    if instr.contains("bullet") || instr.contains("список") {
        return selected
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| format!("- {l}"))
            .collect::<Vec<_>>()
            .join("\n");
    }
    if instr.contains("shorten") || instr.contains("короче") {
        let words: Vec<&str> = selected.split_whitespace().collect();
        let keep = words.len() / 2 + 1;
        return words.into_iter().take(keep).collect::<Vec<_>>().join(" ");
    }
    if selected.is_empty() {
        instruction.to_string()
    } else {
        format!("{selected}\n\n({instruction})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_fillers_and_spaces() {
        let out = cleanup_text("um hello  world uh", "medium", false);
        assert!(out.to_lowercase().contains("hello"));
        assert!(!out.to_lowercase().contains("uh"));
    }

    #[test]
    fn command_upper() {
        assert_eq!(apply_command("make upper", "Hi"), "HI");
    }

    #[test]
    fn command_bullets() {
        let out = apply_command("make bullet list", "one\ntwo");
        assert!(out.contains("- one"));
        assert!(out.contains("- two"));
    }

    #[test]
    fn correction_pivot() {
        let out = cleanup_text("meet at 5 actually 6pm", "medium", false);
        assert!(out.to_lowercase().contains("6pm"));
    }
}
