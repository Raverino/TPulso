import { useEffect, useState } from 'react';
import type { VehicleStopTimes } from '../../shared/types';
import { api } from './api';
import { BOARD_POLL_MS } from './useBoard';

/** The selected bus's own times at its next ~10 stops (exact trip_id), refreshed every 20 s. */
export function useVehicleStopTimes(vehicleId: string | null): VehicleStopTimes | null {
  const [data, setData] = useState<VehicleStopTimes | null>(null);
  useEffect(() => {
    setData(null);
    if (!vehicleId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const poll = async () => {
      try {
        const d = await api.vehicleStopTimes(vehicleId, ctrl.signal);
        if (!stopped) setData(d);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // Keep the last times; stops without a known time fall back to "Estimated" anyway.
      }
      if (!stopped) timer = setTimeout(poll, BOARD_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [vehicleId]);
  return data;
}
