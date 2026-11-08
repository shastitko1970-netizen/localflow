use crate::error::{AppError, AppResult};
use crate::settings::ensure_model;
use parking_lot::Mutex;
use std::path::PathBuf;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct SttEngine {
    ctx: Mutex<Option<WhisperContext>>,
    loaded_model: Mutex<Option<PathBuf>>,
    loading: Mutex<()>,
}

impl SttEngine {
    pub fn new() -> Self {
        Self {
            ctx: Mutex::new(None),
            loaded_model: Mutex::new(None),
            loading: Mutex::new(()),
        }
    }

    pub fn ensure_loaded(&self, model_id: &str) -> AppResult<()> {
        let _loading = self.loading.lock();
        let path = ensure_model(model_id)?;
        if self.loaded_model.lock().as_ref() == Some(&path) {
            return Ok(());
        }
        tracing::info!("Loading Whisper model from {}", path.display());
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            path.to_str().ok_or_else(|| AppError::msg("invalid model path"))?,
            params,
        )
        .map_err(|e| AppError::msg(format!("whisper load: {e}")))?;
        *self.ctx.lock() = Some(ctx);
        *self.loaded_model.lock() = Some(path);
        Ok(())
    }

    pub fn transcribe(&self, samples_16k: &[f32], language: &str) -> AppResult<String> {
        let guard = self.ctx.lock();
        let ctx = guard
            .as_ref()
            .ok_or_else(|| AppError::msg("Whisper model not loaded"))?;
        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::msg(format!("whisper state: {e}")))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(num_threads());
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if language == "auto" {
            params.set_language(None);
        } else {
            params.set_language(Some(language));
        }
        params.set_single_segment(false);

        state
            .full(params, samples_16k)
            .map_err(|e| AppError::msg(format!("whisper full: {e}")))?;

        let n = state.full_n_segments();
        let mut out = String::new();
        for i in 0..n {
            if let Some(seg) = state.get_segment(i) {
                let text = seg.to_str().unwrap_or("").trim();
                if !text.is_empty() {
                    if !out.is_empty() {
                        out.push(' ');
                    }
                    out.push_str(text);
                }
            }
        }
        Ok(out)
    }

    pub fn status(&self) -> SttStatus {
        let loaded = self.loaded_model.lock().clone();
        SttStatus {
            model_loaded: loaded.is_some(),
            model_path: loaded.map(|p| p.display().to_string()),
        }
    }
}

// WhisperContext holds raw FFI pointers; we only access it under a Mutex on the calling threads.
unsafe impl Send for SttEngine {}
unsafe impl Sync for SttEngine {}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttStatus {
    pub model_loaded: bool,
    pub model_path: Option<String>,
}

fn num_threads() -> std::ffi::c_int {
    std::thread::available_parallelism()
        .map(|n| (n.get() as std::ffi::c_int).clamp(1, 8))
        .unwrap_or(4)
}
