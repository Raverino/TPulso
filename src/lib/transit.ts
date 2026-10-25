// Generic radar helpers ported from the original OV Pulse (src/lib/transit.ts).
// Not ported on purpose: simulated vehicles/stops/arrivals, smooth animation along routes,
// and the OVapi/OSM fuzzy line matching. TPulso links data by exact IDs only (docs/DATA.md).

import { distanceMeters } from '../../shared/geo';
import type { LatLng } from '../../shared/types';

export { distanceMeters };
export type { LatLng };

/** Portions of a path that lie inside the radar circle. */
export function clipPath(path: readonly [number, number][], center: LatLng, radius: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of path) {
    if (distanceMeters({ lat: p[0], lng: p[1] }, center) <= radius) cur.push(p);
    else if (cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export function isInside(p: LatLng, center: LatLng, radius: number) {
  return distanceMeters(p, center) <= radius;
}

/** A departure as shown in the drawer (from /api/board). */
export interface Arrival {
  id: string;
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  line: string;
  headsign: string;
  /** Unix seconds. */
  scheduledAt: number;
  estimatedAt: number | null;
  distanceM: number;
  tripId: string | null;
  /** Live vehicle on the radar serving this departure (exact trip_id match). */
  vehicleId: string | null;
}

/** A stop the selected vehicle will still serve, in travel order (from the route's stop sequence). */
export interface UpcomingStop {
  key: string;
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  /** Live estimate for this vehicle's trip at this stop, when the board has it (Unix seconds). */
  estimatedAt: number | null;
}

const clockFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' });
const clockSecFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "14:05" in Lisbon time. */
export const clock = (ms: number) => clockFmt.format(new Date(ms));
/** "14:05:09" in Lisbon time. */
export const clockSec = (ms: number) => clockSecFmt.format(new Date(ms));
