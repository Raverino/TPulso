// Loads the offline timetable files (docs/OFFLINE.md): current.json -> manifest -> areas / routes.
// Files are versioned, so they never change once published; the service worker (public/sw.js) keeps them
// for offline use. In memory, each file is fetched once per page load.
import type { AreaFile, LinesFile, Manifest, RouteFile } from '../../shared/timetable';

export class DataVersionGoneError extends Error {
  constructor() {
    super('The timetable was updated; reloading data.');
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('No connection and this data is not saved on the device yet');
  }
  if (res.status === 404) throw new DataVersionGoneError();
  if (!res.ok) throw new Error(`Timetable file unavailable (${res.status})`);
  return (await res.json()) as T;
}

export async function loadManifest(): Promise<Manifest> {
  // The service worker answers from its saved copy at once and refreshes it in the background, so a newer
  // timetable version is picked up on the next start (and the app never waits for the network to open).
  const current = await getJson<{ version: string; manifest: string }>('/data/current.json', { cache: 'no-cache' });
  const m = await getJson<Manifest>(current.manifest);
  if (m.format !== 1) throw new Error('This timetable format is not supported by this app version');
  return m;
}

/** Recently used area files kept in memory (2.2 km cells; enough for the radar, its ring and a long pan). */
const AREA_MEMORY = 48;
const areaCache = new Map<string, Promise<AreaFile>>();
/** The same files once parsed, for switching areas without waiting a tick. */
const areaDone = new Map<string, AreaFile>();
const routeCache = new Map<string, Promise<RouteFile>>();

/** Area file for `key`, or null when the manifest says there is no data there (nothing is fetched). */
export function loadArea(m: Manifest, key: string): Promise<AreaFile> | null {
  if (!(key in m.areas)) return null;
  const k = `${m.version}/${key}`;
  let p = areaCache.get(k);
  if (p) {
    // Most recently used goes to the end (Map keeps insertion order).
    areaCache.delete(k);
  } else {
    p = getJson<AreaFile>(`/data/${m.version}/areas/${key}.json`);
    p.then(
      (a) => areaCache.get(k) === p && areaDone.set(k, a),
      () => areaCache.delete(k),
    );
  }
  areaCache.set(k, p);
  // Forget the least recently used files beyond the limit (the service worker still has them on disk).
  for (const old of areaCache.keys()) {
    if (areaCache.size <= AREA_MEMORY) break;
    areaCache.delete(old);
    areaDone.delete(old);
  }
  return p;
}

/** The area file if it is already loaded and parsed in memory (no fetch), else undefined. */
export function loadedArea(m: Manifest, key: string): AreaFile | undefined {
  const a = areaDone.get(`${m.version}/${key}`);
  if (a) loadArea(m, key); // mark as recently used
  return a;
}

export function loadRoute(m: Manifest, patternId: number): Promise<RouteFile> {
  const k = `${m.version}/${patternId}`;
  let p = routeCache.get(k);
  if (!p) {
    p = getJson<RouteFile>(`/data/${m.version}/routes/${patternId}.json`);
    p.catch(() => routeCache.delete(k));
    routeCache.set(k, p);
  }
  return p;
}

const linesCache = new Map<string, Promise<LinesFile>>();

/** Region-wide tram, metro, train and ferry line shapes (drawn at every radius). */
export function loadLines(m: Manifest): Promise<LinesFile> {
  let p = linesCache.get(m.version);
  if (!p) {
    p = getJson<LinesFile>(`/data/${m.version}/${m.lines.file}`);
    p.catch(() => linesCache.delete(m.version));
    linesCache.set(m.version, p);
  }
  return p;
}

/** Size of the whole region's area files (for the "download whole region" option). */
export function regionBytes(m: Manifest): number {
  return Object.values(m.areas).reduce((s, b) => s + b, 0);
}

/** Download (and so cache, via the service worker) every area of the region. */
export async function downloadRegion(m: Manifest, onProgress: (done: number, total: number) => void): Promise<void> {
  const keys = Object.keys(m.areas);
  let done = 0;
  const queue = [...keys];
  const worker = async () => {
    while (queue.length) {
      const k = queue.shift()!;
      await loadArea(m, k);
      onProgress(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
