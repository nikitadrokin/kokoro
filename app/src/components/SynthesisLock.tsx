import { useBlocker } from '@tanstack/react-router';
import { useSynthesisLockStore } from '@/stores/synthesis-lock-store';

/**
 * Silently blocks router navigation and window unload while synthesis
 * jobs are in flight. No overlay — the current page stays fully visible
 * and scrollable; the sidebar and other chrome disable navigation via
 * the synthesis lock store (Photo Bridge style).
 */
export default function SynthesisLock() {
  useBlocker({
    shouldBlockFn: () => useSynthesisLockStore.getState().activeJobCount > 0,
    enableBeforeUnload: () =>
      useSynthesisLockStore.getState().activeJobCount > 0,
    // No confirm dialog — navigation is simply prevented until the job ends.
    withResolver: false,
  });

  return null;
}
