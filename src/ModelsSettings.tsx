import { useCallback, useEffect, useState } from "react";
import { Download01, LinkExternal01, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { invoke, isTauri } from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";

type Model = {
  id: string;
  label: string;
  sizeBytes: number;
  installed: boolean;
  recommended: boolean;
};

type Props = {
  selectedId: string;
  onSelectionChange: (modelId: string) => void;
};

function formatSize(bytes: number) {
  const mib = bytes / 1024 ** 2;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`;
}

export function ModelsSettings({ selectedId, onSelectionChange }: Props) {
  const [models, setModels] = useState<Model[]>([]);
  const [loadedFile, setLoadedFile] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Model | null>(null);
  const refresh = useCallback(async () => {
    const [inventory, status] = await Promise.all([
      invoke<Model[]>("list_models"),
      invoke<{ modelPath?: string | null }>("get_status"),
    ]);
    setModels(inventory);
    setLoadedFile(status.modelPath?.split(/[\\/]/).pop() ?? "");
  }, []);

  useEffect(() => { void refresh().catch((cause) => setError(String(cause))); }, [refresh]);

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await work();
      await refresh();
      setMessage("Model library updated.");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy("");
    }
  }

  const installed = models.filter((model) => model.installed);
  const recommended = models.filter((model) => model.recommended && !model.installed);
  const selected = installed.find((model) => model.id === selectedId);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/4 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-white/45">Dictation model</p>
        <p className="mt-1 break-words text-sm font-semibold">{selected?.label ?? "No installed model selected"}</p>
        <p className="mt-1 text-xs text-white/55">
          {selected && loadedFile === selected.id ? "Loaded and ready" :
            selected ? "Loads when you start dictating" : "Download or import a model, then choose Use."}
        </p>
      </div>

      <section aria-label="Installed models">
        <h3 className="mb-2 text-sm font-semibold">Installed</h3>
        {installed.length === 0 && <p className="text-sm text-white/50">Your downloaded models will appear here.</p>}
        <div className="divide-y divide-white/8">
          {installed.map((model) => (
            <div key={model.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="break-all text-sm">{model.label}</p>
                <p className="text-xs text-white/50">{formatSize(model.sizeBytes)}{model.id === selectedId && " · Selected"}</p>
              </div>
              <div className="flex gap-2">
                {model.id !== selectedId && (
                  <Button size="sm" color="secondary" isDisabled={!!busy} onPress={() => void run("Loading model…", async () => {
                    await invoke("ensure_model", { modelId: model.id });
                    onSelectionChange(model.id);
                  })}>Use</Button>
                )}
                <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Delete ${model.label}`}
                  isDisabled={!!busy} onPress={() => setConfirmDelete(model)} />
              </div>
            </div>
          ))}
        </div>
        {confirmDelete && (
          <div className="mt-2 rounded-lg border border-white/12 p-3 text-sm">
            <p className="break-words">Remove {confirmDelete.label} from this computer?</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" color="secondary" onPress={() => setConfirmDelete(null)}>Cancel</Button>
              <Button size="sm" color="primary" onPress={() => {
                const model = confirmDelete;
                setConfirmDelete(null);
                void run("Removing model…", async () => {
                  await invoke("delete_model", { modelId: model.id });
                  if (selectedId === model.id) onSelectionChange("");
                });
              }}>Remove</Button>
            </div>
          </div>
        )}
      </section>

      {recommended.length > 0 && (
        <section aria-label="Recommended models">
          <h3 className="mb-2 text-sm font-semibold">Recommended</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {recommended.map((model) => (
              <div key={model.id} className="min-w-0 rounded-xl border border-white/10 px-3 py-2.5">
                <p className="text-sm font-medium">{model.label}</p>
                <p className="mb-2 text-xs text-white/50">{formatSize(model.sizeBytes)}</p>
                <Button size="sm" color="secondary" iconLeading={Download01} isDisabled={!!busy}
                  onPress={() => void run(`Downloading ${model.label}…`, () => invoke("download_model", { modelId: model.id }))}>
                  Download
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2 border-t border-white/10 pt-4" aria-label="Import from Hugging Face">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Import from Hugging Face</h3>
          <a href="https://huggingface.co/ggerganov/whisper.cpp/tree/main" target="_blank" rel="noreferrer"
            onClick={(event) => {
              if (!isTauri) return;
              event.preventDefault();
              void openUrl(event.currentTarget.href).catch((cause) => setError(String(cause)));
            }}
            className="inline-flex items-center gap-1 text-xs text-white/65 hover:text-white">
            Browse Whisper models <LinkExternal01 className="size-3" />
          </a>
        </div>
        <Input label="Public model file URL" placeholder="https://huggingface.co/…/blob/main/ggml-model.bin"
          value={link} onChange={setLink} />
        <p className="text-xs text-white/50">Paste a link to a Whisper GGML .bin file. LocalFlow checks that Whisper can open it.</p>
        <Button size="sm" iconLeading={Download01} isDisabled={!!busy || !link.trim()}
          onPress={() => void run("Downloading and validating model…", async () => {
            await invoke("import_model", { url: link });
            setLink("");
          })}>Import model</Button>
      </section>
      {(busy || message || error) && (
        <p role={error ? "alert" : "status"} className={`sticky bottom-0 rounded-lg bg-[#222] px-3 py-2 text-sm break-words ${error ? "text-red-300" : "text-white/80"}`}>
          {busy || error || message}
        </p>
      )}
    </div>
  );
}
