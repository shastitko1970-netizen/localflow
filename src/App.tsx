import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Tab = "history" | "settings" | "dictionary" | "snippets" | "meetings" | "mcp";

type AppSettings = {
  modelId: string;
  language: string;
  pushToTalk: string;
  handsFree: string;
  commandMode: string;
  autoPaste: boolean;
  autoCleanup: boolean;
  cleanupLevel: string;
  mcpPort: number;
  mcpEnabled: boolean;
  inputDevice: string | null;
};

type Dictation = {
  id: string;
  text: string;
  rawText: string;
  language: string;
  modelId: string;
  durationMs: number;
  createdAt: string;
  kind: string;
};

type Meeting = {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  createdAt: string;
  durationMs: number;
};

type ModelInfo = { id: string; label: string; url: string; sizeHintMb: number };
type DictEntry = { from: string; to: string };
type Snippet = { trigger: string; expansion: string };

export default function App() {
  const [tab, setTab] = useState<Tab>("history");
  const [recording, setRecording] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<Dictation[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mics, setMics] = useState<string[]>([]);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [snips, setSnips] = useState<Snippet[]>([]);
  const [query, setQuery] = useState("");
  const [mcpHint, setMcpHint] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, h, m, ms, mic, d, sn, paths] = await Promise.all([
      invoke<AppSettings>("get_settings"),
      invoke<Dictation[]>("list_history", { limit: 100 }),
      invoke<ModelInfo[]>("list_models"),
      invoke<Meeting[]>("list_meetings", { limit: 100 }),
      invoke<string[]>("list_mics"),
      invoke<{ words: DictEntry[] }>("get_dictionary"),
      invoke<{ items: Snippet[] }>("get_snippets"),
      invoke<{ mcpHint: string }>("data_paths"),
    ]);
    setSettings(s);
    setHistory(h);
    setModels(m);
    setMeetings(ms);
    setMics(mic);
    setDict(d.words ?? []);
    setSnips(sn.items ?? []);
    setMcpHint(paths.mcpHint);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setStatusMsg(String(e)));
    const unsubs = [
      listen<boolean>("localflow://recording", (e) => {
        setRecording(e.payload);
        setStatusMsg(e.payload ? "Listening…" : "Ready");
      }),
      listen<Dictation>("localflow://dictation", (e) => {
        setHistory((prev) => [e.payload, ...prev]);
        setStatusMsg("Inserted transcript");
      }),
      listen<string>("localflow://error", (e) => setStatusMsg(e.payload)),
      listen<boolean>("localflow://handsfree", (e) =>
        setStatusMsg(e.payload ? "Hands-free on" : "Hands-free off"),
      ),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
  }, [refresh]);

  async function saveSettings(next: AppSettings) {
    const saved = await invoke<AppSettings>("set_settings", { settings: next });
    setSettings(saved);
    setStatusMsg("Settings saved (restart shortcuts on next launch if changed)");
  }

  async function downloadModel() {
    if (!settings) return;
    setBusy(true);
    setStatusMsg(`Downloading ${settings.modelId}…`);
    try {
      const path = await invoke<string>("ensure_model", { modelId: settings.modelId });
      setStatusMsg(`Model ready: ${path}`);
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSearch() {
    if (!query.trim()) {
      refresh();
      return;
    }
    const rows = await invoke<Dictation[]>("search_history", { query, limit: 100 });
    setHistory(rows);
  }

  async function toggleMeeting() {
    setBusy(true);
    try {
      const st = await invoke<{ meetingActive: boolean }>("get_status");
      if (st.meetingActive) {
        const m = await invoke<Meeting>("stop_meeting", { title: null });
        setMeetings((prev) => [m, ...prev]);
        setStatusMsg("Meeting saved");
      } else {
        await invoke("start_meeting");
        setStatusMsg("Meeting recording…");
      }
      await refresh();
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <strong>LocalFlow</strong>
            <div className="muted">v{__APP_VERSION__}</div>
          </div>
        </div>
        {(
          [
            ["history", "History"],
            ["settings", "Settings"],
            ["dictionary", "Dictionary"],
            ["snippets", "Snippets"],
            ["meetings", "Notetaker"],
            ["mcp", "MCP"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "nav-btn active" : "nav-btn"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <div className="nav-foot">
          <div className={recording ? "pill live" : "pill"}>{recording ? "REC" : "IDLE"}</div>
          <div className="muted small">{statusMsg}</div>
        </div>
      </aside>

      <main className="main">
        {tab === "history" && (
          <section>
            <header className="row">
              <h1>Dictation history</h1>
              <div className="row gap">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
                <button onClick={doSearch}>Search</button>
                <button onClick={() => refresh()}>Refresh</button>
              </div>
            </header>
            <p className="hint">
              Hold <kbd>{settings?.pushToTalk ?? "Ctrl+Win+Space"}</kbd> to dictate. Hands-free:{" "}
              <kbd>{settings?.handsFree}</kbd>. Command: <kbd>{settings?.commandMode}</kbd>.
            </p>
            <div className="list">
              {history.map((d) => (
                <article key={d.id} className="card">
                  <div className="row between">
                    <span className="tag">{d.kind}</span>
                    <span className="muted small">
                      {new Date(d.createdAt).toLocaleString()} · {d.durationMs}ms
                    </span>
                  </div>
                  <p>{d.text}</p>
                </article>
              ))}
              {!history.length && <p className="muted">No dictations yet.</p>}
            </div>
          </section>
        )}

        {tab === "settings" && settings && (
          <section>
            <h1>Settings</h1>
            <div className="form">
              <label>
                Whisper model
                <select
                  value={settings.modelId}
                  onChange={(e) => setSettings({ ...settings, modelId: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={downloadModel}>
                Download / load model
              </button>
              <label>
                Language
                <input
                  value={settings.language}
                  onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                  placeholder="auto / en / ru / …"
                />
              </label>
              <label>
                Microphone
                <select
                  value={settings.inputDevice ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      inputDevice: e.target.value || null,
                    })
                  }
                >
                  <option value="">System default</option>
                  {mics.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Push-to-talk
                <input
                  value={settings.pushToTalk}
                  onChange={(e) => setSettings({ ...settings, pushToTalk: e.target.value })}
                />
              </label>
              <label>
                Hands-free
                <input
                  value={settings.handsFree}
                  onChange={(e) => setSettings({ ...settings, handsFree: e.target.value })}
                />
              </label>
              <label>
                Command mode
                <input
                  value={settings.commandMode}
                  onChange={(e) => setSettings({ ...settings, commandMode: e.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.autoPaste}
                  onChange={(e) => setSettings({ ...settings, autoPaste: e.target.checked })}
                />
                Auto-paste into focused app
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.autoCleanup}
                  onChange={(e) => setSettings({ ...settings, autoCleanup: e.target.checked })}
                />
                Auto cleanup
              </label>
              <label>
                Cleanup level
                <select
                  value={settings.cleanupLevel}
                  onChange={(e) => setSettings({ ...settings, cleanupLevel: e.target.value })}
                >
                  <option value="off">Off</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.mcpEnabled}
                  onChange={(e) => setSettings({ ...settings, mcpEnabled: e.target.checked })}
                />
                Enable local MCP HTTP server
              </label>
              <label>
                MCP port
                <input
                  type="number"
                  value={settings.mcpPort}
                  onChange={(e) =>
                    setSettings({ ...settings, mcpPort: Number(e.target.value) || 17832 })
                  }
                />
              </label>
              <button onClick={() => saveSettings(settings)}>Save settings</button>
            </div>
          </section>
        )}

        {tab === "dictionary" && (
          <section>
            <h1>Dictionary</h1>
            <p className="hint">Replace misheard words with your terms.</p>
            {dict.map((e, i) => (
              <div className="row gap" key={i}>
                <input
                  value={e.from}
                  placeholder="from"
                  onChange={(ev) => {
                    const next = [...dict];
                    next[i] = { ...e, from: ev.target.value };
                    setDict(next);
                  }}
                />
                <input
                  value={e.to}
                  placeholder="to"
                  onChange={(ev) => {
                    const next = [...dict];
                    next[i] = { ...e, to: ev.target.value };
                    setDict(next);
                  }}
                />
              </div>
            ))}
            <div className="row gap">
              <button onClick={() => setDict([...dict, { from: "", to: "" }])}>Add word</button>
              <button
                onClick={async () => {
                  await invoke("set_dictionary", { dict: { words: dict } });
                  setStatusMsg("Dictionary saved");
                }}
              >
                Save
              </button>
            </div>
          </section>
        )}

        {tab === "snippets" && (
          <section>
            <h1>Snippets</h1>
            {snips.map((s, i) => (
              <div className="row gap" key={i}>
                <input
                  value={s.trigger}
                  placeholder="trigger"
                  onChange={(ev) => {
                    const next = [...snips];
                    next[i] = { ...s, trigger: ev.target.value };
                    setSnips(next);
                  }}
                />
                <input
                  value={s.expansion}
                  placeholder="expansion"
                  onChange={(ev) => {
                    const next = [...snips];
                    next[i] = { ...s, expansion: ev.target.value };
                    setSnips(next);
                  }}
                />
              </div>
            ))}
            <div className="row gap">
              <button onClick={() => setSnips([...snips, { trigger: "", expansion: "" }])}>
                Add snippet
              </button>
              <button
                onClick={async () => {
                  await invoke("set_snippets", { snips: { items: snips } });
                  setStatusMsg("Snippets saved");
                }}
              >
                Save
              </button>
            </div>
          </section>
        )}

        {tab === "meetings" && (
          <section>
            <header className="row between">
              <h1>Notetaker</h1>
              <button disabled={busy} onClick={toggleMeeting}>
                Start / stop meeting
              </button>
            </header>
            <p className="hint">Records mic audio, transcribes locally, stores summary offline.</p>
            <div className="list">
              {meetings.map((m) => (
                <article key={m.id} className="card">
                  <div className="row between">
                    <strong>{m.title}</strong>
                    <span className="muted small">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <pre className="summary">{m.summary}</pre>
                  <details>
                    <summary>Transcript</summary>
                    <p>{m.transcript || "(empty)"}</p>
                  </details>
                </article>
              ))}
              {!meetings.length && <p className="muted">No meetings yet.</p>}
            </div>
          </section>
        )}

        {tab === "mcp" && (
          <section>
            <h1>MCP for AI agents</h1>
            <p className="hint">
              LocalFlow exposes tools on a localhost MCP/JSON-RPC endpoint while the app is running.
            </p>
            <pre className="code">{`Endpoint: ${mcpHint || "http://127.0.0.1:17832/mcp"}

Cursor / Claude MCP config:
{
  "mcpServers": {
    "localflow": {
      "url": "${mcpHint || "http://127.0.0.1:17832/mcp"}"
    }
  }
}

Tools: list_dictations, get_dictation, search_dictations,
get_status, list_meetings, get_meeting`}</pre>
          </section>
        )}
      </main>
    </div>
  );
}

declare const __APP_VERSION__: string;
