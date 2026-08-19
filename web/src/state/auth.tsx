import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onAuthEvent, setCsrfToken } from '@/lib/api';
import type { User } from '@/lib/types';

type Status = 'loading' | 'setup' | 'signed-out' | 'locked' | 'ready';

type AuthContextValue = {
  status: Status;
  user: User | null;
  autoLockMinutes: number;
  refresh: () => Promise<void>;
  bootstrap: (input: { username: string; password: string; displayName?: string; timezone?: string }) => Promise<void>;
  login: (input: { username: string; password: string; totp?: string; recoveryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: (input: { pin?: string; password?: string }) => Promise<void>;
  setUser: (user: User) => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

type MeResponse = {
  user: User;
  csrfToken: string;
  locked: boolean;
  autoLockMinutes: number;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>('loading');
  const [user, setUser] = React.useState<User | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = React.useState(20);
  const queryClient = useQueryClient();

  const applySession = React.useCallback((data: MeResponse) => {
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    setAutoLockMinutes(data.autoLockMinutes);
    setStatus(data.locked ? 'locked' : 'ready');
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api<MeResponse>('/auth/me', { quiet: true });
      applySession(data);
    } catch (err) {
      setCsrfToken(null);
      setUser(null);
      if (err instanceof ApiError && err.status === 401) {
        try {
          const info = await api<{ initialized: boolean }>('/auth/status', { quiet: true });
          setStatus(info.initialized ? 'signed-out' : 'setup');
        } catch {
          setStatus('signed-out');
        }
      } else {
        setStatus('signed-out');
      }
    }
  }, [applySession]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // The API layer broadcasts when the server rejects a request as
  // unauthenticated or locked, so any screen can trigger the right gate.
  React.useEffect(
    () =>
      onAuthEvent((event) => {
        if (event === 'locked') {
          setStatus((prev) => (prev === 'ready' ? 'locked' : prev));
        } else {
          setCsrfToken(null);
          setUser(null);
          setStatus('signed-out');
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  // Re-check when the tab regains focus: the session may have locked meanwhile.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (status === 'ready' || status === 'locked')) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, status]);

  const bootstrap = React.useCallback<AuthContextValue['bootstrap']>(
    async (input) => {
      const data = await api<{ user: User; csrfToken: string }>('/auth/bootstrap', {
        method: 'POST',
        body: input,
        quiet: true,
      });
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      setStatus('ready');
    },
    [],
  );

  const login = React.useCallback<AuthContextValue['login']>(async (input) => {
    const data = await api<{ user: User; csrfToken: string }>('/auth/login', {
      method: 'POST',
      body: input,
      quiet: true,
    });
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    setStatus('ready');
    queryClient.clear();
  }, [queryClient]);

  const logout = React.useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', quiet: true });
    } finally {
      setCsrfToken(null);
      setUser(null);
      setStatus('signed-out');
      queryClient.clear();
    }
  }, [queryClient]);

  const lock = React.useCallback(async () => {
    await api('/auth/lock', { method: 'POST', quiet: true });
    setStatus('locked');
  }, []);

  const unlock = React.useCallback<AuthContextValue['unlock']>(
    async (input) => {
      const data = await api<{ ok: boolean; csrfToken: string }>('/auth/unlock', {
        method: 'POST',
        body: input,
        quiet: true,
      });
      setCsrfToken(data.csrfToken);
      setStatus('ready');
      await refresh();
    },
    [refresh],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, autoLockMinutes, refresh, bootstrap, login, logout, lock, unlock, setUser }),
    [status, user, autoLockMinutes, refresh, bootstrap, login, logout, lock, unlock],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for screens that are only rendered when signed in. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}
