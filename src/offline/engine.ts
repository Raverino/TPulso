// Timetable engine for the offline radar (docs/OFFLINE.md). Pure functions over the converted files.
// Everything it returns is timetable data: "Scheduled" times and "Expected" (calculated) vehicle positions.
// Nothing here is live, and nothing is random: the same inputs always give the same output.

import {
  addDays,
  decodePolyline,
  serviceDayStartMs,
  type AreaFile,
  type Manifest,
  type PatternData,
  type RouteFile,
  type StopRow,
} from '../../shared/timetable';
import type { TransportMode } from '../../shared/types';

const TZ = 'Europe/Lisbon';
const dayStartCache = new Map<string, number>();
function dayStart(date: string): number {
  let v = dayStartCache.get(date);
  if (v === undefined) dayStartCache.set(date, (v = serviceDayStartMs(date, TZ)));
  return v;
}

/** The service days that can have trips running at `nowMs`: today and yesterday (trips after midnight). */
export function activeServiceDays(manifest: Pick<Manifest, 'window'>, nowMs: number): { date: string; bit: number; startMs: number }[] {
  const out: { date: string; bit: number; startMs: number }[] = [];
  for (let i = 0; i < manifest.window.days; i++) {
    const date = addDays(manifest.window.first, i);
    const s = dayStart(date);
    // A service day can run until ~30 h after its start.
    if (nowMs >= s - 3600_000 && nowMs < s + 30 * 3600_000) out.push({ date, bit: 1 << i, startMs: s });
  }
  return out;
}

/** True when `nowMs` is after the last service day of the window: the data has expired. */
export function isExpired(manifest: Pick<Manifest, 'window'>, nowMs: number): boolean {
  const lastDay = addDays(manifest.window.first, manifest.window.days - 1);
  return nowMs >= dayStart(lastDay) + 24 * 3600_000 + 6 * 3600_000;
}

export interface ScheduledDeparture {
  /** Stable for this trip on this service day: `${pattern}:${tripIndex}:${date}`. */
  tripKey: string;
  patternId: number;
  line: string;
  color: string;
  textColor: string;
  mode: TransportMode;
  op: string;
  headsign: string;
  stopId: string;
  /** Scheduled departure at this stop (ms). */
  atMs: number;
}

/** Scheduled departures at one stop between `fromMs` and `toMs`, soonest first. */
export function departuresAtStop(
  manifest: Pick<Manifest, 'window'>,
  areas: readonly AreaFile[],
  stopId: string,
  fromMs: number,
  toMs: number,
): ScheduledDeparture[] {
  const days = activeServiceDays(manifest, fromMs);
  const out: ScheduledDeparture[] = [];
  const seen = new Set<string>();
  for (const a of areas) {
    for (const p of a.patterns) {
      const idx = p.stops.indexOf(stopId);
      // The last stop of a full pattern has no departure.
      if (idx < 0 || p.first + idx === p.total - 1) continue;
      for (const d of days) {
        p.trips.forEach(([start, pi, mask], ti) => {
          if (!(mask & d.bit)) return;
          const atMs = d.startMs + (start + p.profiles[pi]![idx * 2 + 1]!) * 1000;
          if (atMs < fromMs || atMs > toMs) return;
          const tripKey = `${p.id}:${ti}:${d.date}`;
          const k = `${tripKey}@${stopId}@${p.first + idx}`;
          if (seen.has(k)) return; // the same slice can come from two areas
          seen.add(k);
          out.push({ tripKey, patternId: p.id, line: p.line, color: p.color, textColor: p.textColor, mode: p.mode, op: p.op, headsign: p.headsign, stopId, atMs });
        });
      }
    }
  }
  return out.sort((x, y) => x.atMs - y.atMs);
}

