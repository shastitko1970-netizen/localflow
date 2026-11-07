# LocalFlow

Windows-first offline voice dictation (Wispr Flow–style UX) built with **Rust + Tauri 2** and **in-process Whisper** (`whisper.cpp` via `whisper-rs`). No cloud account required.

## Features

| Version | Scope |
|--------|--------|
| **0.1.0** | Push-to-talk / hands-free, local STT, paste into any app, history, model picker, MCP HTTP |
| **0.2.0** | Dictionary, snippets, auto-cleanup, command mode |
| **0.3.0** | Notetaker (meeting capture + local summary) + MCP meeting tools |

## Defaults

- Push-to-talk: `Ctrl+Win+Space` (hold)
- Hands-free: `Ctrl+Shift+Win+Space`
- Command mode: `Ctrl+Alt+Win+Space`
- MCP: `http://127.0.0.1:17832/mcp` while the app is running

## Install (Windows)

1. Download the latest `LocalFlow_*_x64-setup.exe` from [Releases](../../releases).
2. Run the installer.
3. Open **Settings → Download / load model** (start with `ggml-tiny` or `ggml-base`).
4. Focus any text field, hold the PTT shortcut, speak, release.

## Develop

```powershell
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
npm install
npm run tauri dev
```

Release build (NSIS):

```powershell
npm run tauri build
```

Installer output: `src-tauri/target/release/bundle/nsis/`.

## MCP for agents

```json
{
  "mcpServers": {
    "localflow": {
      "url": "http://127.0.0.1:17832/mcp"
    }
  }
}
```

Tools: `list_dictations`, `get_dictation`, `search_dictations`, `get_status`, `list_meetings`, `get_meeting`.

## License

MIT
