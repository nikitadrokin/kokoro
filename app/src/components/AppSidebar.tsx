import { Link, useRouterState } from '@tanstack/react-router';
import {
  AudioLinesIcon,
  BookOpenIcon,
  HeadphonesIcon,
  MailIcon,
  ShieldAlertIcon,
  WandSparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  selectIsSynthesisLocked,
  useSynthesisLockStore,
} from '@/stores/synthesis-lock-store';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';

const speechItems = [
  {
    to: '/',
    label: 'Generate speech',
    description: 'Generate and audition Kokoro audio',
    icon: AudioLinesIcon,
  },
  {
    to: '/speech/optimize',
    label: 'Optimize text',
    description: 'Prepare Markdown for text to speech',
    icon: WandSparkles,
  },
] as const;

const listenItems = [
  {
    to: '/mail',
    label: 'Mail',
    description: 'Listen to Gmail locally with on-device speech',
    icon: MailIcon,
  },
  {
    to: '/epub',
    label: 'EPUB reader',
    description: 'Open books and browse chapters inline',
    icon: BookOpenIcon,
  },
  {
    to: '/library',
    label: 'Library',
    description: 'Browse and play saved audio',
    icon: HeadphonesIcon,
  },
] as const;

const troubleshootLabel = 'Fix "not verified" / codesign errors';

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: readonly {
    to: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }[];
  pathname: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  isActive={pathname === item.to}
                  tooltip={item.description}
                  render={<Link to={item.to} />}
                  aria-label={item.description}
                >
                  <Icon className='text-muted-foreground' aria-hidden />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default function AppSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isNavigationLocked = useSynthesisLockStore(selectIsSynthesisLocked);

  return (
    <Sidebar
      collapsible='offcanvas'
      variant='floating'
      aria-hidden={isNavigationLocked}
      className={cn(isNavigationLocked && 'pointer-events-none opacity-60')}
    >
      {/* Clearance for the macOS traffic lights (overlay titlebar). */}
      <div data-tauri-drag-region className='h-11 shrink-0' />

      <SidebarHeader>
        <Link
          to='/'
          className='inline-flex items-center gap-2 rounded-full px-2 py-1.5 font-semibold text-foreground text-sm tracking-tight no-underline transition-colors duration-200 hover:text-primary focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/30'
          aria-label='Go to Kokoro speech playground'
        >
          <span className='grid size-7 place-items-center rounded-full border bg-card text-primary shadow-sm'>
            <AudioLinesIcon className='size-4' aria-hidden />
          </span>
          <span>Kokoro</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup label='Speech' items={speechItems} pathname={pathname} />
        <NavGroup label='Listen' items={listenItems} pathname={pathname} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === '/troubleshoot'}
              tooltip={troubleshootLabel}
              render={<Link to='/troubleshoot' />}
              aria-label={troubleshootLabel}
            >
              <ShieldAlertIcon className='text-muted-foreground' aria-hidden />
              <span>Troubleshoot</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
