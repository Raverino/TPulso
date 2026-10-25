import { useEffect, useRef, useState } from 'react';
import type { VehicleRoute } from '../../shared/types';
import { api } from './api';

export type RouteEntry = { status: 'loading' } | { status: 'ready'; route: VehicleRoute } | { status: 'error' };

/**
 * Route (official shape + stop sequence) for each vehicle on the radar, as the original drew a route line
 * for every visible vehicle. Loaded once per vehicle and trip; the worker caches patterns/shapes for 1 h.
 */
export function useVehicleRoutes(vehicles: readonly { id: string; tripId: string }[]): ReadonlyMap<string, RouteEntry> {
  const [routes, setRoutes] = useState<Map<string, RouteEntry>>(new Map());
  const requested = useRef(new Map<string, string>()); // vehicle id -> trip id already requested
  const key = vehicles.map(v => `${v.id}|${v.tripId}`).join(',');

  useEffect(() => {
    for (const v of vehicles) {
      if (requested.current.get(v.id) === v.tripId) continue;
      requested.current.set(v.id, v.tripId);
      setRoutes(m => new Map(m).set(v.id, { status: 'loading' }));
      api
        .vehicleRoute(v.id)
        .then(route => setRoutes(m => new Map(m).set(v.id, { status: 'ready', route })))
        .catch(() => {
          requested.current.delete(v.id); // try again on the next vehicle update
          setRoutes(m => new Map(m).set(v.id, { status: 'error' }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return routes;
}
