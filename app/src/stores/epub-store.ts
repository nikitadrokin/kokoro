import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type EpubChapterResume = {
  listItemKey: string;
  id: string;
  label: string;
  selector: string;
  index: number;
  updatedAt: number;
};

export type LastOpenedEpub = {
  id: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  importedPath: string;
  originalPath?: string;
  title: string;
  openedAt: number;
  activeChapter: EpubChapterResume | null;
};

type OpenedEpubInput = Omit<LastOpenedEpub, 'openedAt'>;

type EpubState = {
  lastOpenedBook: LastOpenedEpub | null;
  setLastOpenedBook: (book: OpenedEpubInput) => void;
  setLastOpenedBookChapter: (activeChapter: EpubChapterResume) => void;
  clearLastOpenedBook: () => void;
};

export const useEpubStore = create<EpubState>()(
  persist(
    (set) => ({
      lastOpenedBook: null,
      setLastOpenedBook: (book) =>
        set({
          lastOpenedBook: {
            ...book,
            openedAt: Date.now(),
          },
        }),
      setLastOpenedBookChapter: (activeChapter) =>
        set((state) =>
          state.lastOpenedBook
            ? {
                lastOpenedBook: {
                  ...state.lastOpenedBook,
                  activeChapter,
                },
              }
            : state,
        ),
      clearLastOpenedBook: () => set({ lastOpenedBook: null }),
    }),
    {
      name: 'kokoro-epub',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
