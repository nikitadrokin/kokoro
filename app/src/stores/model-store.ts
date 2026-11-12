import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';

export type ModelSource = 'downloaded' | 'bundled' | 'development';

export type ModelStatus = {
  installed: boolean;
  source: ModelSource | null;
  /** A model task (download, migration, verify, delete) is running in the backend. */
  busy: boolean;
  missingBytes: number;
  totalBytes: number;
  modelsDir: string;
};

export type ModelDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number;
};

type ModelTask = 'download' | 'verify' | 'delete';

type ModelState = {
  status: ModelStatus | null;
  /** Task started from this window. */
  task: ModelTask | null;
  progress: ModelDownloadProgress | null;
  error: string | null;
  refresh: () => Promise<void>;
  download: () => Promise<void>;
  verify: () => Promise<boolean | null>;
  deleteDownloaded: () => Promise<void>;
};

const MODEL_DOWNLOAD_PROGRESS_EVENT = 'model-download-progress';
const MODEL_STATUS_CHANGED_EVENT = 'model-status-changed';

export const useModelStore = create<ModelState>((set, get) => ({
  status: null,
  task: null,
  progress: null,
  error: null,

  refresh: async () => {
    try {
      const status = await invoke<ModelStatus>('model_status');
      set({ status });
    } catch (error) {
      set({ error: formatError(error, 'Could not check the voice model.') });
    }
  },

  download: async () => {
    if (get().task) {
      return;
    }
    const missingBytes = get().status?.missingBytes ?? 0;
    set({
      task: 'download',
      error: null,
      progress: { downloadedBytes: 0, totalBytes: missingBytes },
    });
    try {
      await invoke('download_model');
    } catch (error) {
      set({ error: formatError(error, 'The voice model download failed.') });
    } finally {
      set({ task: null, progress: null });
      await get().refresh();
    }
  },

  verify: async () => {
    if (get().task) {
      return null;
    }
    set({ task: 'verify', error: null });
    try {
      return await invoke<boolean>('verify_model');
    } catch (error) {
      set({ error: formatError(error, 'Could not verify the voice model.') });
      return null;
    } finally {
      set({ task: null });
      await get().refresh();
    }
  },

  deleteDownloaded: async () => {
    if (get().task) {
      return;
    }
    set({ task: 'delete', error: null });
    try {
      await invoke('delete_downloaded_model');
    } catch (error) {
      set({ error: formatError(error, 'Could not delete the voice model.') });
    } finally {
      set({ task: null });
      await get().refresh();
    }
  },
}));

/** The model is on disk and nothing is currently modifying it. */
export const selectIsModelReady = (state: ModelState) =>
  state.status?.installed === true &&
  state.task !== 'verify' &&
  state.task !== 'delete';

export const selectIsModelDownloading = (state: ModelState) =>
  state.task === 'download' ||
  // A download started before a webview reload is still running.
  (state.task === null &&
    state.status?.busy === true &&
    !state.status.installed);

export const selectModelDownloadPercent = (state: ModelState) => {
  const progress = state.progress;
  if (!progress || progress.totalBytes <= 0) {
    return 0;
  }
  return Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100);
};

/**
 * Loads the model status, keeps it in sync with backend events, and starts
 * the download automatically when the model is missing. Returns a cleanup.
 */
export function startModelSync() {
  const store = useModelStore;

  const unlistenProgress = listen<ModelDownloadProgress>(
    MODEL_DOWNLOAD_PROGRESS_EVENT,
    (event) => store.setState({ progress: event.payload }),
  );
  const unlistenStatus = listen(MODEL_STATUS_CHANGED_EVENT, () => {
    void store.getState().refresh();
  });

  void (async () => {
    await store.getState().refresh();
    const { status, task } = store.getState();
    if (status && !status.installed && !status.busy && !task) {
      void store.getState().download();
    }
  })();

  return () => {
    void unlistenProgress.then((dispose) => dispose());
    void unlistenStatus.then((dispose) => dispose());
  };
}

export function formatBytes(bytes: number) {
  const megabytes = bytes / 1_000_000;
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

export const modelUnavailableMessage = (isDownloading: boolean) =>
  isDownloading
    ? 'The voice model is still downloading.'
    : 'The voice model isn’t downloaded. Download it from Settings.';

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}
