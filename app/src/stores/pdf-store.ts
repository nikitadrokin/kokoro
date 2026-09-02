import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type LastOpenedPdf = {
  fileName: string;
  filePath: string;
  fileSize: number;
  fileLastModified: number;
  title: string;
  pageNumber: number;
  openedAt: number;
};

type PdfState = {
  lastOpenedPdf: LastOpenedPdf | null;
  setLastOpenedPdf: (pdf: Omit<LastOpenedPdf, 'openedAt'>) => void;
  setLastOpenedPdfPage: (pageNumber: number) => void;
  clearLastOpenedPdf: () => void;
};

export const usePdfStore = create<PdfState>()(
  persist(
    (set) => ({
      lastOpenedPdf: null,
      setLastOpenedPdf: (pdf) =>
        set({ lastOpenedPdf: { ...pdf, openedAt: Date.now() } }),
      setLastOpenedPdfPage: (pageNumber) =>
        set((state) =>
          state.lastOpenedPdf
            ? {
                lastOpenedPdf: {
                  ...state.lastOpenedPdf,
                  pageNumber,
                },
              }
            : state,
        ),
      clearLastOpenedPdf: () => set({ lastOpenedPdf: null }),
    }),
    {
      name: 'kokoro-pdf',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
