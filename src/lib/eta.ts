// Expected times for every remaining stop of a selected bus.
//
// Each stop gets exactly one state:
//   live      - the stop's departures list has this trip (exact trip_id) with a real-time estimate
//   scheduled - the stop's departures list has this trip, but only the timetable time
//   estimated - no row: worked out from distance along the route and the bus's recent speed,
//               like the original OV Pulse upcomingStopsFor/etaS (travel time + ~20 s dwell per stop)
// Estimates start from the last stop with a known time (or from the bus itself), so they never jump
// backwards past real data.

import { distanceMeters } from '../../shared/geo';
import type { LatLng, VehicleStopTime } from '../../shared/types';

export type StopTimeState = 'live' | 'scheduled' | 'estimated';

/** Original OV Pulse defaults: bus speed when unknown, dwell per stop, minimum speed. */
export const DEFAULT_BUS_SPEED_KMH = 20;
export const DWELL_SEC = 20;
const MIN_SPEED_MPS = 3;
/** Straight-line fallback when there is no route geometry: streets aren't straight. */
const STRAIGHT_LINE_FACTOR = 1.25;

export interface RouteStop extends LatLng {
  id: string;
  name: string;
}

export interface StopEta extends RouteStop {
  state: StopTimeState;
  /** Unix seconds. */
  atSec: number;
}

export interface Fix extends LatLng {
  /** Unix ms of the GPS fix. */
  t: number;
}

/** Cumulative metres along a [lat, lng] path. */
export function cumulative(path: readonly [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    cum.push(cum[i - 1]! + distanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }));
  }
  return cum;
}

/** Index of the path vertex nearest to `p`, searching from `fromIndex` onwards (keeps travel order on loops). */
export function nearestIndex(path: readonly [number, number][], p: LatLng, fromIndex = 0): number {
  let best = fromIndex;
  let bestD = Infinity;
  for (let k = fromIndex; k < path.length; k++) {
    const q = path[k]!;
    const d = distanceMeters({ lat: q[0], lng: q[1] }, p);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Recent speed in m/s from the bus's last GPS fixes (distance along the route when known),
 * clamped to 8–80 km/h as in the original. Null when there aren't two usable fixes.
 */
export function recentSpeedMps(fixes: readonly Fix[], path: readonly [number, number][], cum?: number[]): number | null {
  const recent = fixes.filter(f => fixes[fixes.length - 1]!.t - f.t <= 120_000);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || last.t - first.t < 5_000) return null;
  let moved: number;
  if (path.length > 1) {
    const c = cum ?? cumulative(path);
    moved = Math.abs(c[nearestIndex(path, last)]! - c[nearestIndex(path, first)]!);
  } else moved = distanceMeters(first, last);
  if (moved < 8) return null; // standing still or GPS jitter: don't pretend to know a speed
  const kmh = Math.min(80, Math.max(8, (moved / ((last.t - first.t) / 1000)) * 3.6));
  return kmh / 3.6;
}

export interface EtaInput {
  /** Remaining stops in travel order, starting with the stop the bus is heading to. */
  stops: readonly RouteStop[];
  /** Route geometry ([lat, lng]); may be empty. */
  path: readonly [number, number][];
  vehicle: LatLng;
  nowSec: number;
  speedMps: number | null;
  /** This trip's rows at some of the stops (exact trip_id matches). */
  times: readonly VehicleStopTime[];
}

export function buildStopEtas({ stops, path, vehicle, nowSec, speedMps, times }: EtaInput): StopEta[] {
  const speed = Math.max(MIN_SPEED_MPS, speedMps ?? DEFAULT_BUS_SPEED_KMH / 3.6);
  const byStop = new Map(times.map(t => [t.stopId, t]));

  // Position of the bus and of each stop, in metres along the route.
  const pos: number[] = [];
  let s0 = 0;
  if (path.length > 1) {
    const cum = cumulative(path);
    let idx = nearestIndex(path, vehicle);
    s0 = cum[idx]!;
    for (const st of stops) {
      idx = nearestIndex(path, st, idx);
      pos.push(cum[idx]!);
    }
  } else {
    let acc = 0;
    let prev: LatLng = vehicle;
    for (const st of stops) {
      acc += distanceMeters(prev, st) * STRAIGHT_LINE_FACTOR;
      pos.push(acc);
      prev = st;
    }
  }

  // Anchor = last point with a known time: the bus itself (now) or a stop with a live/scheduled row.
  let anchor = { s: s0, t: nowSec, index: -1 };
  return stops.map((st, i) => {
    const row = byStop.get(st.id);
    if (row) {
      const live = row.estimatedAt !== null;
      const atSec = live ? row.estimatedAt! : row.scheduledAt;
      anchor = { s: pos[i]!, t: atSec, index: i };
      return { ...st, state: live ? 'live' : 'scheduled', atSec };
    }
    // Stops passed since the anchor each add a dwell (the anchor stop's own dwell included).
    const dwellStops = anchor.index < 0 ? i : i - anchor.index;
    const atSec = Math.round(anchor.t + Math.max(0, pos[i]! - anchor.s) / speed + dwellStops * DWELL_SEC);
    return { ...st, state: 'estimated', atSec };
  });
}
