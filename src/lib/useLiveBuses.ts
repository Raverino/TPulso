// TPulso: live GPS buses around the radar (docs/LIVE.md), from the Worker (/api/vehicles: Carris Metropolitana's
// open API, cached there for 5 s). Read every 10 s while the app is visible. A failed refresh keeps the last list:
// each bus then turns Stale and disappears by the age of its own GPS fix (src/offline/live.ts), never shown as live
// longer than its data allows. When the server has live buses switched off, the hook says "off" once and stops.
import { useEffect, useState } from 'react';
import type { LatLng, Vehicle as LiveBus, VehicleList } from '../../shared/types';

const REFRESH_MS = 10_000;
/** The request area: the radar plus this margin, so buses about to enter it are already known. */
const MARGIN_M = 600;
/** The request centre is rounded to about 200 m, so a small pan does not refetch. */
const GRID_DEG = 0.002;

export interface LiveBusesState {
  /** off = switched off on the server (or no live index in this timetable); error = last refresh failed. */
  status: 'off' | 'loading' | 'ok' | 'error';
  buses: LiveBus[];
  /** When `buses` was received (ms). */
  receivedAt: number | null;
}

export function useLiveBuses(center: LatLng | null, radius: number, enabled: boolean): LiveBusesState {
  const [state, setState] = useState<LiveBusesState>({ status: enabled ? 'loading' : 'off', buses: [], receivedAt: null });
  const lat = center ? Math.round(center.lat / GRID_DEG) * GRID_DEG : null;
  const lng = center ? Math.round(center.lng / GRID_DEG) * GRID_DEG : null;
  const reach = Math.min(5000, radius + MARGIN_M);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off', buses: [], receivedAt: null });
      return;
    }
    if (lat === null || lng === null) return;
    let alive = true;
    let off = false;
    let ctrl: AbortController | null = null;
    const load = async () => {
      if (off || document.hidden) return;
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      try {
        const res = await fetch(`/api/vehicles?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&radius=${reach}`, { signal: c.signal });
        if (!alive) return;
        if (res.status === 404) {
          off = true;
          setState({ status: 'off', buses: [], receivedAt: null });
          return;
        }
        if (!res.ok) throw new Error(`answer ${res.status}`);
        const list = (await res.json()) as VehicleList;
        if (alive) setState({ status: 'ok', buses: list.vehicles, receivedAt: Date.now() });
      } catch (e) {
        if (alive && !c.signal.aborted) setState((s) => ({ ...s, status: 'error' }));
        if (!(e instanceof DOMException)) console.warn('Live buses unavailable:', e);
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    const onShow = () => !document.hidden && void load();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', load);
    return () => {
      alive = false;
      ctrl?.abort();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('online', load);
    };
  }, [enabled, lat, lng, reach]);
  return state;
}
