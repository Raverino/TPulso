// Fetches the Carris Metropolitana API with short-lived caching, so many app users share one upstream call.

export const TML_BASE_URL = 'https://api.carrismetropolitana.pt/v2';

export class UpstreamError extends Error {
  readonly path: string;
  readonly status: number;
  constructor(path: string, status: number) {
    super(`TML API ${path} answered ${status}`);
    this.path = path;
    this.status = status;
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface MemoEntry {
  expires: number;
  value: Promise<unknown>;
}

export class TmlClient {
  private readonly memo = new Map<string, MemoEntry>();
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;

  constructor(fetchFn: FetchFn = (u, i) => fetch(u, i), now: () => number = Date.now) {
    this.fetchFn = fetchFn;
    this.now = now;
  }

  /** GET a JSON path. Returns null on 404. Results are kept in memory for `ttlSec`. */
  getJson<T>(path: string, ttlSec: number): Promise<T | null> {
    const hit = this.memo.get(path);
    if (hit && hit.expires > this.now()) return hit.value as Promise<T | null>;
    const value = this.load<T>(path, ttlSec);
    this.memo.set(path, { expires: this.now() + ttlSec * 1000, value });
    value.catch(() => this.memo.delete(path)); // never keep failures
    return value;
  }

  private async load<T>(path: string, ttlSec: number): Promise<T | null> {
    // cf.cacheTtl lets the Cloudflare edge share responses between Worker instances (ignored locally).
    const init = { cf: { cacheTtl: ttlSec, cacheEverything: true } } as RequestInit;
    const res = await this.fetchFn(TML_BASE_URL + path, init);
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(path, res.status);
    return (await res.json()) as T;
  }
}
