import { useEffect, useState } from "react";
import { Check, File06, Microphone01, Recording01, XClose } from "@untitledui/icons";
import { invoke, listen, isTauri } from "@/lib/tauri";

type Phase = "idle" | "starting" | "processing";
type Action = "dictate" | "notetaker" | "scratchpad";

export default function FlowBar() {
  const [recording, setRecording] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hotkey, setHotkey] = useState("Ctrl + Win + Space");
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<Action>("dictate");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const subscriptions = [
      listen<boolean>("localflow://recording", ({ payload }) => {
        setRecording(payload);
        if (payload) setExpanded(false);
      }),
      listen<Phase>("localflow://flow-phase", ({ payload }) => {
        setPhase(payload);
        if (payload === "starting") setError("");
      }),
      listen<string>("localflow://error", ({ payload }) => setError(payload)),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((dispose) => dispose()));
  }, []);

  useEffect(() => {
    if (!recording || !isTauri) return;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        setLevel(Math.min(1, Math.sqrt(await invoke<number>("mic_level")) * 2.5));
      } catch {
        setLevel(0);
      } finally {
        pending = false;
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function dictate(command: "start_dictation" | "stop_dictation" | "cancel_dictation") {
    const starting = command === "start_dictation";
    setExpanded(false);
    setError("");
    setLevel(0);
    setPhase(starting ? "starting" : "processing");
    if (!starting) setRecording(false);
    try {
      await invoke(command);
      setRecording(starting);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPhase("idle");
    }
  }

  function expand() {
    setAction("dictate");
    setExpanded(true);
    void invoke<{ pushToTalk: string }>("get_settings").then(({ pushToTalk }) =>
      setHotkey(pushToTalk.replace(/Super/gi, "Win").replace(/\+/g, " + ")),
    ).catch(console.error);
  }

  async function openMain(tab: Action) {
    if (!isTauri) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (!main) return;
      await main.show();
      await main.setFocus();
      await main.emit("localflow://navigate", tab);
      setExpanded(false);
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <main className={`flowbar-shell ${isTauri ? "" : "flowbar-preview"}`}>
      {error ? (
        <div className="flowbar-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss" onClick={() => setError("")}><XClose /></button>
        </div>
      ) : recording && phase !== "processing" ? (
        <div className="flowbar-capture" aria-label="Recording">
          <button aria-label="Cancel recording" onClick={() => void dictate("cancel_dictation")}><XClose /></button>
          <span className="flowbar-wave" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} style={{ height: 2 + (isTauri ? level : 0.6) * (5 + index % 4 * 3), animationDelay: `${index * -83}ms` }} />
            ))}
          </span>
          <button className="flowbar-confirm" aria-label="Finish recording" onClick={() => void dictate("stop_dictation")}><Check /></button>
        </div>
      ) : phase !== "idle" ? (
        <div className="flowbar-progress" role="status">{phase === "starting" ? "Preparing…" : "Transcribing…"}</div>
      ) : (
        <div className="flowbar-menu" onMouseLeave={() => setExpanded(false)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
          }}>
          {expanded ? (
            <>
              <div className={`flowbar-tip flowbar-tip--${action}`}>
                {action === "dictate" ? <>Dictate <strong>{hotkey}</strong></> :
                  action === "notetaker" ? "Notetaker" : "Scratchpad"}
              </div>
              <div className="flowbar-actions">
                <button aria-label="Dictate" onMouseEnter={() => setAction("dictate")}
                  onFocus={() => setAction("dictate")} onClick={() => void dictate("start_dictation")}><Microphone01 /></button>
                <button aria-label="Notetaker" onMouseEnter={() => setAction("notetaker")}
                  onFocus={() => setAction("notetaker")} onClick={() => void openMain("notetaker")}><Recording01 /></button>
                <button aria-label="Scratchpad" onMouseEnter={() => setAction("scratchpad")}
                  onFocus={() => setAction("scratchpad")} onClick={() => void openMain("scratchpad")}><File06 /></button>
              </div>
            </>
          ) : (
            <button className="flowbar-handle" aria-label="Open dictation controls" onMouseEnter={expand} onClick={expand} />
          )}
        </div>
      )}
    </main>
  );
}
