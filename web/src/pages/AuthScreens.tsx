import * as React from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '@/state/auth';
import { ApiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Shared frame for the three unauthenticated screens. */
function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/70 text-accent-ink shadow-pop">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 7h14M12 7v11" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 max-w-[320px] text-sm leading-relaxed text-muted">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">{children}</div>

        {footer && <div className="mt-5 text-center text-xs leading-relaxed text-faint">{footer}</div>}
      </div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:text-ink"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ErrorBox({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <div className="mb-4 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
      <p className="font-medium">{error.message}</p>
      {problems.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

const PASSWORD_RULES: { label: string; test: (value: string) => boolean }[] = [
  { label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v) => /[0-9]/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function SetupScreen() {
  const { bootstrap } = useAuth();
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  const timezone = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    } catch {
      return 'Asia/Kolkata';
    }
  }, []);

  const rulesPassed = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  const matches = password.length > 0 && password === confirm;
  const canSubmit = username.trim().length >= 3 && rulesPassed === PASSWORD_RULES.length && matches;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await bootstrap({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
        timezone,
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Set up TarangOS"
      subtitle="One private account, stored only on this machine. There is no sign-up link and no second user."
      footer={
        <>
          Detected timezone: <span className="text-muted">{timezone}</span> — you can change it later in Settings.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />

        <Field label="Username" required>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. vrushabh"
            autoComplete="username"
            autoFocus
            spellCheck={false}
          />
        </Field>

        <Field label="Display name" hint="Used for your greeting on the dashboard.">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Optional"
            autoComplete="name"
          />
        </Field>

        <Field label="Password" required>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="Choose a strong password" />
        </Field>

        {password.length > 0 && (
          <div className="rounded-xl border border-line bg-subtle/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    rulesPassed <= 2 ? 'bg-danger' : rulesPassed <= 4 ? 'bg-warning' : 'bg-success',
                  )}
                  style={{ width: `${(rulesPassed / PASSWORD_RULES.length) * 100}%` }}
                />
              </div>
              <span className="text-2xs font-medium text-muted">
                {rulesPassed <= 2 ? 'Weak' : rulesPassed <= 4 ? 'Fair' : 'Strong'}
              </span>
            </div>
            <ul className="space-y-1">
              {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(password);
                return (
                  <li key={rule.label} className={cn('flex items-center gap-1.5 text-2xs', passed ? 'text-success' : 'text-faint')}>
                    {passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Field
          label="Confirm password"
          required
          error={confirm.length > 0 && !matches ? 'Passwords do not match' : undefined}
        >
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Type it again" />
        </Field>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!canSubmit}>
          Create my workspace
        </Button>

        <p className="flex items-start gap-2 text-2xs leading-relaxed text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          There is no password-reset email. If you forget it, run
          <code className="mx-1 rounded bg-subtle px-1">npm run reset-admin</code>
          on this machine.
        </p>
      </form>
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totp, setTotp] = React.useState('');
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [needsTotp, setNeedsTotp] = React.useState(false);
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login({
        username: username.trim(),
        password,
        totp: needsTotp && !useRecovery ? totp.trim() : undefined,
        recoveryCode: useRecovery ? recoveryCode.trim() : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError(null);
      } else {
        setError(err as Error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      subtitle={needsTotp ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your private workspace.'}
      footer="TarangOS runs on your own machine. Nothing here is sent to a third party."
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />

        {!needsTotp ? (
          <>
            <Field label="Username">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                spellCheck={false}
              />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
          </>
        ) : useRecovery ? (
          <Field label="Recovery code" hint="Each code works once.">
            <Input
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              autoFocus
              spellCheck={false}
              className="text-center font-mono tracking-widest"
            />
          </Field>
        ) : (
          <Field label="Authenticator code">
            <Input
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="text-center font-mono text-lg tracking-[0.5em]"
            />
          </Field>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          {needsTotp ? 'Verify and sign in' : 'Sign in'}
        </Button>

        {needsTotp && (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setUseRecovery((prev) => !prev)}
              className="text-accent transition-colors hover:underline"
            >
              {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setNeedsTotp(false);
                setUseRecovery(false);
                setTotp('');
                setRecoveryCode('');
              }}
              className="text-muted transition-colors hover:text-ink"
            >
              Back
            </button>
          </div>
        )}
      </form>
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// Locked
// ---------------------------------------------------------------------------

export function LockScreen() {
  const { unlock, logout, user, autoLockMinutes } = useAuth();
  const [pin, setPin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [usePassword, setUsePassword] = React.useState(!user?.hasPin);
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await unlock(usePassword ? { password } : { pin });
      } catch (err) {
        setError(err as Error);
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [busy, unlock, usePassword, password, pin],
  );

  // A full-length PIN submits itself — no extra tap on mobile.
  React.useEffect(() => {
    if (!usePassword && pin.length >= 4 && pin.length <= 12) {
      const timer = setTimeout(() => {
        if (pin.length >= 4) void submit();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [pin, usePassword, submit]);

  return (
    <AuthFrame
      title="Locked"
      subtitle={
        <>
          Locked after {autoLockMinutes} minutes of inactivity. Your session is still alive —
          {user?.hasPin ? ' enter your PIN' : ' enter your password'} to continue.
        </>
      }
      footer={
        <button onClick={() => void logout()} className="text-muted transition-colors hover:text-ink">
          Sign out completely
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />

        <div className="mb-1 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Lock className="h-5 w-5" />
          </div>
        </div>

        {usePassword ? (
          <Field label="Password">
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          </Field>
        ) : (
          <Field label="Quick PIN">
            <Input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="••••"
              className="text-center font-mono text-xl tracking-[0.4em]"
            />
          </Field>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unlock'}
        </Button>

        {user?.hasPin && (
          <button
            type="button"
            onClick={() => {
              setUsePassword((prev) => !prev);
              setError(null);
            }}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-accent transition-colors hover:underline"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {usePassword ? 'Use quick PIN instead' : 'Use password instead'}
          </button>
        )}
      </form>
    </AuthFrame>
  );
}

export function SplashScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/70 text-accent-ink shadow-pop">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M5 7h14M12 7v11" />
          </svg>
        </div>
        <Loader2 className="h-4 w-4 animate-spin text-faint" />
      </div>
    </div>
  );
}
