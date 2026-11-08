mod audio;
mod dictionary;
mod error;
mod history;
mod inject;
mod mcp_http;
mod paths;
mod polish;
mod settings;
mod snippets;
mod state;
mod stt;

use crate::dictionary::{load_dictionary, save_dictionary, Dictionary};
use crate::error::AppResult;
use crate::history::{Dictation, Meeting};
use crate::settings::{known_models, AppSettings, ModelInfo};
use crate::snippets::{load_snippets, save_snippets, Snippets};
use crate::state::{AppState, RuntimeStatus, SessionMode, SharedState};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn get_status(state: State<'_, SharedState>) -> RuntimeStatus {
    state.status()
}

#[tauri::command]
fn get_settings(state: State<'_, SharedState>) -> AppSettings {
    state.settings.lock().clone()
}

#[tauri::command]
fn set_settings(state: State<'_, SharedState>, settings: AppSettings) -> AppResult<AppSettings> {
    state.update_settings(settings)
}

#[tauri::command]
fn list_models() -> Vec<ModelInfo> {
    known_models()
}

#[tauri::command]
fn list_mics() -> AppResult<Vec<String>> {
    audio::Recorder::list_input_devices()
}

#[tauri::command]
fn ensure_model(state: State<'_, SharedState>, model_id: String) -> AppResult<String> {
    state.stt.ensure_loaded(&model_id)?;
    let path = settings::ensure_model(&model_id)?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn start_dictation(state: State<'_, SharedState>) -> AppResult<()> {
    state.start_dictation(SessionMode::Dictating)
}

#[tauri::command]
fn start_command(state: State<'_, SharedState>) -> AppResult<()> {
    state.start_dictation(SessionMode::Command)
}

#[tauri::command]
fn stop_dictation(state: State<'_, SharedState>) -> AppResult<Dictation> {
    state.stop_and_transcribe()
}

#[tauri::command]
fn toggle_hands_free(state: State<'_, SharedState>) -> AppResult<bool> {
    state.toggle_hands_free()
}

#[tauri::command]
fn list_history(state: State<'_, SharedState>, limit: Option<usize>) -> AppResult<Vec<Dictation>> {
    state.history.list(limit.unwrap_or(100))
}

#[tauri::command]
fn search_history(
    state: State<'_, SharedState>,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<Dictation>> {
    state.history.search(&query, limit.unwrap_or(100))
}

#[tauri::command]
fn get_dictionary() -> Dictionary {
    load_dictionary()
}

#[tauri::command]
fn set_dictionary(dict: Dictionary) -> AppResult<()> {
    save_dictionary(&dict)
}

#[tauri::command]
fn get_snippets() -> Snippets {
    load_snippets()
}

#[tauri::command]
fn set_snippets(snips: Snippets) -> AppResult<()> {
    save_snippets(&snips)
}

#[tauri::command]
fn start_meeting(state: State<'_, SharedState>) -> AppResult<()> {
    state.start_meeting()
}

#[tauri::command]
fn stop_meeting(state: State<'_, SharedState>, title: Option<String>) -> AppResult<Meeting> {
    state.stop_meeting(title)
}

#[tauri::command]
fn list_meetings(state: State<'_, SharedState>, limit: Option<usize>) -> AppResult<Vec<Meeting>> {
    state.history.list_meetings(limit.unwrap_or(100))
}

#[tauri::command]
fn paste_last(state: State<'_, SharedState>) -> AppResult<()> {
    if let Some(text) = state.session.lock().last_text.clone() {
        inject::paste_text(&text)?;
    }
    Ok(())
}

#[tauri::command]
fn data_paths() -> serde_json::Value {
    serde_json::json!({
        "dataDir": paths::data_dir(),
        "modelsDir": paths::models_dir(),
        "dbPath": paths::db_path(),
        "mcpHint": format!("http://127.0.0.1:{}/mcp", load_port()),
    })
}

#[tauri::command]
fn show_flowbar(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("flowbar") {
        win.show()?;
        win.set_always_on_top(true)?;
    } else {
        spawn_flowbar(&app)?;
    }
    Ok(())
}

#[tauri::command]
fn hide_flowbar(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("flowbar") {
        win.hide()?;
    }
    Ok(())
}

fn spawn_flowbar(app: &AppHandle) -> AppResult<()> {
    if app.get_webview_window("flowbar").is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, "flowbar", WebviewUrl::App("index.html#flowbar".into()))
        .title("LocalFlow Bar")
        .inner_size(260.0, 140.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .focused(false)
        .build()?;

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let win_w = (260.0 * scale) as i32;
        let win_h = (140.0 * scale) as i32;
        let x = monitor.position().x + (size.width as i32 - win_w) / 2;
        let y = monitor.position().y + size.height as i32 - win_h - (48.0 * scale) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }

    Ok(())
}

fn load_port() -> u16 {
    settings::load_settings().mcp_port
}

