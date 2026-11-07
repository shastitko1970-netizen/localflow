use crate::error::AppResult;
use crate::paths::dictionary_path;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Dictionary {
    pub words: Vec<DictEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictEntry {
    pub from: String,
    pub to: String,
}

pub fn load_dictionary() -> Dictionary {
    match fs::read_to_string(dictionary_path()) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Dictionary::default(),
    }
}

pub fn save_dictionary(dict: &Dictionary) -> AppResult<()> {
    fs::write(dictionary_path(), serde_json::to_string_pretty(dict)?)?;
    Ok(())
}

pub fn apply_dictionary(text: &str, dict: &Dictionary) -> String {
    let mut out = text.to_string();
    for e in &dict.words {
        if e.from.is_empty() {
            continue;
        }
        // case-insensitive replace of whole-ish tokens
        let lower = out.to_lowercase();
        let needle = e.from.to_lowercase();
        if let Some(idx) = lower.find(&needle) {
            out.replace_range(idx..idx + e.from.len(), &e.to);
        }
    }
    out
}
