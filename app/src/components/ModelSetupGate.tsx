import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

type ModelStatus = {
  installed: boolean;
  downloading: boolean;
  missingBytes: number;
  totalBytes: number;
  modelsDir: string;
};

type ModelDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number;
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'missing'; status: ModelStatus; error: string | null }
  | { kind: 'downloading'; progress: ModelDownloadProgress };

const MODEL_DOWNLOAD_PROGRESS_EVENT = 'model-download-progress';

/**
 * Kokoro's voice model is downloaded separately from the app so updates stay
 * small. Until it's installed, show a setup screen instead of the app.
 */
export default function ModelSetupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });

  const refreshStatus = useCallback(async (error: string | null = null) => {
    try {
      const status = await invoke<ModelStatus>('model_status');
      if (status.installed) {
        setState({ kind: 'ready' });
      } else if (status.downloading) {
        setState({
          kind: 'downloading',
          progress: { downloadedBytes: 0, totalBytes: status.missingBytes },
        });
      } else {
        setState({ kind: 'missing', status, error });
      }
    } catch (statusError) {
      // Never lock people out of the app because the check itself failed.
      console.error('Could not read model status', statusError);
      setState({ kind: 'ready' });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const unlisten = listen<ModelDownloadProgress>(
      MODEL_DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        setState((current) =>
          current.kind === 'downloading'
            ? { kind: 'downloading', progress: event.payload }
            : current,
        );
        // Covers a webview reload mid-download, where nothing awaits the
        // original `download_model` call anymore.
        const { downloadedBytes, totalBytes } = event.payload;
        if (totalBytes > 0 && downloadedBytes >= totalBytes) {
          void refreshStatus();
        }
      },
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [refreshStatus]);

  async function startDownload(totalBytes: number) {
    setState({
      kind: 'downloading',
      progress: { downloadedBytes: 0, totalBytes },
    });

    try {
      await invoke('download_model');
      await refreshStatus();
    } catch (error) {
      await refreshStatus(formatError(error));
    }
  }

  if (state.kind === 'ready') {
    return children;
  }

  return (
    <main
      data-tauri-drag-region
      className="flex h-dvh items-center justify-center bg-background p-6 text-foreground"
    >
      {state.kind === 'checking' ? null : (
        <div className="flex w-full max-w-md flex-col gap-5">
          <div className="space-y-2">
            <h1 className="font-semibold text-2xl tracking-tight">
              Download the voice model
            </h1>
            <p className="text-muted-foreground text-sm">
              Kokoro needs its voice model to speak. It's a one-time download
              that stays on your Mac, so app updates won't download it again.
            </p>
          </div>

          {state.kind === 'missing' ? (
            <>
              {state.error ? (
                <p className="text-destructive text-sm" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="self-start"
                onClick={() => void startDownload(state.status.missingBytes)}
              >
                <DownloadIcon aria-hidden="true" />
                {state.error ? 'Try again' : 'Download'} (
                {formatBytes(state.status.missingBytes)})
              </Button>
            </>
          ) : (
            <DownloadProgress progress={state.progress} />
          )}
        </div>
      )}
    </main>
  );
}

function DownloadProgress({ progress }: { progress: ModelDownloadProgress }) {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <Progress value={percent} aria-label="Voice model download progress" />
      <p className="flex items-center gap-2 text-muted-foreground text-sm tabular-nums">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        {formatBytes(progress.downloadedBytes)} of{' '}
        {formatBytes(progress.totalBytes)}
      </p>
    </div>
  );
}

function formatBytes(bytes: number) {
  const megabytes = bytes / 1_000_000;
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'The download failed.';
}
