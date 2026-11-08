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

pub fn update_settings(patch: AppSettings) -> AppResult<AppSettings> {
    save_settings(&patch)?;
    Ok(patch)
}

pub fn known_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "ggml-tiny.bin".into(),
            label: "Tiny (~75 MB) — fastest".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin".into(),
            size_hint_mb: 75,
        },
        ModelInfo {
            id: "ggml-base.bin".into(),
            label: "Base (~142 MB) — recommended".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".into(),
            size_hint_mb: 142,
        },
        ModelInfo {
            id: "ggml-small.bin".into(),
            label: "Small (~466 MB) — better accuracy".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".into(),
            size_hint_mb: 466,
        },
        ModelInfo {
            id: "ggml-medium.bin".into(),
            label: "Medium (~1.5 GB) — high accuracy".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".into(),
            size_hint_mb: 1536,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub url: String,
    pub size_hint_mb: u32,
}

pub fn ensure_model(model_id: &str) -> AppResult<std::path::PathBuf> {
    let info = known_models()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| AppError::msg(format!("Unknown model: {model_id}")))?;
    let dest = crate::paths::models_dir().join(&info.id);
    let expected_size = match info.id.as_str() {
        "ggml-tiny.bin" => 77_691_713,
        "ggml-base.bin" => 147_951_465,
        "ggml-small.bin" => 487_601_967,
        "ggml-medium.bin" => 1_533_763_059,
        _ => return Err(AppError::msg("Unknown model size")),
    };
    let valid = |path: &std::path::Path| -> std::io::Result<bool> {
        let mut file = fs::File::open(path)?;
        let mut magic = [0; 4];
        Ok(file.metadata()?.len() == expected_size
            && file.read_exact(&mut magic).is_ok()
            && u32::from_le_bytes(magic) == 0x6767_6d6c)
    };
    if valid(&dest).unwrap_or(false) {
        return Ok(dest);
    }

    tracing::info!("Downloading Whisper model {}", info.id);
    let temporary = dest.with_extension("bin.part");
    let result = (|| {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(1800))
            .build()
            .map_err(|error| AppError::msg(format!("Model download: {error}")))?;
        let mut response = client.get(&info.url).send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| AppError::msg(format!("Model download: {error}")))?
            .take(expected_size + 1);
        let mut file = fs::File::create(&temporary)?;
        std::io::copy(&mut response, &mut file)
            .map_err(|error| AppError::msg(format!("Saving model: {error}")))?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        if !valid(&temporary)? {
            return Err(AppError::msg("Downloaded model is incomplete or invalid. Retry the download."));
        }
        fs::rename(&temporary, &dest)?;
        Ok(dest)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
