use crate::error::AppResult;
use crate::paths::snippets_path;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snippets {
    pub items: Vec<Snippet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub trigger: String,
    pub expansion: String,
}

pub fn load_snippets() -> Snippets {
    match fs::read_to_string(snippets_path()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Snippets::default(),
    }
}

pub fn save_snippets(snips: &Snippets) -> AppResult<()> {
    fs::write(snippets_path(), serde_json::to_string_pretty(snips)?)?;
    Ok(())
}

pub fn apply_snippets(text: &str, snips: &Snippets) -> String {
    let mut out = text.to_string();
    for s in &snips.items {
        if s.trigger.is_empty() {
            continue;
        }
        out = out.replace(&s.trigger, &s.expansion);
    }
    out
}
