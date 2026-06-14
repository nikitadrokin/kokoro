import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DEFAULT_PLAYGROUND_TEXT =
  'Hello from Kokoro. Generate speech here, then play it immediately in the app.';

type PlaygroundState = {
  draftText: string;
  setDraftText: (draftText: string) => void;
};

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (set) => ({
      draftText: DEFAULT_PLAYGROUND_TEXT,
      setDraftText: (draftText) => set({ draftText }),
    }),
    {
      name: 'kokoro-playground',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