export interface ExpectedVehicle {
  /** `${pattern}:${tripIndex}:${serviceDate}` (not an operator id; never shown). */
  key: string;
  patternId: number;
  tripIndex: number;
  serviceDate: string;
  line: string;
  color: string;
  textColor: string;
  mode: TransportMode;
  op: string;
  headsign: string;
  lat: number;
  lng: number;
  /** Degrees, 0 = north. */
  bearing: number;
  /** Waiting at a stop (between its scheduled arrival and departure). */
  atStop: boolean;
  /** Index (in the full pattern) of the next stop the vehicle will reach (or is at). */
  nextStopIndex: number;
  /** Between full-pattern stops `from` and `to`, fraction `f` of the way (by time). from === to when waiting at a stop. */
  segment: { from: number; to: number; f: number };
  /**
   * Set when the position is a live GPS fix of this trip's bus (src/offline/live.ts), not calculated from the
   * timetable: its state (Live / Stale), the time of the fix and the operator's vehicle id (internal, never shown).
   */
  live?: {
    state: 'live' | 'stale';
    fixAt: number;
    busId: string;
    /** The pattern slice the bus runs on, and metres along it of its GPS fix (null = too far off the line). */
    slice: PatternData;
    along: number | null;
  };
}

interface Geo { pts: [number, number][]; cum: number[]; box: [number, number, number, number] }
const geoCache = new WeakMap<PatternData, Geo>();
function geometry(p: PatternData): Geo {
  let g = geoCache.get(p);
  if (!g) {
    const pts = decodePolyline(p.shape);
    const cum = [0];
    const box: Geo['box'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lat, lng] of pts) {
      if (lat < box[0]) box[0] = lat;
      if (lng < box[1]) box[1] = lng;
      if (lat > box[2]) box[2] = lat;
      if (lng > box[3]) box[3] = lng;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const k = Math.cos((a[0] * Math.PI) / 180);
      cum.push(cum[i - 1]! + Math.hypot((b[1] - a[1]) * k * 111_320, (b[0] - a[0]) * 111_320));
    }
    geoCache.set(p, (g = { pts, cum, box }));
  }
  return g;
}

/** Bounding box of a pattern slice's shape: [minLat, minLng, maxLat, maxLng] (cached). */
export function patternBox(p: PatternData): readonly [number, number, number, number] {
  return geometry(p).box;
}

/** Point and heading at `d` metres along a pattern slice's shape. */
export function pointAlong(p: PatternData, d: number): { lat: number; lng: number; bearing: number } {
  const { pts, cum } = geometry(p);
  if (pts.length === 0) return { lat: NaN, lng: NaN, bearing: 0 };
  if (pts.length === 1) return { lat: pts[0]![0], lng: pts[0]![1], bearing: 0 };
  // Shape length and stop distances can differ by a few metres (rounding): scale to the shape.
  const total = cum[cum.length - 1]!;
  const span = p.dist[p.dist.length - 1]! || total;
  const x = Math.max(0, Math.min(total, (d / span) * total));
  // First shape point at or past x (binary search: this runs for every vehicle on every animation frame).
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const a = pts[i - 1]!, b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]! || 1;
  const f = Math.min(1, Math.max(0, (x - cum[i - 1]!) / seg));
  const k = Math.cos((a[0] * Math.PI) / 180);
  const bearing = ((Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) * 180) / Math.PI + 360) % 360;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, bearing };
}

/** A trip slice that runs in a time window: everything needed to place it at any moment, precomputed. */
export interface ActiveTrip {
  /** `${pattern}:${tripIndex}:${serviceDate}` */
  key: string;
  p: PatternData;
  tripIndex: number;
  serviceDate: string;
  /** Trip start (ms, absolute). */
  startMs: number;
  /** Profile: [arrival, departure] offsets (s) from the trip start, per slice stop. */
  pr: number[];
  /** First departure and last arrival within this slice (ms, absolute). */
  fromMs: number;
  toMs: number;
}

/**
 * All trip slices of the loaded areas that run at some moment between `fromMs` and `toMs`. Built once per
 * refresh (e.g. every 2 s), so the per-frame work is only positionOf() on this short list.
 */
