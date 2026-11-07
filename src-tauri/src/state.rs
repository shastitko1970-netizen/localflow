use crate::audio::Recorder;
use crate::error::{AppError, AppResult};
use crate::history::{Dictation, HistoryDb, Meeting};
use crate::inject::{copy_selection, paste_text};
use crate::polish::{apply_command, cleanup_text};
use crate::settings::{load_settings, save_settings, AppSettings};
use crate::stt::SttEngine;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub recorder: Recorder,
    pub stt: SttEngine,
    pub history: HistoryDb,
    pub session: Mutex<SessionState>,
}

#[derive(Debug, Default)]
pub struct SessionState {
    pub mode: SessionMode,
    pub started_at: Option<Instant>,
    pub last_text: Option<String>,
    pub hands_free: bool,
    pub meeting_active: bool,
    pub meeting_samples: Vec<f32>,
    pub meeting_started: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    #[default]
    Idle,
    Dictating,
    Command,
    Meeting,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub mode: SessionMode,
    pub recording: bool,
    pub hands_free: bool,
    pub meeting_active: bool,
    pub model_loaded: bool,
    pub model_path: Option<String>,
    pub last_text: Option<String>,
    pub settings: AppSettings,
}

impl AppState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            settings: Mutex::new(load_settings()),
            recorder: Recorder::new(),
            stt: SttEngine::new(),
            history: HistoryDb::open()?,
            session: Mutex::new(SessionState::default()),
        })
    }

    pub fn status(&self) -> RuntimeStatus {
        let settings = self.settings.lock().clone();
        let session = self.session.lock();
        let stt = self.stt.status();
        RuntimeStatus {
            mode: session.mode,
            recording: self.recorder.is_recording(),
            hands_free: session.hands_free,
            meeting_active: session.meeting_active,
            model_loaded: stt.model_loaded,
            model_path: stt.model_path,
            last_text: session.last_text.clone(),
            settings,
        }
    }

    pub fn start_dictation(&self, mode: SessionMode) -> AppResult<()> {
        let settings = self.settings.lock().clone();
        self.stt.ensure_loaded(&settings.model_id)?;
        self.recorder
            .start(settings.input_device.as_deref())?;
        let mut session = self.session.lock();
        session.mode = mode;
        session.started_at = Some(Instant::now());
        Ok(())
    }

    pub fn stop_and_transcribe(&self) -> AppResult<Dictation> {
        let settings = self.settings.lock().clone();
        let (samples, rate) = self.recorder.stop()?;
        let duration_ms = self
            .session
            .lock()
            .started_at
            .map(|t| t.elapsed().as_millis() as u64)
            .unwrap_or(0);
        let mode = self.session.lock().mode;

        if samples.len() < 1600 {
            self.session.lock().mode = SessionMode::Idle;
            return Err(AppError::msg("Recording too short"));
        }

        let pcm = crate::audio::resample_to_16k(&samples, rate);
        let raw = self.stt.transcribe(&pcm, &settings.language)?;

        let text = match mode {
            SessionMode::Command => {
                let selected = copy_selection().unwrap_or_default();
                apply_command(&raw, &selected)
            }
            _ => cleanup_text(
                &raw,
                if settings.auto_cleanup {
                    &settings.cleanup_level
                } else {
                    "off"
                },
                true,
            ),
        };

        let kind = match mode {
            SessionMode::Command => "command",
            SessionMode::Meeting => "meeting-chunk",
            _ => "dictation",
        };

        let item = self.history.insert_dictation(
            &text,
            &raw,
            &settings.language,
            &settings.model_id,
            duration_ms,
            kind,
        )?;

        if settings.auto_paste {
            // Small delay so focus returns to previous app after hotkey release.
            std::thread::sleep(std::time::Duration::from_millis(100));
            paste_text(&text)?;
        }

        {
            let mut session = self.session.lock();
            session.mode = SessionMode::Idle;
            session.started_at = None;
            session.last_text = Some(text);
            if !session.hands_free {
                // keep idle
            }
        }
        Ok(item)
    }

    pub fn toggle_hands_free(&self) -> AppResult<bool> {
        let mut session = self.session.lock();
        if session.hands_free {
            session.hands_free = false;
            drop(session);
            if self.recorder.is_recording() {
                let _ = self.stop_and_transcribe();
            }
            return Ok(false);
        }
        session.hands_free = true;
        drop(session);
        self.start_dictation(SessionMode::Dictating)?;
        Ok(true)
    }

    pub fn start_meeting(&self) -> AppResult<()> {
        let settings = self.settings.lock().clone();
        self.stt.ensure_loaded(&settings.model_id)?;
        self.recorder
            .start(settings.input_device.as_deref())?;
        let mut session = self.session.lock();
        session.mode = SessionMode::Meeting;
        session.meeting_active = true;
        session.meeting_samples.clear();
        session.meeting_started = Some(Instant::now());
        Ok(())
    }

    pub fn stop_meeting(&self, title: Option<String>) -> AppResult<Meeting> {
        let settings = self.settings.lock().clone();
        let (samples, rate) = self.recorder.stop()?;
        let duration_ms = {
            let mut session = self.session.lock();
            session.meeting_active = false;
            session.mode = SessionMode::Idle;
            session
                .meeting_started
                .map(|t| t.elapsed().as_millis() as u64)
                .unwrap_or(0)
        };
        let pcm = crate::audio::resample_to_16k(&samples, rate);
        let raw = if pcm.len() > 1600 {
            self.stt.transcribe(&pcm, &settings.language)?
        } else {
            String::new()
        };
        let transcript = cleanup_text(&raw, &settings.cleanup_level, true);
        let summary = summarize_locally(&transcript);
        let title = title.unwrap_or_else(|| {
            format!(
                "Meeting {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M")
            )
        });
        self.history
            .insert_meeting(&title, &transcript, &summary, duration_ms)
    }

    pub fn update_settings(&self, settings: AppSettings) -> AppResult<AppSettings> {
        save_settings(&settings)?;
        *self.settings.lock() = settings.clone();
        Ok(settings)
    }
}

fn summarize_locally(transcript: &str) -> String {
    if transcript.trim().is_empty() {
        return "No speech captured.".into();
    }
    let sentences: Vec<&str> = transcript
        .split(|c| c == '.' || c == '!' || c == '?')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let take = sentences.len().min(5);
    let mut bullets = String::from("Summary:\n");
    for s in sentences.into_iter().take(take) {
        bullets.push_str("- ");
        bullets.push_str(s);
        bullets.push('\n');
    }
    bullets
}

pub type SharedState = Arc<AppState>;
