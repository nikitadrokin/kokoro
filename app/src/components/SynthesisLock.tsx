import { useBlocker } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';

export default function SynthesisLock() {
  const isLocked = useSynthesisLockStore(selectIsSynthesisLocked);

  useBlocker({
    shouldBlockFn: () => useSynthesisLockStore.getState().activeJobCount > 0,
    enableBeforeUnload: () =>
      useSynthesisLockStore.getState().activeJobCount > 0,
  });

  if (!isLocked) {
    return null;
  }

  return (
    <div
      className='fixed inset-0 z-200 flex items-start justify-center bg-background/40 backdrop-blur-[1px]'
      role='alertdialog'
      aria-modal='true'
      aria-labelledby='synthesis-lock-title'
      aria-describedby='synthesis-lock-description'
    >
      <div className='mt-24 flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg'>
        <LoaderCircle
          className='size-4 animate-spin text-primary'
          aria-hidden='true'
        />
        <div>
          <p id='synthesis-lock-title' className='font-medium text-sm'>
            Generating audio
          </p>
          <p
            id='synthesis-lock-description'
            className='text-muted-foreground text-xs'
          >
            Navigation and controls are disabled until synthesis finishes.
          </p>
        </div>
      </div>
    </div>
  );
}