export function activeTrips(manifest: Pick<Manifest, 'window'>, areas: readonly AreaFile[], fromMs: number, toMs: number): ActiveTrip[] {
  const days = [...new Map([...activeServiceDays(manifest, fromMs), ...activeServiceDays(manifest, toMs)].map(d => [d.date, d])).values()];
  const out: ActiveTrip[] = [];
  for (const a of areas) {
    for (const p of a.patterns) {
      const n = p.stops.length;
      for (const d of days) {
        for (let ti = 0; ti < p.trips.length; ti++) {
          const [start, pi, mask] = p.trips[ti]!;
          if (!(mask & d.bit)) continue;
          const pr = p.profiles[pi]!;
          const startMs = d.startMs + start * 1000;
          const from = startMs + pr[1]! * 1000;
          const to = startMs + pr[(n - 1) * 2]! * 1000;
          if (to < fromMs || from > toMs) continue;
          out.push({ key: `${p.id}:${ti}:${d.date}`, p, tripIndex: ti, serviceDate: d.date, startMs, pr, fromMs: from, toMs: to });
        }
      }
    }
  }
  return out;
}

/** Share of a stop-to-stop segment spent speeding up after a stop, and slowing down before the next one. */
const EASE_SHARE = 0.15;
/**
 * Trapezoid speed profile over a segment: accelerate over the first EASE_SHARE of the time, cruise, decelerate
 * over the last EASE_SHARE. Returns the share of the distance covered at time share `t` (0..1). Symmetric:
 * half the time = half the distance.
 */
export function easeAlong(t: number, r = EASE_SHARE): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const v = 1 / (1 - r); // cruise speed so the total distance is 1
  if (t < r) return (v * t * t) / (2 * r);
  if (t > 1 - r) return 1 - (v * (1 - t) * (1 - t)) / (2 * r);
  return v * (t - r / 2);
}

/** Where the timetable says this trip slice is at `nowMs` (null outside the slice's time span). */
/** A bus is never shown waiting at a stop longer than this (s): with a longer scheduled dwell it is shown
 * arriving later instead (never leaving early, so never ahead of the timetable). */
export const BUS_DWELL_CAP_S = 60;

export function positionOf(at: ActiveTrip, nowMs: number, ease = true): (ExpectedVehicle & { interior: boolean }) | null {
  if (nowMs < at.fromMs || nowMs > at.toMs) return null;
  const { p, pr } = at;
  const n = p.stops.length;
  const t = (nowMs - at.startMs) / 1000;
  // Arrival used for display: for a bus, at most BUS_DWELL_CAP_S before the departure.
  const arrAt = (k: number) => (p.mode === 'bus' ? Math.max(pr[k * 2]!, pr[k * 2 + 1]! - BUS_DWELL_CAP_S) : pr[k * 2]!);
  let i = 0;
  while (i < n - 1 && t >= arrAt(i + 1)) i++; // i = last stop whose arrival has passed
  let pos: { lat: number; lng: number; bearing: number };
  let atStop = false;
  let next = 0;
  let f = 0;
  if (t <= pr[i * 2 + 1]!) {
    // Between arrival and departure at stop i: waiting there.
    pos = pointAlong(p, p.dist[i]!);
    atStop = true;
    next = i;
  } else {
    const dep = pr[i * 2 + 1]!, arr = arrAt(i + 1);
    f = arr > dep ? (t - dep) / (arr - dep) : 1;
    // Distance by arc length along the shape (pointAlong), with a short ease out of / into the stops.
    const g = ease ? easeAlong(f) : f;
    pos = pointAlong(p, p.dist[i]! + g * (p.dist[i + 1]! - p.dist[i]!));
    next = i + 1;
  }
  if (!Number.isFinite(pos.lat)) return null;
  return {
    key: at.key, patternId: p.id, tripIndex: at.tripIndex, serviceDate: at.serviceDate, line: p.line, color: p.color, textColor: p.textColor,
    mode: p.mode, op: p.op, headsign: p.headsign, lat: pos.lat, lng: pos.lng, bearing: pos.bearing, atStop, nextStopIndex: p.first + next,
    segment: atStop ? { from: p.first + i, to: p.first + i, f: 0 } : { from: p.first + i, to: p.first + i + 1, f },
    interior: next > 0 && next < n - 1,
  };
}

