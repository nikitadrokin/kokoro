import { Link, useRouterState } from '@tanstack/react-router';
import {
  AudioLinesIcon,
  BookOpenIcon,
  HeadphonesIcon,
  WandSparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ThemeToggle from './ThemeToggle';
import UpdateButton from './UpdateButton';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from './ui/navigation-menu';
import { Badge } from './ui/badge';

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

const navItems = [
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

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isSpeechActive = pathname === '/' || pathname.startsWith('/speech');

  return (
    <header
      data-tauri-drag-region
      className='sticky top-0 z-50 border-b bg-background/90 pl-[88px] pr-4 backdrop-blur supports-backdrop-filter:bg-background/70'
    >
      <NavigationMenu className='min-w-full flex-1 justify-start' align='start'>
        <NavigationMenuList className='w-full justify-start gap-1 overflow-x-auto py-2'>
          <Link
            to='/'
            className='inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 font-semibold text-foreground text-sm tracking-tight no-underline transition-colors hover:text-primary focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/30'
            aria-label='Go to Kokoro speech playground'
          >
            <span className='grid size-7 place-items-center rounded-full border bg-card text-primary shadow-sm'>
              <AudioLinesIcon className='size-4' aria-hidden='true' />
            </span>
            <span className='hidden sm:inline'>Kokoro</span>
          </Link>

          <NavigationMenuItem>
            <NavigationMenuTrigger
              className={cn(
                'h-9 gap-1.5 whitespace-nowrap rounded-full px-3 py-2 font-medium',
                isSpeechActive && 'bg-muted text-foreground',
              )}
              aria-label='Speech tools'
            >
              <AudioLinesIcon
                className='size-4 text-muted-foreground'
                aria-hidden='true'
              />
              <span>Speech</span>
            </NavigationMenuTrigger>
            <NavigationMenuContent className='w-[min(28rem,calc(100vw-2rem))]'>
              <div className='grid gap-1'>
                {speechItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.to;

                  return (
                    <NavigationMenuLink
                      key={item.to}
                      active={isActive}
                      render={<Link to={item.to} />}
                      className='grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-2xl px-3 py-3'
                      aria-label={item.description}
                    >
                      <Icon
                        className='mt-0.5 size-4 text-muted-foreground'
                        aria-hidden='true'
                      />
                      <span className='font-medium'>{item.label}</span>
                      <span className='col-start-2 text-muted-foreground text-xs leading-5'>
                        {item.description}
                      </span>
                    </NavigationMenuLink>
                  );
                })}
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.to;

            return (
              <NavigationMenuItem key={item.to}>
                <NavigationMenuLink
                  active={isActive}
                  render={<Link to={item.to} />}
                  className={cn(
                    'h-9 whitespace-nowrap rounded-full px-3 py-2 font-medium',
                    'data-[active=true]:bg-muted data-[active=true]:text-foreground',
                  )}
                  aria-label={item.description}
                >
                  <Icon
                    className='size-4 text-muted-foreground'
                    aria-hidden='true'
                  />
                  <span>{item.label}</span>
                </NavigationMenuLink>
              </NavigationMenuItem>
            );
          })}

          <div className='ml-auto flex items-center gap-2'>
            {import.meta.env.DEV && (
              <Badge className='h-7 select-none rounded-full bg-orange-500/15 px-3 py-0.5 font-mono text-[11px] font-semibold text-orange-500 ring-1 ring-orange-500/30'>
                dev
              </Badge>
            )}
            <UpdateButton />
            <ThemeToggle />
          </div>
        </NavigationMenuList>
      </NavigationMenu>
    </header>
  );
}
