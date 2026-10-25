import { useEffect, useState } from 'react';
import type { VehicleRoute } from '../../shared/types';
import { api } from './api';

export type VehicleRouteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; route: VehicleRoute }
  | { status: 'error'; message: string };

/** Line, destination, stops and geometry of the selected vehicle (loaded once per selection). */
export function useVehicleRoute(vehicleId: string | null): VehicleRouteState {
  const [state, setState] = useState<VehicleRouteState>({ status: 'idle' });
  useEffect(() => {
    if (!vehicleId) {
      setState({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    api
      .vehicleRoute(vehicleId, ctrl.signal)
      .then(route => setState({ status: 'ready', route }))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [vehicleId]);
  return state;
}
