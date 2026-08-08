import { useNavigate, useRouterState } from '@tanstack/react-router';
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
const processRunningTooltip = 'Please wait for speech synthesis to finish';

type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

function NavGroup({
  label,
  items,
  pathname,
  isNavigationLocked,
  onNavigate,
}: {
  label: string;
  items: readonly NavItem[];
  pathname: string;
  isNavigationLocked: boolean;
  onNavigate: (to: string) => void;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.to;

            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  isActive={isActive}
                  disabled={isNavigationLocked}
                  className={cn(isNavigationLocked && 'cursor-not-allowed')}
                  tooltip={
                    isNavigationLocked
                      ? {
                          children: processRunningTooltip,
                          hidden: false,
                        }
                      : item.description
                  }
                  aria-label={
                    isNavigationLocked
                      ? processRunningTooltip
                      : item.description
                  }
                  onClick={(event) => {
                    if (isNavigationLocked) {
                      event.preventDefault();
                      return;
                    }
                    onNavigate(item.to);
                  }}
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
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isNavigationLocked = useSynthesisLockStore(selectIsSynthesisLocked);

  const goTo = (to: string) => {
    void navigate({ to });
  };

  return (
    <Sidebar collapsible='offcanvas' variant='floating'>
      {/* Clearance for the macOS traffic lights (overlay titlebar). */}
      <div data-tauri-drag-region className='h-11 shrink-0' />

      <SidebarHeader>
        <button
          type='button'
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-2 py-1.5 font-semibold text-foreground text-sm tracking-tight transition-colors duration-200 hover:text-primary focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/30',
            isNavigationLocked && 'cursor-not-allowed opacity-50',
          )}
          disabled={isNavigationLocked}
          title={isNavigationLocked ? processRunningTooltip : undefined}
          aria-label={
            isNavigationLocked
              ? processRunningTooltip
              : 'Go to Kokoro speech playground'
          }
          onClick={() => {
            if (isNavigationLocked) {
              return;
            }
            goTo('/');
          }}
        >
          <span className='grid size-7 place-items-center rounded-full border bg-card text-primary shadow-sm'>
            <AudioLinesIcon className='size-4' aria-hidden />
          </span>
          <span>Kokoro</span>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup
          label='Speech'
          items={speechItems}
          pathname={pathname}
          isNavigationLocked={isNavigationLocked}
          onNavigate={goTo}
        />
        <NavGroup
          label='Listen'
          items={listenItems}
          pathname={pathname}
          isNavigationLocked={isNavigationLocked}
          onNavigate={goTo}
        />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === '/troubleshoot'}
              disabled={isNavigationLocked}
              className={cn(isNavigationLocked && 'cursor-not-allowed')}
              tooltip={
                isNavigationLocked
                  ? {
                      children: processRunningTooltip,
                      hidden: false,
                    }
                  : troubleshootLabel
              }
              aria-label={
                isNavigationLocked ? processRunningTooltip : troubleshootLabel
              }
              onClick={(event) => {
                if (isNavigationLocked) {
                  event.preventDefault();
                  return;
                }
                goTo('/troubleshoot');
              }}
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
