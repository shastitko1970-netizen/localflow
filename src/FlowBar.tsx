import { useEffect, useState } from "react";
import { Microphone01, Recording01, File06 } from "@untitledui/icons";
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
    <div className="flowbar-shell flex h-screen w-screen flex-col items-center justify-end gap-2 pb-1 select-none">
      <button
        type="button"
        data-tauri-drag-region
        onClick={toggleDictate}
        disabled={busy}
        className={cx(
          "flowbar-pill flex h-11 min-w-[188px] items-center justify-center rounded-full px-6 text-sm text-white shadow-xl transition",
          recording ? "bg-red-600 hover:bg-red-500" : "bg-black/90 hover:bg-black",
        )}
      >
        <span className="pointer-events-none">
          {recording ? "Listening…" : "Dictate"}{" "}
          <span className="font-semibold">{hotkey}</span>
        </span>
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDictate}
          className={cx(
            "flex h-11 items-center justify-center rounded-full px-4 shadow-lg transition",
            recording ? "bg-red-600 text-white" : "bg-zinc-800/95 text-white hover:bg-zinc-700",
          )}
          aria-label="Toggle microphone"
        >
          <Microphone01 className="size-5" />
        </button>
        <button
          type="button"
          onClick={toggleDictate}
          className="flex size-11 items-center justify-center rounded-full bg-black/90 text-white shadow-lg transition hover:bg-zinc-900"
          aria-label="Record"
        >
          <Recording01 className={cx("size-5", recording && "text-red-400")} />
        </button>
        <button
          type="button"
          onClick={() => openMain("history")}
          className="flex size-11 items-center justify-center rounded-full bg-black/90 text-white shadow-lg transition hover:bg-zinc-900"
          aria-label="Open history"
        >
          <File06 className="size-5" />
        </button>
      </div>
    </div>
  );
}
