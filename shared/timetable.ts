// Offline timetable format (docs/OFFLINE.md), shared by the converter (scripts/) and the app.
// Everything here is timetable data: never present it as live.

import type { TransportMode } from './types';

/** ~2.2 x 2.2 km grid cells around Lisbon (38.7° N). */
export const AREA_LAT_DEG = 0.02;
export const AREA_LNG_DEG = 0.025;

export function areaKey(lat: number, lng: number): string {
  return `${Math.floor(lat / AREA_LAT_DEG)}_${Math.floor(lng / AREA_LNG_DEG)}`;
}

/** Keys of all areas overlapping a circle (plus `ringAreas` extra rings around it). */
export function areasAround(lat: number, lng: number, radiusM: number, ringAreas = 0): string[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const i0 = Math.floor((lat - dLat) / AREA_LAT_DEG) - ringAreas;
  const i1 = Math.floor((lat + dLat) / AREA_LAT_DEG) + ringAreas;
  const j0 = Math.floor((lng - dLng) / AREA_LNG_DEG) - ringAreas;
  const j1 = Math.floor((lng + dLng) / AREA_LNG_DEG) + ringAreas;
  const out: string[] = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(`${i}_${j}`);
  return out;
}

/** GTFS route_type -> filter mode (Tram·Metro groups trams, light rail and subway). */
export function modeOfRouteType(t: number): TransportMode {
  if (t === 0 || t === 1 || t === 5 || t === 7 || (t >= 400 && t < 500) || (t >= 900 && t < 1000)) return 'tram';
  if (t === 2 || (t >= 100 && t < 200)) return 'train';
  if (t === 4 || t === 1000 || t === 1200) return 'ferry';
  return 'bus';
}

export interface OperatorInfo {
  id: string;
  name: string;
  modes: TransportMode[];
  /** First and last service date in the feed (YYYYMMDD). */
  dateFrom: string;
  dateTo: string;
  tripsToday: number;
  crossCheck: { ownTripsToday: number | null; diffPct: number | null; status: 'ok' | 'mismatch' | 'unavailable' | 'none'; note?: string };
}

export interface Manifest {
  format: 1;
  version: string;
  generatedAt: string;
  timezone: 'Europe/Lisbon';
  feed: { url: string; version: string; publisher: string };
  /** Service days covered: first date (YYYYMMDD) and number of days. */
  window: { first: string; days: number };
  operators: OperatorInfo[];
  excluded: { id: string; name: string; reason: string }[];
  area: { latDeg: number; lngDeg: number };
  /** Area key -> compressed (gzip) file size in bytes. */
  areas: Record<string, number>;
}

/** [stop id, name, lat, lng] */
export type StopRow = [string, string, number, number];

/** [start (seconds after service-day start), profile index, day bitmask over the window] */
export type TripRow = [number, number, number];

/** One route pattern (same route, stop sequence, shape and destination), or a slice of it. */
export interface PatternData {
  id: number;
  line: string;
  color: string;
  textColor: string;
  mode: TransportMode;
  /** Operator id (Manifest.operators[].id). */
  op: string;
  headsign: string;
  /** Index of stops[0] in the full pattern (0 for a route file). */
  first: number;
  /** Total number of stops in the full pattern. */
  total: number;
  stops: string[];
  /** Metres along the shape for each stop (relative to the start of `shape`). */
  dist: number[];
  /** Encoded polyline (precision 5) from stops[0] to the last stop. */
  shape: string;
  /** Per profile: [arrival, departure] offsets in seconds from the trip start, flattened, for `stops`. */
  profiles: number[][];
  trips: TripRow[];
}

export interface AreaFile {
  format: 1;
  version: string;
  area: string;
  stops: StopRow[];
  patterns: PatternData[];
}

export interface RouteFile extends PatternData {
  format: 1;
  version: string;
  /** Every stop of the pattern, so names/positions are known outside loaded areas. */
  stopInfo: StopRow[];
}

// ---- polyline (Google encoded polyline, precision 5) ----

export function encodePolyline(points: readonly [number, number][]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  for (const [la, lg] of points) {
    const a = Math.round(la * 1e5);
    const b = Math.round(lg * 1e5);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a;
    pLng = b;
  }
  return out;
}

export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

// ---- service days ----

/** Calendar date (YYYYMMDD) in the given time zone. */
export function dateInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** Offset of the zone from UTC in ms at the given instant. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find(x => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/**
 * Start of a GTFS service day: "noon minus 12 h" local time (GTFS reference). On DST days this differs
 * from local midnight, and GTFS times such as 25:10:00 are counted from it.
 */
export function serviceDayStartMs(date: string, timeZone: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  const noonUtcGuess = Date.UTC(y, m, d, 12);
  const noonLocal = noonUtcGuess - zoneOffsetMs(noonUtcGuess, timeZone);
  return noonLocal - 12 * 3600_000;
}

/** YYYYMMDD + n days. */
export function addDays(date: string, n: number): string {
  const t = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) + n));
  return t.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Index of `date` in the window, or -1. */
export function dayIndex(window: { first: string; days: number }, date: string): number {
  for (let i = 0; i < window.days; i++) if (addDays(window.first, i) === date) return i;
  return -1;
}