/** Positions of a list of active trips at `nowMs`, one per trip (a slice where it is not on the edge preferred). */
export function positionsAt(trips: readonly ActiveTrip[], nowMs: number, ease = true): ExpectedVehicle[] {
  const out = new Map<string, ExpectedVehicle & { interior: boolean }>();
  for (const at of trips) {
    const v = positionOf(at, nowMs, ease);
    if (!v) continue;
    const prev = out.get(v.key);
    if (prev && (prev.interior || !v.interior)) continue;
    out.set(v.key, v);
  }
  return [...out.values()].map(({ interior: _i, ...v }) => v);
}

/**
 * Where the timetable says each vehicle is now: for every trip of every loaded slice, find the two scheduled
 * stops it is between and interpolate by time along the shape (or keep it at a stop while it waits there).
 * Trips outside their scheduled times are not shown.
 */
export function expectedVehicles(manifest: Pick<Manifest, 'window'>, areas: readonly AreaFile[], nowMs: number): ExpectedVehicle[] {
  return positionsAt(activeTrips(manifest, areas, nowMs, nowMs), nowMs);
}

export interface ScheduledStop {
  stop: StopRow;
  /** Index in the full pattern. */
  index: number;
  /** Scheduled arrival at this stop (ms). */
  atMs: number;
}

/** A vehicle's remaining stops with their scheduled times, from its route file. */
export function upcomingStops(route: RouteFile, tripIndex: number, serviceDate: string, fromIndex: number): ScheduledStop[] {
  const trip = route.trips[tripIndex];
  if (!trip) return [];
  const [start, pi] = trip;
  const pr = route.profiles[pi]!;
  const s = dayStart(serviceDate);
  const out: ScheduledStop[] = [];
  for (let i = Math.max(0, fromIndex); i < route.stops.length; i++) {
    out.push({ stop: route.stopInfo[i]!, index: i, atMs: s + (start + pr[i * 2]!) * 1000 });
  }
  return out;
}

/** The route line of a pattern as [lat, lng] points. */
export function routePath(route: RouteFile): [number, number][] {
  return decodePolyline(route.shape);
}

export interface TripStops {
  stops: ScheduledStop[];
  /** Full-pattern index of the stop the vehicle is at or heading to. */
  nextIndex: number;
  /** Full-pattern index of the row's own stop. */
  yourIndex: number;
  /** Terminus stop name. */
  terminus: string;
}

/**
 * The trip behind a departure row: its upcoming stops from the vehicle's next stop (or the first stop when
 * the trip has not started), the row's own stop (matched by its scheduled time, for routes that pass a stop
 * twice) and the terminus. Same data as the vehicle panel.
 */
export function tripStopsForRow(
  route: RouteFile,
  tripIndex: number,
  serviceDate: string,
  rowStopId: string,
  rowAtMs: number,
  vehicleNextIndex: number | undefined,
): TripStops | null {
  const trip = route.trips[tripIndex];
  if (!trip) return null;
  const [start, pi] = trip;
  const pr = route.profiles[pi]!;
  const s = dayStart(serviceDate);
  let yourIndex = -1;
  for (let i = 0; i < route.stops.length; i++) {
    if (route.stops[i] !== rowStopId) continue;
    if (yourIndex < 0) yourIndex = i;
    if (s + (start + pr[i * 2 + 1]!) * 1000 === rowAtMs) {
      yourIndex = i;
      break;
    }
  }
  const nextIndex = vehicleNextIndex ?? 0;
  return {
    stops: upcomingStops(route, tripIndex, serviceDate, nextIndex),
    nextIndex,
    yourIndex,
    terminus: route.stopInfo[route.stopInfo.length - 1]?.[1] ?? '',
  };
}
