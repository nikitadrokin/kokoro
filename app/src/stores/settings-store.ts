import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PLAYBACK_MODES = ['stream', 'save-stream', 'save-silent'] as const;

export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

type SettingsState = {
  playbackMode: PlaybackMode;
  setPlaybackMode: (playbackMode: PlaybackMode) => void;
};

export const isPlaybackMode = (value: string): value is PlaybackMode =>
  PLAYBACK_MODES.includes(value as PlaybackMode);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      playbackMode: 'save-stream',
      setPlaybackMode: (playbackMode) => set({ playbackMode }),
    }),
    {
      name: 'kokoro-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
