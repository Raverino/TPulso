// Ported from the original OV Pulse src/lib/transit.ts.
// Kept: types, radar maths (distance, clip route to circle), countdown formatting, mode labels.
// Removed: simulated data (seedVehicles, seedStops, buildArrivals, LINES, STOP_NAMES), smooth animation
// along routes (stepVehicles), OSM route orientation and the fuzzy OVapi line matching (mergeLive,
// normRef, similarity), Dutch fallbacks. Added: converters from the TML worker API (exact IDs only).
import { distanceMeters as geoDistance } from '../../shared/geo';
import type {
  BoardDeparture,
  Departure,
  TransportMode as SharedMode,
  Vehicle as ApiVehicle,
  VehicleRoute,
} from '../../shared/types';
import type { StopTimeState } from './eta';

export type TransportMode = SharedMode;
export type FilterMode = 'all' | TransportMode;
export type Radius = 100 | 200 | 500 | 1000;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Vehicle {
  id: string;
  mode: TransportMode;
  line: string;
  operator: string;
  headsign: string;
  lat: number;
  lng: number;
  bearing: number;
  /** km/h measured from recent GPS fixes; NaN when not known. */
  speedKmh: number;
  /** Minutes late at its next stop (exact trip_id match on the board); NaN when not known. */
  punctualityMin: number;
  routeId: string;
  /** true when the position comes from the live feed (always, in TPulso). */
  live?: boolean;
  /** ms timestamp of the last live fix. */
  fixAt?: number;
  delaySec?: number;
  /** TML trip_id: links the vehicle to departures (exact key). */
  tripId: string;
  /** The operator has no line or route data for this vehicle today. */
  routeUnavailable?: boolean;
}

export interface Stop {
  id: string;
  name: string;
  mode: TransportMode;
  lat: number;
  lng: number;
}

export interface Arrival {
  id: string;
  stopId: string;
  stopName: string;
  mode: TransportMode;
  line: string;
  headsign: string;
  minutes: number;
  /** Seconds until departure (precise countdown). */
  etaSec?: number;
  delayMin: number;
  platform?: string;
  distanceM: number;
  vehicleId?: string;
  /** Live board fields. */
  vehicleKey?: string;
  stopArea?: string;
  expectedAt?: number;
  realtime?: boolean;
  cancelled?: boolean;
  skipped?: boolean;
  /** TPulso: "Line alert · Metro de Lisboa" when a service alert concerns this departure. */
  alert?: string | undefined;
}

/** A departure as delivered by the board (here: mapped from /api/board). */
export interface LiveDeparture {
  id: string;
  vehicleKey: string;
  stopArea: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  distanceM: number;
  line: string;
  mode: TransportMode;
  destination: string;
  operator: string;
  expectedAt: number;
  plannedAt: number;
  delaySec: number;
  realtime: boolean;
  cancelled: boolean;
  /** Trip still runs, but doesn't call at this stop. */
  skipped?: boolean;
  /** TPulso: "Line alert · Metro de Lisboa" when a service alert concerns this departure. */
  alert?: string | undefined;
}

/** The connection the user follows. */
export interface Pinned {
  vehicleKey: string;
  stopArea: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  line: string;
  mode: TransportMode;
  destination: string;
}

/** Vehicle whose route can't be shown (no line/route data from the operator). */
export const isUnknownRoute = (v: Vehicle) => !!v.routeUnavailable;

export function distanceMeters(a: LatLng, b: LatLng) {
  return geoDistance(a, b);
}

/** A transit line geometry (official GTFS shape via the TML API). */
export interface TransitRoute {
  id: string;
  mode: TransportMode;
  line: string;
  headsign: string;
  operator: string;
  path: [number, number][];
  stops?: { name: string; lat: number; lng: number }[];
  /** cumulative metres along path */
  cum: number[];
  /** TPulso offline: the route this slice belongs to (several slices per route, one per map area). */
  group?: string;
}

export function prepareRoute(r: Omit<TransitRoute, 'cum'>): TransitRoute {
  const path = r.path;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    cum.push(cum[i - 1]! + distanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }));
  }
  return { ...r, path, cum };
}

