import * as React from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

export const ACCENTS = [
  { id: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { id: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { id: 'sky', label: 'Sky', swatch: '#0284c7' },
  { id: 'teal', label: 'Teal', swatch: '#0d9488' },
  { id: 'emerald', label: 'Emerald', swatch: '#059669' },
  { id: 'amber', label: 'Amber', swatch: '#d97706' },
  { id: 'rose', label: 'Rose', swatch: '#e11d48' },
] as const;

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  accent: string;
  reduceMotion: boolean;
  compact: boolean;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setReduceMotion: (value: boolean) => void;
  setCompact: (value: boolean) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE = {
  mode: 'tarangos.theme',
  accent: 'tarangos.accent',
  motion: 'tarangos.reduceMotion',
  compact: 'tarangos.compact',
};

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>(() => readStored(STORAGE.mode, 'system') as ThemeMode);
  const [accent, setAccentState] = React.useState<string>(() => readStored(STORAGE.accent, 'indigo'));
  const [reduceMotion, setReduceMotionState] = React.useState(() => readStored(STORAGE.motion, 'false') === 'true');
  const [compact, setCompactState] = React.useState(() => readStored(STORAGE.compact, 'false') === 'true');
  const [systemDark, setSystemDark] = React.useState(systemPrefersDark);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.setAttribute('data-accent', accent);
    root.classList.toggle('reduce-motion', reduceMotion);
    root.style.colorScheme = resolved;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#12141b' : '#f7f8fc');
  }, [resolved, accent, reduceMotion]);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / storage disabled */
    }
  };

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      accent,
      reduceMotion,
      compact,
      setMode: (next) => {
        setModeState(next);
        persist(STORAGE.mode, next);
      },
      setAccent: (next) => {
        setAccentState(next);
        persist(STORAGE.accent, next);
      },
      setReduceMotion: (next) => {
        setReduceMotionState(next);
        persist(STORAGE.motion, String(next));
      },
      setCompact: (next) => {
        setCompactState(next);
        persist(STORAGE.compact, String(next));
      },
      toggle: () => {
        const next = resolved === 'dark' ? 'light' : 'dark';
        setModeState(next);
        persist(STORAGE.mode, next);
      },
    }),
    [mode, resolved, accent, reduceMotion, compact],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
