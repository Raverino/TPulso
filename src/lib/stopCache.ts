// The trimmed stop list (~12 400 stops) is cached on the phone in IndexedDB and refreshed about once a day.
// Radius filtering then happens locally, with no network call.

import { get, set } from 'idb-keyval';
import type { StopLite } from '../../shared/types';
import { api } from './api';

const KEY = 'tpulso:stops:v1';
export const MAX_AGE_MS = 24 * 3600 * 1000;

interface Cached {
  fetchedAt: number;
  stops: StopLite[];
}

export interface StopsResult {
  stops: StopLite[];
  fetchedAt: number;
  /** True when the refresh failed and an older cached copy is used. */
  stale: boolean;
}

async function readCache(): Promise<Cached | undefined> {
  try {
    return await get<Cached>(KEY);
  } catch {
    return undefined; // private mode / storage blocked: just fetch every time
  }
}

export async function loadStops(now = Date.now()): Promise<StopsResult> {
  const cached = await readCache();
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) return { ...cached, stale: false };
  try {
    const list = await api.stops();
    const fresh: Cached = { fetchedAt: now, stops: list.stops };
    set(KEY, fresh).catch(() => {});
    return { ...fresh, stale: false };
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}
