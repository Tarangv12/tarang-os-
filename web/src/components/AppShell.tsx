import * as React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, CalendarDays, CheckSquare, ClipboardList, Flame, Focus, Home, Layers,
  LayoutGrid, Lock, LogOut, Moon, MoreHorizontal, NotebookPen, Plus, Search, Settings as SettingsIcon,
  Sun, Target, TrendingUp, History as HistoryIcon, Command,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/state/auth';
import { useTheme } from '@/state/theme';
import { IconButton, Tooltip } from './ui/primitives';
import { Dropdown } from './ui/Dropdown';
import { QuickCapture } from './QuickCapture';
import { CommandPalette } from './CommandPalette';

export type NavEntry = { to: string; label: string; icon: React.ReactNode; end?: boolean };

export const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: <Home className="h-[18px] w-[18px]" />, end: true },
  { to: '/today', label: 'Today', icon: <CheckSquare className="h-[18px] w-[18px]" /> },
  { to: '/tasks', label: 'Tasks', icon: <ClipboardList className="h-[18px] w-[18px]" /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
];

export const WORK_NAV: NavEntry[] = [
  { to: '/projects', label: 'Projects', icon: <Layers className="h-[18px] w-[18px]" /> },
  { to: '/goals', label: 'Goals', icon: <Target className="h-[18px] w-[18px]" /> },
  { to: '/habits', label: 'Habits', icon: <Flame className="h-[18px] w-[18px]" /> },
  { to: '/focus', label: 'Focus', icon: <Focus className="h-[18px] w-[18px]" /> },
];

export const INSIGHT_NAV: NavEntry[] = [
  { to: '/progress', label: 'Progress', icon: <TrendingUp className="h-[18px] w-[18px]" /> },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 className="h-[18px] w-[18px]" /> },
  { to: '/reviews', label: 'Reviews', icon: <NotebookPen className="h-[18px] w-[18px]" /> },
  { to: '/history', label: 'History', icon: <HistoryIcon className="h-[18px] w-[18px]" /> },
  { to: '/notes', label: 'Notes', icon: <LayoutGrid className="h-[18px] w-[18px]" /> },
];

export const ALL_NAV: NavEntry[] = [
  ...PRIMARY_NAV,
  ...WORK_NAV,
  ...INSIGHT_NAV,
  { to: '/settings', label: 'Settings', icon: <SettingsIcon className="h-[18px] w-[18px]" /> },
];

const MOBILE_NAV: NavEntry[] = [
  { to: '/', label: 'Home', icon: <Home className="h-5 w-5" />, end: true },
  { to: '/today', label: 'Today', icon: <CheckSquare className="h-5 w-5" /> },
  { to: '/focus', label: 'Focus', icon: <Focus className="h-5 w-5" /> },
  { to: '/progress', label: 'Progress', icon: <TrendingUp className="h-5 w-5" /> },
];

function NavItem({ entry, onNavigate }: { entry: NavEntry; onNavigate?: () => void }) {
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150',
          isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-subtle hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('shrink-0 transition-colors', isActive ? 'text-accent' : 'text-faint group-hover:text-muted')}>
            {entry.icon}
          </span>
          <span className="truncate">{entry.label}</span>
        </>
      )}
    </NavLink>
  );
}

