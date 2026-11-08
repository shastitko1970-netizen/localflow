use crate::error::{AppError, AppResult};
use crate::paths::settings_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub model_id: String,
    pub language: String,
    pub push_to_talk: String,
    pub hands_free: String,
    pub command_mode: String,
    pub auto_paste: bool,
    pub auto_cleanup: bool,
    pub cleanup_level: String,
    pub mcp_port: u16,
    pub mcp_enabled: bool,
    pub input_device: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model_id: "ggml-base.bin".into(),
            language: "auto".into(),
            push_to_talk: "Ctrl+Super+Space".into(),
            hands_free: "Ctrl+Shift+Super+Space".into(),
            command_mode: "Ctrl+Alt+Super+Space".into(),
            auto_paste: true,
            auto_cleanup: true,
            cleanup_level: "medium".into(),
            mcp_port: 17832,
            mcp_enabled: true,
            input_device: None,
        }
    }
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => {
            let s = AppSettings::default();
            let _ = save_settings(&s);
            s
        }
    }
}

pub fn save_settings(settings: &AppSettings) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(settings_path(), raw)?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    label: String,
    size_bytes: u64,
    installed: bool,
    recommended: bool,
}

const CATALOG: &[(&str, &str, u64)] = &[
    ("ggml-tiny.bin", "Tiny", 77_691_713),
    ("ggml-base-q5_1.bin", "Base Q5 (compact)", 59_707_625),
    ("ggml-base.bin", "Base (balanced)", 147_951_465),
    ("ggml-small.bin", "Small", 487_601_967),
    ("ggml-medium.bin", "Medium", 1_533_763_059),
    (
        "ggml-large-v3-turbo-q5_0.bin",
        "Large V3 Turbo Q5",
        574_041_195,
    ),
];

pub fn list_models() -> AppResult<Vec<ModelInfo>> {
    let dir = crate::paths::models_dir();
    let mut models: Vec<_> = CATALOG
        .iter()
        .map(|&(id, label, size)| ModelInfo {
            id: id.into(),
            label: label.into(),
            size_bytes: size,
            installed: valid_model(&dir.join(id), Some(size)).unwrap_or(false),
            recommended: true,
        })
        .collect();
    let mut imported = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name.to_str() else { continue };
        let Some(label) = imported_label(id) else {
            continue;
        };
        if entry.file_type()?.is_file() && valid_model(&entry.path(), None).unwrap_or(false) {
            imported.push(ModelInfo {
                id: id.into(),
                label: label.into(),
                size_bytes: entry.metadata()?.len(),
                installed: true,
                recommended: false,
            });
        }
    }
    imported.sort_by(|a, b| a.label.cmp(&b.label));
    models.extend(imported);
    Ok(models)
}

fn imported_label(id: &str) -> Option<&str> {
    let (uuid, filename) = id.strip_prefix("hf-")?.split_once('_')?;
    uuid::Uuid::parse_str(uuid).ok()?;
    (filename.ends_with(".bin")
        && filename.len() <= 150
        && filename
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)))
    .then_some(filename)
}

fn valid_model(path: &std::path::Path, expected_size: Option<u64>) -> std::io::Result<bool> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let mut magic = [0; 4];
    Ok(size >= 1024
        && expected_size.is_none_or(|expected| size == expected)
        && file.read_exact(&mut magic).is_ok()
        && u32::from_le_bytes(magic) == 0x6767_6d6c)
}

pub fn model_path(id: &str) -> AppResult<std::path::PathBuf> {
    if CATALOG.iter().any(|&(known, _, _)| known == id) || imported_label(id).is_some() {
        return Ok(crate::paths::models_dir().join(id));
    }
    Err(AppError::msg("Choose a model in Settings > Models."))
}

pub fn ensure_model(id: &str) -> AppResult<std::path::PathBuf> {
    let dest = model_path(id)?;
    let size = CATALOG
        .iter()
        .find(|&&(known, _, _)| known == id)
        .map(|entry| entry.2);
    if valid_model(&dest, size).unwrap_or(false) {
        return Ok(dest);
    }
    let size = size
        .ok_or_else(|| AppError::msg("Imported model is missing or damaged. Import it again."))?;
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{id}");
    download_model(&url, &dest, Some(size), |_| Ok(()))?;
    Ok(dest)
}

pub fn import_model(input: &str) -> AppResult<()> {
    let mut url = reqwest::Url::parse(input.trim())
        .map_err(|_| AppError::msg("Paste a Hugging Face model file link."))?;
    if url.scheme() != "https"
        || url.host_str() != Some("huggingface.co")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(AppError::msg(
            "Use a public https://huggingface.co model file link.",
        ));
    }
    let parts: Vec<_> = url.path_segments().into_iter().flatten().collect();
    if parts.len() < 5 || !matches!(parts[2], "blob" | "resolve") {
        return Err(AppError::msg(
            "Open the .bin file on Hugging Face and copy its link.",
        ));
    }
    let id = format!("hf-{}_{}", uuid::Uuid::new_v4(), parts[parts.len() - 1]);
    let dest = model_path(&id)
        .map_err(|_| AppError::msg("Choose a Whisper GGML .bin file with a standard filename."))?;
    let path = format!(
        "/{}/{}/resolve/{}",
        parts[0],
        parts[1],
        parts[3..].join("/")
    );
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    download_model(url.as_str(), &dest, None, |file| {
        crate::stt::load_context(file)?;
        Ok(())
    })
}

fn download_model(
    url: &str,
    dest: &std::path::Path,
    expected_size: Option<u64>,
    validate: impl FnOnce(&std::path::Path) -> AppResult<()>,
) -> AppResult<()> {
    const MAX_IMPORT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
    let temporary = dest.with_extension("bin.part");
    let result = (|| {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(1800))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                let trusted = url.scheme() == "https"
                    && url.host_str().is_some_and(|host| {
                        host == "huggingface.co"
                            || host.ends_with(".huggingface.co")
                            || host.ends_with(".hf.co")
                    });
                if trusted && attempt.previous().len() < 10 {
                    attempt.follow()
                } else {
                    attempt.error("Unexpected model download redirect")
                }
            }))
            .build()
            .map_err(|error| AppError::msg(format!("Model download: {error}")))?;
        let response = client
            .get(url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| AppError::msg(format!("Model download: {error}")))?;
        let limit = expected_size.unwrap_or(MAX_IMPORT_BYTES);
        let content_length = response.content_length();
        if content_length.is_some_and(|size| size > limit) {
            return Err(AppError::msg("Model exceeds the expected download size."));
        }
        let mut response = response.take(limit + 1);
        let mut magic = [0; 4];
        if response.read_exact(&mut magic).is_err() || u32::from_le_bytes(magic) != 0x6767_6d6c {
            return Err(AppError::msg("This file is not a Whisper GGML model."));
        }
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&magic)?;
        let written = std::io::copy(&mut response, &mut file)? + 4;
        file.sync_all()?;
        drop(file);
        if written > limit || !valid_model(&temporary, expected_size.or(content_length))? {
            return Err(AppError::msg("Model download is incomplete or invalid."));
        }
        validate(&temporary)?;
        fs::rename(&temporary, dest)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
