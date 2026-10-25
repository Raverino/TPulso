import { useEffect, useState } from 'react';
import type { LatLng, Vehicle } from '../../shared/types';
import { api } from './api';

export const VEHICLE_POLL_MS = 15_000;

export interface VehiclesState {
  vehicles: Vehicle[];
  /** When the last successful update arrived (ms). */
  updatedAt: number | null;
  error: string | null;
}

/** Live buses within `radius` of `center`, refreshed every 15 s while the page is visible. */
export function useVehicles(center: LatLng | null, radius: number): VehiclesState {
  const [state, setState] = useState<VehiclesState>({ vehicles: [], updatedAt: null, error: null });
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      clearTimeout(timer);
      if (document.hidden) return; // resumed by the visibilitychange listener
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const list = await api.vehicles({ lat, lng }, radius, ctrl.signal);
        if (!stopped) setState({ vehicles: list.vehicles, updatedAt: Date.now(), error: null });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // Keep showing nothing rather than old positions as if they were live.
        if (!stopped) setState(s => ({ ...s, vehicles: [], error: (e as Error).message }));
      }
      if (!stopped) timer = setTimeout(tick, VEHICLE_POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden) tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [lat, lng, radius]);

  return state;
}
