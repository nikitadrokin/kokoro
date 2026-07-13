import { createRootRoute, Outlet } from '@tanstack/react-router';
import AppSidebar from '@/components/AppSidebar';
import AppTopbar from '@/components/AppTopbar';
import SynthesisLock from '@/components/SynthesisLock';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
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
      <SidebarProvider className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-hidden">
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
            inert={isSynthesisLocked}
          >
            <AppTopbar />
            <Outlet />
          </div>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
