import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

export type FileRowMenuAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type FileRowContextMenuProps = {
  actions: FileRowMenuAction[];
  /** Layout classes for the row element itself (the right-click target). */
  className?: string;
  children: ReactNode;
};

/**
 * Wraps a file list row so right-clicking anywhere on it opens a menu of
 * file actions. The row is the trigger element, so pass the row's layout
 * classes via `className`. Adds the `group/file-row` group so quick-action
 * buttons inside the row can reveal themselves on shift+hover (see
 * `quickActionClass`).
 */
export function FileRowContextMenu({
  actions,
  className,
  children,
}: FileRowContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className={cn('group/file-row', className)}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {actions.map((action) => (
          <ContextMenuItem
            key={action.key}
            variant={action.destructive ? 'destructive' : 'default'}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Visibility classes for a row's inline quick-action buttons: hidden by
 * default, revealed while the row is hovered with Shift held, and pinned
 * visible while the action is busy or awaiting delete confirmation.
 */
export function quickActionClass(
  isShiftHeld: boolean,
  isPinned: boolean,
): string {
  if (isPinned) {
    return '';
  }
  return isShiftHeld ? 'hidden group-hover/file-row:inline-flex' : 'hidden';
}
