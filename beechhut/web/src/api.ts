import { useEffect, useReducer } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let signingOut = false;
/** Signing out: stop a request that finds the session gone from starting a new sign-in. */
export const markSigningOut = () => { signingOut = true; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Relative URL so it works under HA ingress' /api/hassio_ingress/<token>/ prefix.
  const res = await fetch(`api${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  // Direct access: the sign-in has run out, so go through Home Assistant's sign-in again.
  if (res.status === 401 && data?.signIn) { if (!signingOut) location.href = '/auth/login'; throw new ApiError('Signing in again…', 401); }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

// ── Tiny SWR-style cache: shared across components, polled while visible ────
interface Entry { data?: unknown; error?: string; loading: boolean; at: number; subs: Set<() => void>; inflight?: Promise<void> }
const cache = new Map<string, Entry>();

const entry = (key: string) => {
  let e = cache.get(key);
  if (!e) cache.set(key, (e = { loading: true, at: 0, subs: new Set() }));
  return e;
};
const notify = (e: Entry) => e.subs.forEach((fn) => fn());

export function refresh(key: string): Promise<void> {
  const e = entry(key);
  if (e.inflight) return e.inflight;
  e.inflight = api(key)
    .then((data) => { e.data = data; e.error = undefined; })
    .catch((err: Error) => { e.error = err.message; })
    .finally(() => { e.loading = false; e.at = Date.now(); e.inflight = undefined; notify(e); });
  return e.inflight;
}

/** Optimistically change cached data (e.g. flip a light) before the server confirms. */
export function mutate<T>(key: string, fn: (data: T) => T) {
  const e = cache.get(key);
  if (e?.data !== undefined) { e.data = fn(e.data as T); notify(e); }
}

export function useApi<T>(key: string | null, intervalMs = 0) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!key) return;
    const e = entry(key);
    e.subs.add(rerender);
    if (Date.now() - e.at > 1500) refresh(key);
    const t = intervalMs ? setInterval(() => { if (!document.hidden) refresh(key); }, intervalMs) : undefined;
    return () => { e.subs.delete(rerender); clearInterval(t); };
  }, [key, intervalMs]);
  const e = key ? cache.get(key) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !e || (e.loading && e.data === undefined),
    refresh: () => (key ? refresh(key) : Promise.resolve()),
  };
}

// Phones suspend tabs; refresh everything on screen as soon as we're visible again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const [key, e] of cache) if (e.subs.size) refresh(key);
});
