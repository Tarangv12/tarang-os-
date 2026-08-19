/**
 * API client.
 *
 * Session state lives in an httpOnly cookie the browser attaches automatically;
 * this module only carries the CSRF token, which the server hands out on
 * sign-in and which must be echoed on every mutating request.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level problems returned by validation, ready to render as a list. */
  get problems(): string[] {
    if (Array.isArray(this.details)) {
      return this.details.map((d) =>
        typeof d === 'string' ? d : `${(d as { path?: string }).path ?? ''} ${(d as { message?: string }).message ?? ''}`.trim(),
      );
    }
    return [];
  }
}

let csrfToken: string | null = null;
const listeners = new Set<(event: 'unauthenticated' | 'locked') => void>();

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

export function onAuthEvent(fn: (event: 'unauthenticated' | 'locked') => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(event: 'unauthenticated' | 'locked') {
  listeners.forEach((fn) => fn(event));
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  raw?: boolean;
  /** Suppress the global unauthenticated/locked broadcast (used by auth screens). */
  quiet?: boolean;
};

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (options.raw) return res as unknown as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );

    if (!options.quiet) {
      if (res.status === 401 && apiError.code !== 'TOTP_REQUIRED' && apiError.code !== 'BAD_CREDENTIALS') {
        emit('unauthenticated');
      }
      if (res.status === 423 && apiError.code === 'SESSION_LOCKED') emit('locked');
    }
    throw apiError;
  }

  return payload as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

/** Triggers a file download through an authenticated fetch. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
