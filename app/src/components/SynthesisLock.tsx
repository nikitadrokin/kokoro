import { useBlocker } from '@tanstack/react-router';
import { useSynthesisLockStore } from '@/stores/synthesis-lock-store';

/**
 * Blocks router navigation and window unload while synthesis jobs are
 * in flight. Renders nothing — individual controls disable themselves
 * via the synthesis lock store instead of a full-screen overlay.
 */
export default function SynthesisLock() {
  useBlocker({
    shouldBlockFn: () => useSynthesisLockStore.getState().activeJobCount > 0,
    enableBeforeUnload: () =>
      useSynthesisLockStore.getState().activeJobCount > 0,
  });

  return null;
}