function NavGroup({ label, entries, onNavigate }: { label: string; entries: NavEntry[]; onNavigate?: () => void }) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 pb-1 pt-4 text-2xs font-semibold uppercase tracking-wider text-faint">{label}</div>
      {entries.map((entry) => (
        <NavItem key={entry.to} entry={entry} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-accent to-accent/70 text-accent-ink shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M5 7h14M12 7v11" />
        </svg>
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold tracking-tight text-ink">TarangOS</div>
        <div className="truncate text-2xs text-faint">Private workspace</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, lock } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Global shortcuts. Ignored while typing so they never eat real input.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'n') {
        event.preventDefault();
        setCaptureOpen(true);
      } else if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === 'g') {
        // Two-key sequence: g then a destination.
        const onSecond = (next: KeyboardEvent) => {
          const map: Record<string, string> = {
            d: '/', t: '/today', a: '/tasks', c: '/calendar', p: '/projects',
            g: '/goals', h: '/habits', f: '/focus', r: '/reviews', s: '/settings',
          };
          const destination = map[next.key.toLowerCase()];
          if (destination) {
            next.preventDefault();
            navigate(destination);
          }
          window.removeEventListener('keydown', onSecond, true);
        };
        window.addEventListener('keydown', onSecond, true);
        setTimeout(() => window.removeEventListener('keydown', onSecond, true), 1400);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  React.useEffect(() => setMoreOpen(false), [location.pathname]);

  const currentTitle =
    ALL_NAV.find((entry) => (entry.end ? location.pathname === entry.to : location.pathname.startsWith(entry.to)))?.label ??
    'TarangOS';

  return (
    <div className="min-h-[100dvh] bg-bg">
      {/* ---------------- desktop sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex">
        <div className="px-4 pb-2 pt-5">
          <BrandMark />
        </div>

        <div className="px-3 pb-1 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-subtle/60 px-3 py-2 text-left text-[13px] text-faint transition-colors hover:border-accent/30 hover:bg-subtle"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1">Search…</span>
            <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-2xs text-muted">⌘K</kbd>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <div className="space-y-0.5 pt-2">
            {PRIMARY_NAV.map((entry) => (
              <NavItem key={entry.to} entry={entry} />
            ))}
          </div>
          <NavGroup label="Work" entries={WORK_NAV} />
          <NavGroup label="Insights" entries={INSIGHT_NAV} />
        </nav>

        <div className="border-t border-line p-3">
          <button
            onClick={() => setCaptureOpen(true)}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink shadow-sm transition-all hover:brightness-110 active:brightness-95"
          >
            <Plus className="h-4 w-4" />
            Quick capture
            <kbd className="ml-1 rounded bg-black/15 px-1.5 py-0.5 text-2xs">N</kbd>
          </button>

          <Dropdown
            align="start"
            items={[
              { type: 'label', label: user?.username ?? '' },
              { label: 'Settings', icon: <SettingsIcon className="h-4 w-4" />, onSelect: () => navigate('/settings') },
              {
                label: resolved === 'dark' ? 'Light mode' : 'Dark mode',
                icon: resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
                onSelect: toggle,
              },
              { label: 'Lock now', icon: <Lock className="h-4 w-4" />, onSelect: () => void lock(), shortcut: 'L' },
              { type: 'separator' },
              { label: 'Sign out', icon: <LogOut className="h-4 w-4" />, onSelect: () => void logout(), danger: true },
            ]}
            trigger={({ toggle: openMenu, ref }) => (
              <button
                ref={ref}
                onClick={openMenu}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-subtle"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {initials(user?.displayName || user?.username || 'T')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {user?.displayName || user?.username}
                  </span>
                  <span className="block truncate text-2xs text-faint">
                    {user?.totpEnabled ? '2FA enabled' : 'Signed in'}
                  </span>
                </span>
                <MoreHorizontal className="h-4 w-4 shrink-0 text-faint" />
              </button>
            )}
          />
        </div>
      </aside>

      {/* ---------------- mobile top bar ---------------- */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-lg lg:hidden">
        <BrandMark />
        <div className="flex items-center gap-0.5">
          <IconButton label="Search" onClick={() => setPaletteOpen(true)}>
            <Search className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton label={resolved === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle}>
            {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </IconButton>
          <IconButton label="Lock" onClick={() => void lock()}>
            <Lock className="h-[18px] w-[18px]" />
          </IconButton>
        </div>
      </header>

      {/* ---------------- content ---------------- */}
      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:pb-10">{children}</div>
      </main>

      {/* ---------------- mobile bottom nav ---------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe backdrop-blur-lg lg:hidden">
        <div className="flex items-stretch">
          {MOBILE_NAV.slice(0, 2).map((entry) => (
            <MobileNavItem key={entry.to} entry={entry} />
          ))}

          <div className="flex w-16 shrink-0 items-center justify-center">
            <button
              onClick={() => setCaptureOpen(true)}
              aria-label="Quick capture"
              className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop transition-transform active:scale-95"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>

          {MOBILE_NAV.slice(2).map((entry) => (
            <MobileNavItem key={entry.to} entry={entry} />
          ))}

          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-faint transition-colors active:text-ink"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-2xs font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* ---------------- mobile "more" sheet ---------------- */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] animate-slide-up overflow-y-auto rounded-t-3xl border-t border-line bg-surface pb-safe">
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-line" />
            <div className="p-4">
              <div className="mb-3 text-sm font-semibold text-ink">All sections</div>
              <div className="grid grid-cols-3 gap-2">
                {ALL_NAV.map((entry) => (
                  <NavLink
                    key={entry.to}
                    to={entry.to}
                    end={entry.end}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors',
                        isActive ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-subtle/50 text-muted',
                      )
                    }
                  >
                    {entry.icon}
                    <span className="text-2xs font-medium">{entry.label}</span>
                  </NavLink>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    void lock();
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-subtle py-2.5 text-sm font-medium text-ink"
                >
                  <Lock className="h-4 w-4" /> Lock
                </button>
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    void logout();
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-danger/10 py-2.5 text-sm font-medium text-danger"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onQuickCapture={() => setCaptureOpen(true)} />
    </div>
  );
}

function MobileNavItem({ entry }: { entry: NavEntry }) {
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors',
          isActive ? 'text-accent' : 'text-faint active:text-ink',
        )
      }
    >
      {entry.icon}
      <span className="text-2xs font-medium">{entry.label}</span>
    </NavLink>
  );
}
