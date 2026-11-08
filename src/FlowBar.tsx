import { useEffect, useState } from "react";
import { Microphone01, File06 } from "@untitledui/icons";
import { invoke, listen, isTauri } from "@/lib/tauri";
import { cx } from "@/utils/cx";

type AppSettings = {
  pushToTalk: string;
};

function formatHotkey(spec: string) {
  return spec
    .replace(/Super/gi, "Win")
    .replace(/Control/gi, "Ctrl")
    .replace(/\+/g, " + ");
}

function WaveBars({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2" y="6" width="2.5" height="6" rx="1.25" fill="currentColor" opacity={active ? 1 : 0.95} />
      <rect x="7.75" y="3" width="2.5" height="12" rx="1.25" fill="currentColor" />
      <rect x="13.5" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" opacity={active ? 1 : 0.95} />
    </svg>
  );
}

export default function FlowBar() {
  const [recording, setRecording] = useState(false);
  const [hotkey, setHotkey] = useState("Ctrl + Win + Space");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark-mode", "flowbar-root");
    document.body.classList.add("flowbar-body");
    invoke<AppSettings>("get_settings")
      .then((s) => setHotkey(formatHotkey(s.pushToTalk)))
      .catch(() => {});
    const unsubs = [
      listen<boolean>("localflow://recording", (e) => setRecording(e.payload)),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
      document.documentElement.classList.remove("flowbar-root");
      document.body.classList.remove("flowbar-body");
    };
  }, []);

  async function toggleDictate() {
    if (busy) return;
    setBusy(true);
    try {
      if (recording) {
        await invoke("stop_dictation");
        setRecording(false);
      } else {
        await invoke("start_dictation");
        setRecording(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function openMain(tab?: string) {
    if (!isTauri) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
        if (tab) {
          await main.emit("localflow://navigate", tab);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div
      className={cx(
        "flowbar-shell flex h-screen w-screen items-end justify-center pb-2 select-none",
        !isTauri && "flowbar-shell--preview",
      )}
    >
      <div className="flowbar-glass" data-tauri-drag-region>
        <button
          type="button"
          className={cx("flowbar-dictate", recording && "is-recording")}
          onClick={toggleDictate}
          disabled={busy}
        >
          <span className="flowbar-dictate-label">
            {recording ? "Listening…" : "Dictate"}
          </span>
          <span className="flowbar-dictate-keys">{hotkey}</span>
        </button>

        <div className="flowbar-actions">
          <button
            type="button"
            className={cx("flowbar-orb flowbar-orb--mic", recording && "is-live")}
            onClick={toggleDictate}
            aria-label="Microphone"
            disabled={busy}
          >
            <Microphone01 className="size-[18px]" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={cx("flowbar-orb", recording && "is-live")}
            onClick={toggleDictate}
            aria-label="Waveform"
            disabled={busy}
          >
            <WaveBars active={recording} />
          </button>
          <button
            type="button"
            className="flowbar-orb"
            onClick={() => openMain("dictation")}
            aria-label="Notes"
          >
            <File06 className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
