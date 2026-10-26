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
}

interface Geo { pts: [number, number][]; cum: number[] }
const geoCache = new WeakMap<PatternData, Geo>();
function geometry(p: PatternData): Geo {
  let g = geoCache.get(p);
  if (!g) {
    const pts = decodePolyline(p.shape);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const k = Math.cos((a[0] * Math.PI) / 180);
      cum.push(cum[i - 1]! + Math.hypot((b[1] - a[1]) * k * 111_320, (b[0] - a[0]) * 111_320));
    }
    geoCache.set(p, (g = { pts, cum }));
  }
  return g;
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
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < x) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]! || 1;
  const f = Math.min(1, Math.max(0, (x - cum[i - 1]!) / seg));
  const k = Math.cos((a[0] * Math.PI) / 180);
  const bearing = ((Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) * 180) / Math.PI + 360) % 360;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, bearing };
}

/**
 * Where the timetable says each vehicle is now: for every trip of every loaded slice, find the two scheduled
 * stops it is between and interpolate by time along the shape (or keep it at a stop while it waits there).
 * Trips outside their scheduled times are not shown.
 */
export function expectedVehicles(manifest: Pick<Manifest, 'window'>, areas: readonly AreaFile[], nowMs: number): ExpectedVehicle[] {
  const days = activeServiceDays(manifest, nowMs);
  const out = new Map<string, ExpectedVehicle & { interior: boolean }>();
  for (const a of areas) {
    for (const p of a.patterns) {
      const n = p.stops.length;
      for (const d of days) {
        const rel = (nowMs - d.startMs) / 1000;
        for (let ti = 0; ti < p.trips.length; ti++) {
          const [start, pi, mask] = p.trips[ti]!;
          if (!(mask & d.bit)) continue;
          const pr = p.profiles[pi]!;
          const t = rel - start;
          // Within this slice: from the first slice stop's departure to the last slice stop's arrival.
          if (t < pr[1]! || t > pr[(n - 1) * 2]!) {
            // Waiting at the very first stop of the trip before leaving is not "running".
            continue;
          }
          let lat: number, lng: number, bearing: number, atStop = false, next = 0, f = 0;
          let i = 0;
          while (i < n - 1 && t >= pr[(i + 1) * 2]!) i++; // i = last stop whose arrival has passed
          if (t <= pr[i * 2 + 1]!) {
            // Between arrival and departure at stop i.
            ({ lat, lng, bearing } = pointAlong(p, p.dist[i]!));
            atStop = true;
            next = i;
          } else {
            const dep = pr[i * 2 + 1]!, arr = pr[(i + 1) * 2]!;
            f = arr > dep ? (t - dep) / (arr - dep) : 1;
            ({ lat, lng, bearing } = pointAlong(p, p.dist[i]! + f * (p.dist[i + 1]! - p.dist[i]!)));
            next = i + 1;
          }
          if (!Number.isFinite(lat)) continue;
          const key = `${p.id}:${ti}:${d.date}`;
          // The same trip appears in neighbouring areas' slices: prefer a slice where it is not on the edge.
          const interior = next > 0 && next < n - 1;
          const prev = out.get(key);
          if (prev && (prev.interior || !interior)) continue;
          out.set(key, {
            key, patternId: p.id, tripIndex: ti, serviceDate: d.date, line: p.line, color: p.color, textColor: p.textColor,
            mode: p.mode, op: p.op, headsign: p.headsign, lat, lng, bearing, atStop, nextStopIndex: p.first + next,
            segment: atStop ? { from: p.first + i, to: p.first + i, f: 0 } : { from: p.first + i, to: p.first + i + 1, f }, interior,
          });
        }
      }
    }
  }
  return [...out.values()].map(({ interior: _i, ...v }) => v);
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
