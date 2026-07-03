import { createRootRoute, Outlet } from '@tanstack/react-router';
import Header from '@/components/Header';
import SynthesisLock from '@/components/SynthesisLock';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const isSynthesisLocked = useSynthesisLockStore(selectIsSynthesisLocked);

  return (
    <TooltipProvider>
      <SynthesisLock />
      <div className='flex h-dvh flex-col overflow-hidden bg-background text-foreground'>
        <div
          className='min-h-0 flex-1 overflow-y-auto overscroll-y-contain'
          inert={isSynthesisLocked}
        >
          <Header />
          <Outlet />
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
