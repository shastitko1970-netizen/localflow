import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { check as tauriCheck } from "@tauri-apps/plugin-updater";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const mockSettings = {
  modelId: "base",
  language: "auto",
  pushToTalk: "Ctrl+Super+Space",
  handsFree: "Ctrl+Shift+Super+Space",
  commandMode: "Ctrl+Alt+Super+Space",
  autoPaste: true,
  autoCleanup: true,
  cleanupLevel: "medium",
  mcpPort: 17832,
  mcpEnabled: true,
  inputDevice: null as string | null,
};

const mockHistory = [
  {
    id: "demo-1",
    text: "Ship LocalFlow with Untitled UI and a real dark theme.",
    rawText: "ship local flow with untitled ui and a real dark theme",
    language: "en",
    modelId: "base",
    durationMs: 1820,
    createdAt: new Date().toISOString(),
    kind: "dictation",
  },
  {
    id: "demo-2",
    text: "Check for updates from GitHub Releases.",
    rawText: "check for updates from github releases",
    language: "en",
    modelId: "base",
    durationMs: 980,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    kind: "command",
  },
];

const mockModels = [
  { id: "tiny", label: "Tiny (~75 MB)", url: "", sizeHintMb: 75 },
  { id: "base", label: "Base (~142 MB) — recommended", url: "", sizeHintMb: 142 },
  { id: "small", label: "Small (~466 MB)", url: "", sizeHintMb: 466 },
];

async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case "get_settings":
      return mockSettings as T;
    case "set_settings":
      Object.assign(mockSettings, args?.settings ?? {});
      return mockSettings as T;
    case "list_history":
    case "search_history":
      return mockHistory as T;
    case "list_models":
      return mockModels as T;
    case "list_meetings":
      return [] as T;
    case "list_mics":
      return ["System default", "Microphone (Realtek)"] as T;
    case "get_dictionary":
      return { words: [{ from: "local flow", to: "LocalFlow" }] } as T;
    case "set_dictionary":
      return undefined as T;
    case "get_snippets":
      return { items: [{ trigger: ";sig", expansion: "Best,\nLocalFlow" }] } as T;
    case "set_snippets":
      return undefined as T;
    case "data_paths":
      return { mcpHint: "http://127.0.0.1:17832/mcp" } as T;
    case "ensure_model":
      return "C:\\Users\\demo\\.localflow\\models\\ggml-base.bin" as T;
    case "get_status":
      return { meetingActive: false } as T;
    case "start_dictation":
    case "stop_dictation":
    case "show_flowbar":
    case "hide_flowbar":
      return undefined as T;
    default:
      console.warn("[preview mock] unhandled invoke", cmd, args);
      return undefined as T;
  }
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return tauriListen<T>(event, handler);
}

export async function checkUpdate() {
  if (!isTauri) return null;
  return tauriCheck({ timeout: 15_000 });
}

export async function relaunchApp() {
  if (!isTauri) return;
  await tauriRelaunch();
}

export { isTauri };
