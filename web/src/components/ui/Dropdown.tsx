import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** Popover menu anchored to a trigger, rendered in a portal so it never clips. */

type MenuItem =
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | {
      type?: 'item';
      label: React.ReactNode;
      icon?: React.ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      shortcut?: string;
      checked?: boolean;
    };

export function Dropdown({
  trigger,
  items,
  align = 'end',
  className,
  menuClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const place = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  const toggle = React.useCallback(() => {
    setOpen((prev) => {
      if (!prev) place();
      return !prev;
    });
  }, [place]);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Keep the menu inside the viewport.
  React.useLayoutEffect(() => {
    if (!open || !coords || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    let { top, left } = coords;

    if (align === 'end' && triggerRect) left = triggerRect.right - rect.width;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (left < 8) left = 8;
    if (top + rect.height > window.innerHeight - 8 && triggerRect) {
      top = Math.max(8, triggerRect.top - rect.height - 6);
    }

    if (top !== coords.top || left !== coords.left) setCoords({ ...coords, top, left });
  }, [open, coords, align]);

  return (
    <span className={cn('inline-flex', className)}>
      {trigger({ open, toggle, ref: triggerRef })}
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: coords.top, left: coords.left }}
            className={cn(
              'fixed z-[110] min-w-[190px] animate-scale-in overflow-hidden rounded-xl border border-line bg-elevated p-1 shadow-pop',
              menuClassName,
            )}
          >
            {items.map((item, index) => {
              if ('type' in item && item.type === 'separator') {
                return <div key={index} className="my-1 h-px bg-line" />;
              }
              if ('type' in item && item.type === 'label') {
                return (
                  <div key={index} className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                    {item.label}
                  </div>
                );
              }
              const entry = item as Extract<MenuItem, { onSelect: () => void }>;
              return (
                <button
                  key={index}
                  role="menuitem"
                  disabled={entry.disabled}
                  onClick={() => {
                    setOpen(false);
                    entry.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                    'disabled:pointer-events-none disabled:opacity-40',
                    entry.danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-subtle',
                  )}
                >
                  {entry.icon && <span className="shrink-0 text-muted">{entry.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.checked && <span className="text-accent">✓</span>}
                  {entry.shortcut && <kbd className="shrink-0 text-2xs text-faint">{entry.shortcut}</kbd>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
