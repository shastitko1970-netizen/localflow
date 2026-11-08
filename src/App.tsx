import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Settings01,
  BookOpen01,
  Zap,
  Microphone01,
  Code01,
  Moon01,
  Sun,
  SearchLg,
  Plus,
  RefreshCcw01,
  Download01,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { cx } from "@/utils/cx";
import { useTheme } from "@/providers/theme-provider";
import { checkUpdate, invoke, listen, relaunchApp } from "@/lib/tauri";

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
type UpdateInfo = { version: string; body?: string | null };

const NAV: { id: Tab; label: string; icon: typeof Clock }[] = [
  { id: "history", label: "History", icon: Clock },
  { id: "settings", label: "Settings", icon: Settings01 },
  { id: "dictionary", label: "Dictionary", icon: BookOpen01 },
  { id: "snippets", label: "Snippets", icon: Zap },
  { id: "meetings", label: "Notetaker", icon: Microphone01 },
  { id: "mcp", label: "MCP", icon: Code01 },
];

export default function App() {
  const { theme, toggleTheme } = useTheme();
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await checkUpdate();
        if (!cancelled && update) {
          setUpdateInfo({ version: update.version, body: update.body });
        }
      } catch {
        // ignore offline / unsigned builds
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function installUpdate() {
    setUpdating(true);
    setStatusMsg("Downloading update…");
    try {
      const update = await checkUpdate();
      if (!update) {
        setStatusMsg("No update available");
        setUpdateInfo(null);
        return;
      }
      await update.downloadAndInstall();
      setStatusMsg("Restarting…");
      await relaunchApp();
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setUpdating(false);
    }
  }

  async function saveSettings(next: AppSettings) {
    const saved = await invoke<AppSettings>("set_settings", { settings: next });
    setSettings(saved);
    setStatusMsg("Settings saved");
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
      await refresh();
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
    <div className="flex h-full min-h-screen bg-secondary text-primary">
      <aside className="flex w-64 shrink-0 flex-col border-r border-secondary bg-primary">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-solid text-white shadow-xs">
            <Microphone01 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-md font-semibold text-primary">LocalFlow</div>
            <div className="truncate text-xs text-tertiary">offline dictation · v{__APP_VERSION__}</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold outline-focus-ring transition",
                  active
                    ? "bg-active text-secondary_hover ring-1 ring-secondary ring-inset"
                    : "text-tertiary hover:bg-primary_hover hover:text-secondary_hover",
                )}
              >
                <Icon className={cx("size-5", active ? "text-fg-brand-primary" : "text-fg-quaternary")} />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 border-t border-secondary px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
                recording
                  ? "bg-error-primary text-error-primary ring-error_subtle"
                  : "bg-success-primary text-success-primary ring-success",
              )}
            >
              <span className={cx("size-1.5 rounded-full", recording ? "bg-fg-error-secondary" : "bg-fg-success-secondary")} />
              {recording ? "REC" : "IDLE"}
            </span>
            <Button
              size="sm"
              color="tertiary"
              iconLeading={theme === "dark" ? Sun : Moon01}
              aria-label="Toggle theme"
              onPress={toggleTheme}
            />
          </div>
          <p className="truncate text-xs text-tertiary">{statusMsg}</p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-6 lg:px-8">
          {updateInfo && (
            <div className="mb-5 flex items-center justify-between gap-4 rounded-xl bg-brand-primary px-4 py-3 ring-1 ring-brand ring-inset">
              <div>
                <p className="text-sm font-semibold text-secondary">Update {updateInfo.version}</p>
                <p className="text-sm text-tertiary">{updateInfo.body || "A newer LocalFlow build is ready."}</p>
              </div>
              <Button size="sm" isDisabled={updating} onPress={installUpdate}>
                {updating ? "Installing…" : "Install & restart"}
              </Button>
            </div>
          )}

          {tab === "history" && (
            <section className="space-y-5">
              <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h1 className="text-display-xs font-semibold text-primary">Dictation history</h1>
                  <p className="mt-1 max-w-xl text-md text-tertiary">
                    Hold <kbd className="rounded-md bg-primary px-1.5 py-0.5 text-sm font-medium text-secondary ring-1 ring-secondary ring-inset">{settings?.pushToTalk ?? "Ctrl+Win+Space"}</kbd> to speak into any app.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={query}
                    onChange={setQuery}
                    placeholder="Search transcripts…"
                    icon={SearchLg}
                    className="min-w-56"
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  />
                  <Button onPress={doSearch}>Search</Button>
                  <Button color="secondary" iconLeading={RefreshCcw01} onPress={() => refresh()}>
                    Refresh
                  </Button>
                </div>
              </header>

              <div className="space-y-3">
                {history.map((d) => (
                  <article key={d.id} className="rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary ring-inset">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-md bg-brand-primary px-2 py-0.5 text-xs font-medium text-brand-secondary ring-1 ring-brand ring-inset">
                        {d.kind}
                      </span>
                      <span className="text-xs text-tertiary">
                        {new Date(d.createdAt).toLocaleString()} · {d.durationMs}ms
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-md text-secondary">{d.text}</p>
                  </article>
                ))}
                {!history.length && (
                  <div className="rounded-xl bg-primary px-6 py-12 text-center shadow-xs ring-1 ring-secondary ring-inset">
                    <p className="text-md font-medium text-secondary">No dictations yet</p>
                    <p className="mt-1 text-sm text-tertiary">Press the hotkey and talk.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "settings" && settings && (
            <section className="space-y-5">
              <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-display-xs font-semibold text-primary">Settings</h1>
                  <p className="mt-1 text-md text-tertiary">Models, mic, shortcuts, and local MCP.</p>
                </div>
                <Button color="secondary" isDisabled={updating} onPress={installUpdate}>
                  Check for updates
                </Button>
              </header>

              <div className="space-y-5 rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset sm:p-6">
                <NativeSelect
                  label="Whisper model"
                  value={settings.modelId}
                  onChange={(e) => setSettings({ ...settings, modelId: e.target.value })}
                  options={models.map((m) => ({ label: m.label, value: m.id }))}
                />
                <Button iconLeading={Download01} isDisabled={busy} onPress={downloadModel}>
                  Download / load model
                </Button>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Language"
                    value={settings.language}
                    onChange={(v) => setSettings({ ...settings, language: v })}
                    placeholder="auto / en / ru"
                  />
                  <NativeSelect
                    label="Microphone"
                    value={settings.inputDevice ?? ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        inputDevice: e.target.value || null,
                      })
                    }
                    options={[
                      { label: "System default", value: "" },
                      ...mics.map((m) => ({ label: m, value: m })),
                    ]}
                  />
                  <Input
                    label="Push-to-talk"
                    value={settings.pushToTalk}
                    onChange={(v) => setSettings({ ...settings, pushToTalk: v })}
                  />
                  <Input
                    label="Hands-free"
                    value={settings.handsFree}
                    onChange={(v) => setSettings({ ...settings, handsFree: v })}
                  />
                  <Input
                    label="Command mode"
                    value={settings.commandMode}
                    onChange={(v) => setSettings({ ...settings, commandMode: v })}
                  />
                  <NativeSelect
                    label="Cleanup level"
                    value={settings.cleanupLevel}
                    onChange={(e) => setSettings({ ...settings, cleanupLevel: e.target.value })}
                    options={[
                      { label: "Off", value: "off" },
                      { label: "Medium", value: "medium" },
                      { label: "High", value: "high" },
                    ]}
                  />
                </div>

                <div className="space-y-3">
                  <Checkbox
                    isSelected={settings.autoPaste}
                    onChange={(v) => setSettings({ ...settings, autoPaste: v })}
                    label="Auto-paste into focused app"
                  />
                  <Checkbox
                    isSelected={settings.autoCleanup}
                    onChange={(v) => setSettings({ ...settings, autoCleanup: v })}
                    label="Auto cleanup fillers"
                  />
                  <Checkbox
                    isSelected={settings.mcpEnabled}
                    onChange={(v) => setSettings({ ...settings, mcpEnabled: v })}
                    label="Enable local MCP HTTP server"
                  />
                </div>

                <Input
                  label="MCP port"
                  type="number"
                  value={String(settings.mcpPort)}
                  onChange={(v) =>
                    setSettings({ ...settings, mcpPort: Number(v) || 17832 })
                  }
                />

                <Button onPress={() => saveSettings(settings)}>Save settings</Button>
              </div>
            </section>
          )}

          {tab === "dictionary" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-display-xs font-semibold text-primary">Dictionary</h1>
                <p className="mt-1 text-md text-tertiary">Replace misheard words with your own terms.</p>
              </header>
              <div className="space-y-3 rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset">
                {dict.map((e, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={e.from}
                      placeholder="from"
                      onChange={(v) => {
                        const next = [...dict];
                        next[i] = { ...e, from: v };
                        setDict(next);
                      }}
                    />
                    <Input
                      value={e.to}
                      placeholder="to"
                      onChange={(v) => {
                        const next = [...dict];
                        next[i] = { ...e, to: v };
                        setDict(next);
                      }}
                    />
                    <Button color="secondary" onPress={() => setDict(dict.filter((_, idx) => idx !== i))}>
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button color="secondary" iconLeading={Plus} onPress={() => setDict([...dict, { from: "", to: "" }])}>
                    Add word
                  </Button>
                  <Button
                    onPress={async () => {
                      await invoke("set_dictionary", { dict: { words: dict } });
                      setStatusMsg("Dictionary saved");
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </section>
          )}

          {tab === "snippets" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-display-xs font-semibold text-primary">Snippets</h1>
                <p className="mt-1 text-md text-tertiary">Expand short triggers into longer phrases.</p>
              </header>
              <div className="space-y-3 rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset">
                {snips.map((s, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={s.trigger}
                      placeholder="trigger"
                      onChange={(v) => {
                        const next = [...snips];
                        next[i] = { ...s, trigger: v };
                        setSnips(next);
                      }}
                    />
                    <Input
                      value={s.expansion}
                      placeholder="expansion"
                      onChange={(v) => {
                        const next = [...snips];
                        next[i] = { ...s, expansion: v };
                        setSnips(next);
                      }}
                    />
                    <Button color="secondary" onPress={() => setSnips(snips.filter((_, idx) => idx !== i))}>
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    color="secondary"
                    iconLeading={Plus}
                    onPress={() => setSnips([...snips, { trigger: "", expansion: "" }])}
                  >
                    Add snippet
                  </Button>
                  <Button
                    onPress={async () => {
                      await invoke("set_snippets", { snips: { items: snips } });
                      setStatusMsg("Snippets saved");
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </section>
          )}

          {tab === "meetings" && (
            <section className="space-y-5">
              <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-display-xs font-semibold text-primary">Notetaker</h1>
                  <p className="mt-1 text-md text-tertiary">Record, transcribe locally, keep summaries offline.</p>
                </div>
                <Button isDisabled={busy} onPress={toggleMeeting}>
                  Start / stop meeting
                </Button>
              </header>
              <div className="space-y-3">
                {meetings.map((m) => (
                  <article key={m.id} className="rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary ring-inset">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-md font-semibold text-primary">{m.title}</h2>
                      <span className="text-xs text-tertiary">{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-lg bg-secondary p-3 text-sm text-secondary whitespace-pre-wrap">
                      {m.summary}
                    </pre>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-tertiary">Transcript</summary>
                      <p className="mt-2 text-sm text-secondary">{m.transcript || "(empty)"}</p>
                    </details>
                  </article>
                ))}
                {!meetings.length && (
                  <div className="rounded-xl bg-primary px-6 py-12 text-center shadow-xs ring-1 ring-secondary ring-inset">
                    <p className="text-md font-medium text-secondary">No meetings yet</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "mcp" && (
            <section className="space-y-5">
              <header>
                <h1 className="text-display-xs font-semibold text-primary">MCP for AI agents</h1>
                <p className="mt-1 text-md text-tertiary">Localhost JSON-RPC while LocalFlow is running.</p>
              </header>
              <pre className="overflow-auto rounded-xl bg-primary p-5 text-sm text-secondary shadow-xs ring-1 ring-secondary ring-inset whitespace-pre-wrap font-mono">{`Endpoint: ${mcpHint || "http://127.0.0.1:17832/mcp"}

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
        </div>
      </main>
    </div>
  );
}

declare const __APP_VERSION__: string;
