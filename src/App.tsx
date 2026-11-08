import { ModelsSettings } from "@/ModelsSettings";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import {
  Microphone01,
  Recording02,
  BarChart01,
  BookOpen01,
  Scissors01,
  Type01,
  MagicWand01,
  MessageTextCircle01,
  Settings01,
  HelpCircle,
  Moon01,
  Sun,
  SearchLg,
  Plus,
  RefreshCcw01,
  XClose,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { cx } from "@/utils/cx";
import { useTheme } from "@/providers/theme-provider";
import { checkUpdate, invoke, listen, relaunchApp } from "@/lib/tauri";

type Tab =
  | "dictation"
  | "notetaker"
  | "insights"
  | "dictionary"
  | "snippets"
  | "style"
  | "transforms"
  | "scratchpad"
  | "mcp";

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

type DictEntry = { from: string; to: string };
type Snippet = { trigger: string; expansion: string };
type UpdateInfo = { version: string; body?: string | null };
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: { id: Tab; label: string; icon: IconType }[] = [
  { id: "dictation", label: "Dictation", icon: Microphone01 },
  { id: "notetaker", label: "Notetaker", icon: Recording02 },
  { id: "insights", label: "Insights", icon: BarChart01 },
  { id: "dictionary", label: "Dictionary", icon: BookOpen01 },
  { id: "snippets", label: "Snippets", icon: Scissors01 },
  { id: "style", label: "Style", icon: Type01 },
  { id: "transforms", label: "Transforms", icon: MagicWand01 },
  { id: "scratchpad", label: "Scratchpad", icon: MessageTextCircle01 },
];

function groupByDate(items: Dictation[]) {
  const map = new Map<string, Dictation[]>();
  for (const item of items) {
    const key = new Date(item.createdAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()];
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("dictation");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<Dictation[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [settingsPage, setSettingsPage] = useState<"General" | "Models">("General");
  const [micError, setMicError] = useState("");
  const [mics, setMics] = useState<string[]>([]);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [snips, setSnips] = useState<Snippet[]>([]);
  const [query, setQuery] = useState("");
  const [mcpHint, setMcpHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [flowBarOn, setFlowBarOn] = useState(true);

  const refresh = useCallback(async () => {
    const [s, h, ms, d, sn, paths] = await Promise.all([
      invoke<AppSettings>("get_settings"),
      invoke<Dictation[]>("list_history", { limit: 100 }),
      invoke<Meeting[]>("list_meetings", { limit: 100 }),
      invoke<{ words: DictEntry[] }>("get_dictionary"),
      invoke<{ items: Snippet[] }>("get_snippets"),
      invoke<{ mcpHint: string }>("data_paths"),
    ]);
    setSettings(s);
    setHistory(h);
    setMeetings(ms);
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
      listen<string>("localflow://navigate", (e) => {
        const next = e.payload as Tab | "history" | "settings";
        if (next === "history") setTab("dictation");
        else if (next === "settings") setSettingsOpen(true);
        else setTab(next);
      }),
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
        if (update) {
          const info = { version: update.version, body: update.body };
          await update.close();
          if (!cancelled) setUpdateInfo(info);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen || settingsPage !== "General") return;
    let active = true;
    setMicError("");
    invoke<string[]>("list_mics").then((devices) => {
      if (active) setMics([...new Set(devices)]);
    }).catch((cause) => {
      if (active) setMicError(String(cause));
    });
    return () => { active = false; };
  }, [settingsOpen, settingsPage]);

  const grouped = useMemo(() => groupByDate(history), [history]);
  const wordCount = useMemo(
    () => history.reduce((n, d) => n + d.text.trim().split(/\s+/).filter(Boolean).length, 0),
    [history],
  );

  async function checkForUpdates() {
    setCheckingUpdate(true);
    setUpdateMessage("Checking GitHub for updates…");
    try {
      const update = await checkUpdate();
      if (!update) {
        setUpdateInfo(null);
        setUpdateMessage(`You're up to date (v${__APP_VERSION__}).`);
        return;
      }
      const info = { version: update.version, body: update.body };
      await update.close();
      setUpdateInfo(info);
      setUpdateMessage(`Version ${info.version} is available.`);
    } catch (error) {
      setUpdateMessage(`Couldn't check for updates: ${String(error)}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function installUpdate() {
    setUpdating(true);
    setUpdateMessage("Downloading and installing update…");
    try {
      const update = await checkUpdate();
      if (!update) {
        setUpdateInfo(null);
        setUpdateMessage(`You're up to date (v${__APP_VERSION__}).`);
        return;
      }
      try {
        await update.downloadAndInstall();
      } finally {
        await update.close();
      }
      await relaunchApp();
    } catch (error) {
      const message = `Couldn't install update: ${String(error)}`;
      setUpdateMessage(message);
      setStatusMsg(message);
    } finally {
      setUpdating(false);
    }
  }

  async function saveSettings(next: AppSettings) {
    const saved = await invoke<AppSettings>("set_settings", { settings: next });
    setSettings(saved);
    setStatusMsg("Settings saved");
  }

  async function doSearch() {
    if (!query.trim()) {
      await refresh();
      return;
    }
    setHistory(await invoke<Dictation[]>("search_history", { query, limit: 100 }));
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

  async function setFlowBarVisible(on: boolean) {
    setFlowBarOn(on);
    try {
      await invoke(on ? "show_flowbar" : "hide_flowbar");
    } catch {
      // preview mock
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a] text-white">
      {/* Icon rail — Wispr style */}
      <aside className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-white/5 py-4">
        <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-white/10">
          <span className="flex h-4 items-end gap-0.5">
            <span className="w-1 rounded-sm bg-white/90 h-2" />
            <span className="w-1 rounded-sm bg-white/90 h-3.5" />
            <span className="w-1 rounded-sm bg-white/90 h-2.5" />
          </span>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => setTab(id)}
                className={cx(
                  "flex size-11 items-center justify-center rounded-xl transition",
                  active ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/80",
                )}
              >
                <Icon className="size-5" />
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex size-11 items-center justify-center rounded-xl text-white/45 transition hover:bg-white/5 hover:text-white/80"
          >
            <Settings01 className="size-5" />
          </button>
          <button
            type="button"
            title="MCP"
            onClick={() => setTab("mcp")}
            className={cx(
              "flex size-11 items-center justify-center rounded-xl transition",
              tab === "mcp" ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/80",
            )}
          >
            <HelpCircle className="size-5" />
          </button>
        </div>
      </aside>

      {/* Main rounded pane */}
      <div className="relative flex min-w-0 flex-1 flex-col p-3">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[22px] border border-white/8 bg-[#111111]">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-white/6 px-5 py-3">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight capitalize">
                  {tab === "mcp" ? "MCP" : NAV.find((n) => n.id === tab)?.label}
                </h1>
                {(tab === "transforms" || tab === "scratchpad" || tab === "style") && (
                  <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                    Beta
                  </span>
                )}
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    recording ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300",
                  )}
                >
                  <span className={cx("size-1.5 rounded-full", recording ? "bg-red-400" : "bg-emerald-400")} />
                  {recording ? "REC" : "IDLE"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-white/40 sm:inline">{statusMsg}</span>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex size-9 items-center justify-center rounded-full text-white/50 hover:bg-white/5 hover:text-white"
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon01 className="size-4" />}
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              {updateInfo && (
                <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Update {updateInfo.version}</p>
                    <p className="text-xs text-white/50">{updateInfo.body || "Newer LocalFlow build ready."}</p>
                  </div>
                  <Button size="sm" isDisabled={updating || checkingUpdate} onPress={installUpdate}>
                    {updating ? "Installing…" : "Install"}
                  </Button>
                </div>
              )}

              {tab === "dictation" && (
                <div className="grid min-h-full gap-0 lg:grid-cols-[1fr_280px]">
                  <section className="space-y-5 p-5">
                    <div className="overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-orange-500/20 via-zinc-900 to-zinc-950 p-6">
                      <h2 className="font-serif text-2xl text-white">Make LocalFlow sound like you</h2>
                      <p className="mt-2 max-w-md text-sm text-white/60">
                        Hold <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">{settings?.pushToTalk ?? "Ctrl+Win+Space"}</kbd> or use the floating Flow Bar pill.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button size="sm" color="secondary" onPress={() => setFlowBarVisible(!flowBarOn)}>
                          {flowBarOn ? "Hide Flow Bar" : "Show Flow Bar"}
                        </Button>
                        <Button size="sm" color="tertiary" onPress={() => setSettingsOpen(true)}>
                          Settings
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        value={query}
                        onChange={setQuery}
                        placeholder="Search transcripts…"
                        icon={SearchLg}
                        className="min-w-0 flex-1"
                        onKeyDown={(e) => e.key === "Enter" && doSearch()}
                      />
                      <Button color="secondary" iconLeading={RefreshCcw01} onPress={() => refresh()} />
                    </div>

                    <div className="space-y-6">
                      {grouped.map(([date, items]) => (
                        <div key={date}>
                          <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-white/35 uppercase">
                            {date}
                          </p>
                          <div className="space-y-3">
                            {items.map((d) => (
                              <article
                                key={d.id}
                                className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3.5"
                              >
                                <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-white/35">
                                  <span className="rounded-md bg-white/5 px-2 py-0.5 capitalize">{d.kind}</span>
                                  <span>
                                    {new Date(d.createdAt).toLocaleTimeString([], {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}{" "}
                                    · {d.durationMs}ms
                                  </span>
                                </div>
                                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">
                                  {d.text}
                                </p>
                              </article>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!history.length && (
                        <p className="py-16 text-center text-sm text-white/40">
                          No dictations yet — press the hotkey or Flow Bar.
                        </p>
                      )}
                    </div>
                  </section>

                  <aside className="hidden space-y-3 border-l border-white/6 p-4 lg:block">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <p className="font-serif text-3xl text-white">{wordCount.toLocaleString()}</p>
                      <p className="mt-1 text-xs text-white/45">total words</p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/50">
                        <div>
                          <p className="text-lg text-white/90">—</p>
                          <p>wpm</p>
                        </div>
                        <div>
                          <p className="text-lg text-white/90">0</p>
                          <p>day streak</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-sm font-medium">Flow Bar</p>
                      <p className="mt-1 text-xs text-white/45">
                        Floating pill stays on top while you work in other apps.
                      </p>
                      <div className="mt-3">
                        <Button size="sm" color="secondary" onPress={() => setFlowBarVisible(!flowBarOn)}>
                          {flowBarOn ? "Hide pill" : "Show pill"}
                        </Button>
                      </div>
                    </div>
                  </aside>
                </div>
              )}

              {tab === "notetaker" && (
                <section className="space-y-5 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-white/50">Record, transcribe locally, keep notes offline.</p>
                    <Button isDisabled={busy} onPress={toggleMeeting}>
                      Start / stop meeting
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {meetings.map((m) => (
                      <article key={m.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="font-medium">{m.title}</h2>
                          <span className="text-xs text-white/40">
                            {new Date(m.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-sm text-white/70">
                          {m.summary}
                        </pre>
                      </article>
                    ))}
                    {!meetings.length && (
                      <p className="py-16 text-center text-sm text-white/40">No meetings yet.</p>
                    )}
                  </div>
                </section>
              )}

              {tab === "insights" && (
                <ComingSoon
                  title="Your usage"
                  body="Words, WPM, streak and desktop usage charts — next after the Flow Bar lands solid."
                />
              )}

              {tab === "dictionary" && (
                <ListEditor
                  title="Dictionary"
                  subtitle="Correct a spelling once — personal terms stay right in dictations and notes."
                  rows={dict.map((e) => ({ left: e.from, right: e.to }))}
                  leftPh="from"
                  rightPh="to"
                  onChange={(rows) => setDict(rows.map((r) => ({ from: r.left, to: r.right })))}
                  onSave={async () => {
                    await invoke("set_dictionary", { dict: { words: dict } });
                    setStatusMsg("Dictionary saved");
                  }}
                />
              )}

              {tab === "snippets" && (
                <ListEditor
                  title="Snippets"
                  subtitle="Save text you type often, then drop it in with a short trigger."
                  rows={snips.map((s) => ({ left: s.trigger, right: s.expansion }))}
                  leftPh="trigger"
                  rightPh="expansion"
                  onChange={(rows) => setSnips(rows.map((r) => ({ trigger: r.left, expansion: r.right })))}
                  onSave={async () => {
                    await invoke("set_snippets", { snips: { items: snips } });
                    setStatusMsg("Snippets saved");
                  }}
                />
              )}

              {tab === "style" && settings && (
                <section className="space-y-5 p-5">
                  <div className="overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-r from-violet-900/40 to-zinc-900 p-6">
                    <h2 className="font-serif text-2xl">Auto cleanup applies to all dictations</h2>
                    <p className="mt-2 text-sm text-white/55">Original audio/transcript stays local. Pick a cleanup level.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["off", "medium", "high"] as const).map((level) => {
                      const active = settings.cleanupLevel === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setSettings({ ...settings, cleanupLevel: level, autoCleanup: level !== "off" })}
                          className={cx(
                            "rounded-2xl border p-4 text-left transition",
                            active ? "border-white/40 bg-white/8" : "border-white/8 bg-white/[0.03] hover:border-white/20",
                          )}
                        >
                          <p className="font-serif text-xl capitalize">{level === "off" ? "None" : level}</p>
                          <p className="mt-2 text-xs text-white/45">
                            {level === "off" && "Raw transcript, no cleanup."}
                            {level === "medium" && "Filler words and light grammar."}
                            {level === "high" && "Stronger polish and structure."}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  <Button onPress={() => saveSettings(settings)}>Save style</Button>
                </section>
              )}

              {tab === "transforms" && (
                <ComingSoon
                  title="Transforms"
                  body="Polish / prompt-engineer style rewrites after dictation — local prompts next."
                />
              )}

              {tab === "scratchpad" && (
                <ComingSoon
                  title="Scratchpad"
                  body="Quick notes you can come back to — wired after history polish."
                />
              )}

              {tab === "mcp" && (
                <section className="space-y-4 p-5">
                  <p className="max-w-2xl text-sm text-white/55">
                    Sync notes with AI apps on localhost. LocalFlow MCP does not send dictations to the cloud.
                  </p>
                  <pre className="overflow-auto rounded-2xl border border-white/8 bg-black/40 p-5 font-mono text-xs leading-relaxed text-white/75 whitespace-pre-wrap">{`Endpoint: ${mcpHint || "http://127.0.0.1:17832/mcp"}

{
  "mcpServers": {
    "localflow": {
      "url": "${mcpHint || "http://127.0.0.1:17832/mcp"}"
    }
  }
}`}</pre>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      {settingsOpen && settings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-2xl">
            <div className="w-28 shrink-0 border-r border-white/8 p-3 sm:w-44 sm:p-4">
              <p className="mb-3 text-[10px] font-semibold tracking-wider text-white/35 uppercase">Settings</p>
              <nav className="space-y-1" aria-label="Settings sections">
                {(["General", "Models"] as const).map((page) => (
                  <button type="button" key={page} aria-current={settingsPage === page ? "page" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${settingsPage === page ? "bg-white/8" : "text-white/55 hover:bg-white/5"}`}
                    onClick={() => setSettingsPage(page)}>{page}</button>
                ))}
              </nav>
              <p className="mt-auto pt-8 text-[11px] text-white/30">LocalFlow v{__APP_VERSION__}</p>
            </div>
            <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-serif text-2xl">{settingsPage}</h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-full p-2 text-white/40 hover:bg-white/5 hover:text-white"
                >
                  <XClose className="size-5" />
                </button>
              </div>
              {settingsPage === "Models" ? (
                <ModelsSettings selectedId={settings.modelId} onSelectionChange={(modelId) =>
                  setSettings((current) => current && { ...current, modelId })} />
              ) : (
                <div className="space-y-4">

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">

                    <Input

                      label="Language"

                      value={settings.language}

                      onChange={(v) => setSettings({ ...settings, language: v })}

                    />

                    <NativeSelect

                      label="Microphone"

                      hint={micError || undefined}

                      value={settings.inputDevice ?? ""}

                      onChange={(e) =>

                        setSettings({ ...settings, inputDevice: e.target.value || null })

                      }

                      options={[

                        { label: "System default", value: "" },

                        ...(settings.inputDevice && !mics.includes(settings.inputDevice)

                          ? [{ label: `${settings.inputDevice} (unavailable)`, value: settings.inputDevice, disabled: true }]

                          : []),

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

                  </div>

                  <Checkbox

                    isSelected={settings.autoPaste}

                    onChange={(v) => setSettings({ ...settings, autoPaste: v })}

                    label="Auto-paste into focused app"

                  />

                  <Checkbox

                    isSelected={settings.mcpEnabled}

                    onChange={(v) => setSettings({ ...settings, mcpEnabled: v })}

                    label="Enable local MCP HTTP server"

                  />

                  <Input

                    label="MCP port"

                    type="number"

                    value={String(settings.mcpPort)}

                    onChange={(v) => setSettings({ ...settings, mcpPort: Number(v) || 17832 })}

                  />

                  <div className="flex flex-wrap gap-2 pt-2">

                    <Button

                      color="secondary"

                      onPress={() => {

                        saveSettings(settings);

                        setSettingsOpen(false);

                      }}

                    >

                      Save

                    </Button>

                    <Button color="tertiary" isDisabled={updating || checkingUpdate} onPress={checkForUpdates}>

                      {checkingUpdate ? "Checking…" : "Check for updates"}

                    </Button>

                    {updateInfo && (

                      <Button color="secondary" isDisabled={updating || checkingUpdate} onPress={installUpdate}>

                        {updating ? "Installing…" : `Install ${updateInfo.version}`}

                      </Button>

                    )}

                  </div>

                  <p role="status" className="break-words text-sm text-white/70">

                    {updateMessage}

                  </p>

                </div>

              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <section className="p-5">
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-zinc-800 to-zinc-950 p-8">
        <h2 className="font-serif text-3xl">{title}</h2>
        <p className="mt-3 max-w-lg text-sm text-white/55">{body}</p>
      </div>
    </section>
  );
}

function ListEditor({
  title,
  subtitle,
  rows,
  leftPh,
  rightPh,
  onChange,
  onSave,
}: {
  title: string;
  subtitle: string;
  rows: { left: string; right: string }[];
  leftPh: string;
  rightPh: string;
  onChange: (rows: { left: string; right: string }[]) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <section className="space-y-5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-white/50">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button
            color="secondary"
            iconLeading={Plus}
            onPress={() => onChange([...rows, { left: "", right: "" }])}
          >
            Add new
          </Button>
          <Button onPress={onSave}>Save</Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/8">
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid gap-2 border-b border-white/6 p-3 last:border-0 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Input
              value={row.left}
              placeholder={leftPh}
              onChange={(v) => {
                const next = [...rows];
                next[i] = { ...row, left: v };
                onChange(next);
              }}
            />
            <Input
              value={row.right}
              placeholder={rightPh}
              onChange={(v) => {
                const next = [...rows];
                next[i] = { ...row, right: v };
                onChange(next);
              }}
            />
            <Button color="tertiary" onPress={() => onChange(rows.filter((_, idx) => idx !== i))}>
              Remove
            </Button>
          </div>
        ))}
        {!rows.length && (
          <p className="px-4 py-10 text-center text-sm text-white/40">No {title.toLowerCase()} yet.</p>
        )}
      </div>
    </section>
  );
}

declare const __APP_VERSION__: string;