/** Portions of a route that lie inside the radar circle. */
export function clipRoute(r: TransitRoute, center: LatLng, radius: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of r.path) {
    if (distanceMeters({ lat: p[0], lng: p[1] }, center) <= radius) cur.push(p);
    else if (cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export function isInside(v: LatLng, center: LatLng, radius: number) {
  return distanceMeters(v, center) <= radius;
}

export const MODE_LABEL: Record<TransportMode, string> = {
  bus: 'Bus',
  train: 'Train',
  tram: 'Tram/Metro',
  ferry: 'Ferry',
};

export interface UpcomingStop {
  key: string;
  name: string;
  lat: number;
  lng: number;
  aheadM: number;
  etaS: number;
  /** TPulso: exactly one data-source state per stop (Live / Scheduled / Estimated). */
  state: StopTimeState;
  stopId: string;
}

/** Precise countdown: "now", "0:45", "3:05", "1:02:10". */
export function etaLabel(s: number) {
  const t = Math.max(0, Math.round(s));
  if (t < 10) return 'now';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// ---- TPulso: converters from the TML worker API ------------------------------------------------

export const OPERATOR = 'Carris Metropolitana';
/** Everything the TML provider delivers is a bus. */
export const DATA_MODE: TransportMode = 'bus';

export function fromApiVehicle(
  v: ApiVehicle,
  extra: { speedKmh: number; punctualityMin: number; delaySec?: number; routeUnavailable: boolean },
): Vehicle {
  return {
    id: v.id,
    mode: DATA_MODE,
    line: v.line ?? '?',
    operator: OPERATOR,
    headsign: v.headsign ?? '',
    lat: v.lat,
    lng: v.lng,
    bearing: v.bearing ?? 0,
    speedKmh: extra.speedKmh,
    punctualityMin: extra.punctualityMin,
    // Each live vehicle gets its own route (its pattern's official shape), keyed by vehicle id.
    routeId: v.id,
    live: true,
    fixAt: v.timestamp,
    tripId: v.tripId,
    routeUnavailable: extra.routeUnavailable || v.line === null,
    ...(extra.delaySec !== undefined ? { delaySec: extra.delaySec } : {}),
  };
}

/** Board row -> the original's LiveDeparture. vehicleKey = trip_id (exact link to the vehicle). */
export function toLiveDeparture(d: BoardDeparture): LiveDeparture {
  return {
    id: d.id,
    vehicleKey: d.tripId ?? d.id,
    stopArea: d.stopId,
    stopName: d.stopName,
    stopLat: d.stopLat,
    stopLng: d.stopLng,
    distanceM: d.distanceM,
    line: d.line,
    mode: DATA_MODE,
    destination: d.headsign,
    operator: OPERATOR,
    expectedAt: (d.estimatedAt ?? d.scheduledAt) * 1000,
    plannedAt: d.scheduledAt * 1000,
    delaySec: d.estimatedAt !== null ? d.estimatedAt - d.scheduledAt : 0,
    realtime: d.estimatedAt !== null,
    cancelled: false,
  };
}

/** One stop's own departures (tapped stop / pinned stop) -> LiveDeparture rows for that stop. */
export function stopDeparturesToLive(
  stop: { id: string; name: string; lat: number; lng: number; distanceM: number },
  deps: readonly Departure[],
): LiveDeparture[] {
  return deps.map(d =>
    toLiveDeparture({
      ...d,
      id: `${d.tripId ?? `${d.line}|${d.headsign}|${d.scheduledAt}`}@${stop.id}`,
      stopId: stop.id,
      stopName: stop.name,
      stopLat: stop.lat,
      stopLng: stop.lng,
      distanceM: stop.distanceM,
    }),
  );
}

export function toTransitRoute(r: VehicleRoute): TransitRoute {
  return prepareRoute({
    id: r.vehicleId,
    mode: DATA_MODE,
    line: r.line ?? '?',
    headsign: r.headsign ?? '',
    operator: OPERATOR,
    path: r.path,
  });
}

const clockFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' });
const clockSecFmt = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
/** "14:05" in Lisbon time (the original used nl-NL local time). */
export const clock = (ms: number) => clockFmt.format(new Date(ms));
/** "14:05:09" in Lisbon time. */
export const clockSec = (ms: number) => clockSecFmt.format(new Date(ms));
