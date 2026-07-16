import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PLAYBACK_MODES = ['stream', 'save-stream', 'save-silent'] as const;

export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export const DEFAULT_VOICE = 'af_heart';

type SettingsState = {
  playbackMode: PlaybackMode;
  setPlaybackMode: (playbackMode: PlaybackMode) => void;
  voice: string;
  setVoice: (voice: string) => void;
};

export const isPlaybackMode = (value: string): value is PlaybackMode =>
  PLAYBACK_MODES.includes(value as PlaybackMode);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      playbackMode: 'save-silent',
      setPlaybackMode: (playbackMode) => set({ playbackMode }),
      voice: DEFAULT_VOICE,
      setVoice: (voice) => set({ voice }),
    }),
    {
      name: 'kokoro-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
