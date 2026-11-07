use crate::error::{AppError, AppResult};
use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Paste text into the currently focused control via clipboard + Ctrl+V.
pub fn paste_text(text: &str) -> AppResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    let mut clipboard = Clipboard::new().map_err(|e| AppError::msg(e.to_string()))?;
    let previous = clipboard.get_text().ok();
    clipboard
        .set_text(text)
        .map_err(|e| AppError::msg(e.to_string()))?;

    // Give the focused app a beat, then paste.
    thread::sleep(Duration::from_millis(80));
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| AppError::msg(e.to_string()))?;

    if let Some(prev) = previous {
        thread::sleep(Duration::from_millis(120));
        let _ = clipboard.set_text(prev);
    }
    Ok(())
}

pub fn copy_selection() -> AppResult<String> {
    let mut clipboard = Clipboard::new().map_err(|e| AppError::msg(e.to_string()))?;
    let previous = clipboard.get_text().unwrap_or_default();
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Unicode('c'), Direction::Click)
        .map_err(|e| AppError::msg(e.to_string()))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| AppError::msg(e.to_string()))?;
    thread::sleep(Duration::from_millis(100));
    let selected = clipboard.get_text().unwrap_or_default();
    let _ = clipboard.set_text(previous);
    Ok(selected)
}
