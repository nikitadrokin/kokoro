import { useEffect, useState } from 'react';

/**
 * Tracks whether the Shift key is currently held, so rows can surface
 * quick-action buttons (Discord-style) while the user hovers with Shift.
 */
export function useShiftHeld(): boolean {
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  useEffect(() => {
    const syncFromEvent = (event: KeyboardEvent) => {
      setIsShiftHeld(event.shiftKey);
    };
    const reset = () => setIsShiftHeld(false);

    window.addEventListener('keydown', syncFromEvent);
    window.addEventListener('keyup', syncFromEvent);
    window.addEventListener('blur', reset);

    return () => {
      window.removeEventListener('keydown', syncFromEvent);
      window.removeEventListener('keyup', syncFromEvent);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return isShiftHeld;
}
