import { useEffect, useState } from 'react';
import { areasAround, type AreaFile, type Manifest } from '../../shared/timetable';
import type { LatLng } from '../../shared/types';
import { DataVersionGoneError, loadArea, loadManifest, loadedArea } from './store';

export interface TimetableState {
  manifest: Manifest | null;
  /** Areas loaded around the radar (circle + one ring, for dragging and vehicles near the edge). */
  areas: AreaFile[];
  loading: boolean;
  error: string | null;
}

/** Load the next ring of area cells in idle time, one file per idle slot, so a pan never waits for them. */
function prefetch(m: Manifest, keys: string[]): () => void {
  let stop = false;
  const idle: (cb: () => void) => unknown = window.requestIdleCallback ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 }) : (cb) => setTimeout(cb, 200);
  const next = (i: number) => {
    if (stop || i >= keys.length) return;
    idle(() => {
      if (stop) return;
      const p = loadArea(m, keys[i]!);
      const go = () => next(i + 1);
      if (p) p.then(go, go);
      else go();
    });
  };
  next(0);
  return () => {
    stop = true;
  };
}

/**
 * The offline timetable around `center`. Re-reads the manifest if the published version changed.
 * The areas only change when the set of cells changes (not on every move), the current areas stay on screen
 * while new ones load, and the ring of cells beyond is prefetched in idle time.
 */
export function useTimetable(center: LatLng | null, radius: number): TimetableState {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [areas, setAreas] = useState<AreaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let stop = false;
    loadManifest()
      .then(m => !stop && (setManifest(m), setError(null)))
      .catch((e: Error) => !stop && (setError(e.message), setLoading(false)));
    return () => {
      stop = true;
    };
  }, [reload]);

  const keys = center ? areasAround(center.lat, center.lng, radius, 1).join(',') : null;
  const outer = center ? areasAround(center.lat, center.lng, radius, 2).join(',') : null;
  useEffect(() => {
    if (!manifest || keys === null) return;
    let stop = false;
    let cancelPrefetch = () => {};
    const list = keys.split(',').filter(k => k in manifest.areas);
    // The ring beyond is prefetched only once the radar's own areas are in (never competing with them).
    const inner = new Set(list);
    const startPrefetch = () => {
      if (!stop) cancelPrefetch = prefetch(manifest, outer!.split(',').filter(k => !inner.has(k)));
    };
    // Everything already in memory: switch at once, no loading state.
    const ready = list.map(k => loadedArea(manifest, k));
    if (ready.every(a => a !== undefined)) {
      setAreas(ready as AreaFile[]);
      setError(null);
      setLoading(false);
      startPrefetch();
    } else {
      setLoading(true); // the current areas stay on screen until the new set is complete
      Promise.allSettled(list.map(k => loadArea(manifest, k)!)).then(results => {
        if (stop) return;
        const ok = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
        const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
        if (failed.some(f => f.reason instanceof DataVersionGoneError)) {
          setReload(n => n + 1); // a newer timetable was published: re-read the manifest
          return;
        }
        setAreas(ok);
        setError(failed.length ? `${failed.length} map area${failed.length > 1 ? 's' : ''} could not be loaded (${(failed[0]!.reason as Error).message})` : null);
        setLoading(false);
        startPrefetch();
      });
    }
    return () => {
      stop = true;
      cancelPrefetch();
    };
  }, [manifest, keys, outer]);

  return { manifest, areas, loading, error };
}