fn parse_shortcut(spec: &str) -> Option<Shortcut> {
    // Supports: Ctrl+Super, Ctrl+Shift+Super, Ctrl+Alt+Super, and F-keys with modifiers.
    let mut mods = Modifiers::empty();
    let mut key: Option<Code> = None;
    for part in spec.split('+').map(|s| s.trim().to_ascii_lowercase()) {
        match part.as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            "alt" | "option" => mods |= Modifiers::ALT,
            "super" | "win" | "meta" | "cmd" => mods |= Modifiers::SUPER,
            "space" => key = Some(Code::Space),
            other => {
                if let Some(n) = other.strip_prefix('f') {
                    if let Ok(num) = n.parse::<u8>() {
                        key = Some(match num {
                            1 => Code::F1,
                            2 => Code::F2,
                            3 => Code::F3,
                            4 => Code::F4,
                            5 => Code::F5,
                            6 => Code::F6,
                            7 => Code::F7,
                            8 => Code::F8,
                            9 => Code::F9,
                            10 => Code::F10,
                            11 => Code::F11,
                            12 => Code::F12,
                            _ => return None,
                        });
                    }
                }
            }
        }
    }
    // Default PTT uses modifiers-only chords: map Super presence to F13-like via Space hold pattern.
    // Global shortcut plugin requires a key; use F24 as synthetic for modifier chords.
    let code = key.unwrap_or(Code::F24);
    Some(Shortcut::new(Some(mods), code))
}

fn register_shortcuts(app: &AppHandle, state: SharedState) -> anyhow::Result<()> {
    let settings = state.settings.lock().clone();
    let app_handle = app.clone();
    let st = state.clone();

    // Clear previous
    let _ = app.global_shortcut().unregister_all();

    let ptt = parse_shortcut(&settings.push_to_talk).unwrap_or_else(|| {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SUPER), Code::Space)
    });
    let hands = parse_shortcut(&settings.hands_free).unwrap_or_else(|| {
        Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT | Modifiers::SUPER),
            Code::Space,
        )
    });
    let cmd = parse_shortcut(&settings.command_mode).unwrap_or_else(|| {
        Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER),
            Code::Space,
        )
    });

    let st1 = st.clone();
    let h1 = app_handle.clone();
    app.global_shortcut().on_shortcut(ptt, move |_app, _s, event| {
        if event.state == ShortcutState::Pressed {
            let _ = st1.start_dictation(SessionMode::Dictating);
            let _ = h1.emit("localflow://recording", true);
        } else if event.state == ShortcutState::Released {
            match st1.stop_and_transcribe() {
                Ok(item) => {
                    let _ = h1.emit("localflow://dictation", &item);
                }
                Err(e) => {
                    let _ = h1.emit("localflow://error", e.to_string());
                }
            }
            let _ = h1.emit("localflow://recording", false);
        }
    })?;

    let st2 = st.clone();
    let h2 = app_handle.clone();
    app.global_shortcut()
        .on_shortcut(hands, move |_app, _s, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            match st2.toggle_hands_free() {
                Ok(on) => {
                    let _ = h2.emit("localflow://handsfree", on);
                    let _ = h2.emit("localflow://recording", on);
                }
                Err(e) => {
                    let _ = h2.emit("localflow://error", e.to_string());
                }
            }
        })?;

    let st3 = st.clone();
    let h3 = app_handle.clone();
    app.global_shortcut().on_shortcut(cmd, move |_app, _s, event| {
        if event.state == ShortcutState::Pressed {
            let _ = st3.start_dictation(SessionMode::Command);
            let _ = h3.emit("localflow://recording", true);
        } else if event.state == ShortcutState::Released {
            match st3.stop_and_transcribe() {
                Ok(item) => {
                    let _ = h3.emit("localflow://dictation", &item);
                }
                Err(e) => {
                    let _ = h3.emit("localflow://error", e.to_string());
                }
            }
            let _ = h3.emit("localflow://recording", false);
        }
    })?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let state = AppState::new().expect("init LocalFlow state");
    let shared: SharedState = Arc::new(state);

    let mcp_state = shared.clone();
    let settings = mcp_state.settings.lock().clone();
    if settings.mcp_enabled {
        let port = settings.mcp_port;
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let rt = tokio::runtime::Runtime::new().expect("tokio");
                rt.block_on(mcp_http::serve_mcp(mcp_state, port));
            }));
            if let Err(e) = result {
                tracing::error!("MCP server panicked: {:?}", e);
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            set_settings,
            list_models,
            list_mics,
            ensure_model,
            start_dictation,
            start_command,
            stop_dictation,
            toggle_hands_free,
            list_history,
            search_history,
            get_dictionary,
            set_dictionary,
            get_snippets,
            set_snippets,
            start_meeting,
            stop_meeting,
            list_meetings,
            paste_last,
            data_paths,
            show_flowbar,
            hide_flowbar
        ])
        .setup(move |app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let handle = app.handle().clone();
            if let Err(e) = register_shortcuts(&handle, shared.clone()) {
                tracing::warn!("shortcut registration failed: {e}");
            }
            if let Err(e) = spawn_flowbar(&handle) {
                tracing::warn!("flowbar spawn failed: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LocalFlow");
}
