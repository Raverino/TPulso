// One upstream GET for an alert source: edge-cached for `ttlSec`, a time limit, and an error for anything but 200.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class AlertSourceError extends Error {}

const TIMEOUT_MS = 8000;

export async function fetchText(fetchFn: FetchFn, url: string, ttlSec: number): Promise<string> {
  // cf.cacheTtl lets the Cloudflare edge share the upstream response between Worker instances (ignored locally).
  const init = { cf: { cacheTtl: ttlSec, cacheEverything: true } } as RequestInit;
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) init.signal = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetchFn(url, init);
  if (!res.ok) throw new AlertSourceError(`upstream ${res.status}`);
  return res.text();
}

/** Only https links are passed on to the app (it may open them). */
export function httpsUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v.trim()) ? v.trim() : null;
}
