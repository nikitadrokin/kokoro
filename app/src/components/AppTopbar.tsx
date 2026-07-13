import { cn } from '@/lib/utils';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';
import ThemeToggle from './ThemeToggle';
import UpdateButton from './UpdateButton';
import { Badge } from './ui/badge';
import { SidebarTrigger, useSidebar } from './ui/sidebar';

export default function AppTopbar() {
  const isNavigationLocked = useSynthesisLockStore(selectIsSynthesisLocked);
  const { state, isMobile } = useSidebar();
  // When the sidebar is hidden, the macOS traffic lights (overlay titlebar)
  // sit over the top-left of the content area.
  const clearTrafficLights = isMobile || state === 'collapsed';

  return (
    <header
      data-tauri-drag-region
      aria-hidden={isNavigationLocked}
      className={cn(
        'sticky top-0 z-50 flex h-11 shrink-0 items-center gap-2 border-b bg-background/90 pr-4 backdrop-blur transition-[padding] duration-200 supports-backdrop-filter:bg-background/70',
        clearTrafficLights ? 'pl-[88px]' : 'pl-2',
        isNavigationLocked && 'pointer-events-none opacity-60',
      )}
    >
      <SidebarTrigger aria-label="Toggle sidebar" />

      <div className="ml-auto flex items-center gap-2">
        {import.meta.env.DEV && (
          <Badge className="h-7 select-none rounded-full bg-orange-500/15 px-3 py-0.5 font-mono font-semibold text-[11px] text-orange-500 ring-1 ring-orange-500/30">
            dev
          </Badge>
        )}
        <UpdateButton />
        <ThemeToggle />
      </div>
    </header>
  );
}
