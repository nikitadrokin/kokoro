import { create } from 'zustand';

type SynthesisLockState = {
  /** Number of in-flight synthesis jobs. Navigation is blocked while this is > 0. */
  activeJobCount: number;
  beginSynthesis: () => void;
  endSynthesis: () => void;
};

export const useSynthesisLockStore = create<SynthesisLockState>((set) => ({
  activeJobCount: 0,
  beginSynthesis: () =>
    set((state) => ({ activeJobCount: state.activeJobCount + 1 })),
  endSynthesis: () =>
    set((state) => ({
      activeJobCount: Math.max(0, state.activeJobCount - 1),
    })),
}));

export const selectIsSynthesisLocked = (state: SynthesisLockState) =>
  state.activeJobCount > 0;
