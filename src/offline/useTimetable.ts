import { useEffect, useState } from 'react';
import { areasAround, type AreaFile, type Manifest } from '../../shared/timetable';
import type { LatLng } from '../../shared/types';
import { DataVersionGoneError, loadArea, loadManifest } from './store';

export interface TimetableState {
  manifest: Manifest | null;
  /** Areas loaded around the radar (circle + one ring, for dragging and vehicles near the edge). */
  areas: AreaFile[];
  loading: boolean;
  error: string | null;
}

/** The offline timetable around `center`. Re-reads the manifest if the published version changed. */
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

  const lat = center?.lat;
  const lng = center?.lng;
  useEffect(() => {
    if (!manifest || lat === undefined || lng === undefined) return;
    let stop = false;
    setLoading(true);
    const keys = areasAround(lat, lng, radius, 1);
    const jobs = keys.map(k => loadArea(manifest, k)).filter((p): p is Promise<AreaFile> => p !== null);
    Promise.allSettled(jobs).then(results => {
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
    });
    return () => {
      stop = true;
    };
  }, [manifest, lat, lng, radius]);

  return { manifest, areas, loading, error };
}
