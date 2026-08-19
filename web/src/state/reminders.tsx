import * as React from 'react';
import { api } from '@/lib/api';
import { useAuth } from './auth';

/**
 * Local reminder delivery.
 *
 * The server only says *what* is due; the notification itself is raised by this
 * browser via the Notification API. Nothing is sent to a push service, so no
 * third party ever sees your task titles.
 *
 * Covers per-task reminders, habit reminders, and the fixed-time daily nudges
 * (morning agenda, evening review, unfinished-important).
 */

export type DueReminder = {
  id: string;
  kind: string;
  title: string;
  body: string;
  at: string;
  url?: string;
};

type ReminderContextValue = {
  permission: NotificationPermission | 'unsupported';
  request: () => Promise<NotificationPermission>;
  supported: boolean;
  /** Fires the morning agenda right now, so delivery can be tested on a device. */
  sendTest: () => Promise<'sent' | 'denied' | 'unsupported'>;
  lastDelivered: DueReminder | null;
};

const ReminderContext = React.createContext<ReminderContextValue>({
  permission: 'unsupported',
  request: async () => 'denied',
  supported: false,
  sendTest: async () => 'unsupported',
  lastDelivered: null,
});

/**
 * Poll cadence. Fast enough that a 10:00 agenda arrives by 10:00:30, cheap
 * enough to be irrelevant — it is one indexed query against a local database.
 */
const POLL_MS = 30_000;

export function ReminderProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );
  const [lastDelivered, setLastDelivered] = React.useState<DueReminder | null>(null);
  const shown = React.useRef(new Set<string>());

  const request = React.useCallback(async () => {
    if (!supported) return 'denied' as NotificationPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [supported]);

  /** Raises one OS notification, preferring the service worker when present. */
  const deliver = React.useCallback(async (reminder: DueReminder) => {
    const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body: reminder.body,
      tag: reminder.id,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: reminder.url ?? '/' },
      requireInteraction: reminder.kind === 'daily_agenda',
      vibrate: [120, 60, 120],
    };

    // An installed PWA delivers through the service worker, which is what makes
    // notifications work on Android when the app is not in the foreground.
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(reminder.title, options);
        setLastDelivered(reminder);
        return;
      }
    }

    const notification = new Notification(reminder.title, options);
    notification.onclick = () => {
      window.focus();
      if (reminder.url) window.location.assign(reminder.url);
      notification.close();
    };
    setLastDelivered(reminder);
  }, []);

  const sendTest = React.useCallback(async () => {
    if (!supported) return 'unsupported' as const;
    let granted = permission === 'granted';
    if (!granted) granted = (await request()) === 'granted';
    if (!granted) return 'denied' as const;

    const { reminder } = await api<{ reminder: DueReminder }>('/settings/reminders/preview', {
      method: 'POST',
      quiet: true,
    });
    await deliver(reminder);
    return 'sent' as const;
  }, [supported, permission, request, deliver]);

  React.useEffect(() => {
    if (status !== 'ready' || !supported || permission !== 'granted') return;
    if (!user?.settings.notifications.enabled) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await api<{ reminders: DueReminder[] }>('/settings/due-reminders', { quiet: true });
        if (cancelled || !data.reminders.length) return;

        const fresh = data.reminders.filter((r) => !shown.current.has(r.id));
        if (!fresh.length) return;

        for (const reminder of fresh) {
          shown.current.add(reminder.id);
          try {
            await deliver(reminder);
          } catch {
            /* delivery blocked by the browser — do not retry in a loop */
          }
        }

        // Acknowledge everything we raised so it never fires twice, including
        // the daily nudges (the server records the date against your account).
        await api('/settings/reminders/ack', {
          method: 'POST',
          body: { ids: fresh.map((r) => r.id) },
          quiet: true,
        });
      } catch {
        /* offline, locked or signed out — try again next tick */
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);

    // Check immediately when the tab wakes up: this is what delivers a 10:00
    // agenda when the laptop was asleep and you open it at 10:40.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, supported, permission, user?.settings.notifications.enabled, deliver]);

  const value = React.useMemo(
    () => ({ permission, request, supported, sendTest, lastDelivered }),
    [permission, request, supported, sendTest, lastDelivered],
  );
  return <ReminderContext.Provider value={value}>{children}</ReminderContext.Provider>;
}

export function useReminders() {
  return React.useContext(ReminderContext);
}
