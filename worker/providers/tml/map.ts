// Pure functions turning raw TML responses into TPulso data. No network here, so they are
// tested directly against fixtures/.

import { lineIdOfRoute } from '../../../shared/alerts';
import { distanceMeters } from '../../../shared/geo';
import type { BoardDeparture, Departure, LatLng, StopLite, Vehicle, VehicleRoute, VehicleStopTime } from '../../../shared/types';
import { stripNamespace } from './ids';
import type { RawArrival, RawLine, RawPattern, RawShape, RawStop, RawVehicle } from './raw';

export type LinesById = ReadonlyMap<string, RawLine>;

export function indexLines(lines: readonly RawLine[]): LinesById {
  return new Map(lines.map(l => [l.id, l]));
}

/** Trimmed stop list for the phone: id, name, lat, lng. Stops without any line are left out. */
export function toStopLites(stops: readonly RawStop[]): StopLite[] {
  return stops
    .filter(s => s.line_ids.length > 0)
    .map(s => ({ id: s.id, name: s.long_name, lat: s.lat, lng: s.lon }));
}

export interface DepartureWindow {
  /** Keep rows up to this many seconds in the past (the bus may still be at the stop). */
  pastGraceSec: number;
  horizonSec: number;
  max: number;
}

export const DEFAULT_WINDOW: DepartureWindow = { pastGraceSec: 60, horizonSec: 3 * 3600, max: 40 };

/**
 * Upcoming departures, soonest first. A row is real time when the API gives an estimate;
 * otherwise it is scheduled only. Rows whose line is not a TML line (e.g. city Carris,
 * agency IA9T6) are left out.
 */
export function toDepartures(
  arrivals: readonly RawArrival[],
  lines: LinesById,
  nowSec: number,
  win: DepartureWindow = DEFAULT_WINDOW,
): Departure[] {
  const out: { at: number; d: Departure }[] = [];
  for (const a of arrivals) {
    const line = lines.get(stripNamespace(a.line_id));
    if (!line) continue;
    const at = a.estimated_arrival_unix ?? a.scheduled_arrival_unix;
    if (at < nowSec - win.pastGraceSec || at > nowSec + win.horizonSec) continue;
    out.push({
      at,
      d: {
        tripId: a.trip_id,
        vehicleId: a.vehicle_id,
        line: line.short_name,
        lineColor: line.color,
        lineTextColor: line.text_color,
        headsign: a.headsign,
        scheduledAt: a.scheduled_arrival_unix,
        estimatedAt: a.estimated_arrival_unix,
      },
    });
  }
  out.sort((x, y) => x.at - y.at);
  return out.slice(0, win.max).map(x => x.d);
}

export function toVehicle(v: RawVehicle, lines: LinesById, headsign: string | null = null): Vehicle {
  const line = lines.get(v.line_id);
  return {
    id: v.id,
    lat: v.lat,
    lng: v.lon,
    bearing: v.bearing,
    line: line?.short_name ?? null,
    lineColor: line?.color ?? null,
    lineTextColor: line?.text_color ?? null,
    tripId: v.trip_id,
    lineId: lineIdOfRoute(v.route_id),
    headsign,
    timestamp: v.timestamp,
  };
}

/** Some vehicles report lat/lon 0,0 when they have no GPS fix. */
export function hasPosition(v: RawVehicle): boolean {
  return Number.isFinite(v.lat) && Number.isFinite(v.lon) && !(v.lat === 0 && v.lon === 0);
}

/** Raw vehicles with a GPS fix inside the radius. */
export function rawVehiclesNear(vehicles: readonly RawVehicle[], center: LatLng, radiusM: number): RawVehicle[] {
  return vehicles.filter(v => hasPosition(v) && distanceMeters({ lat: v.lat, lng: v.lon }, center) <= radiusM);
}

export function toVehiclesNear(vehicles: readonly RawVehicle[], lines: LinesById, center: LatLng, radiusM: number): Vehicle[] {
  return rawVehiclesNear(vehicles, center, radiusM).map(v => toVehicle(v, lines));
}

/** One stop's departures, tagged with the stop, for the combined board. */
export function toBoardDepartures(stop: StopLite & { distance: number }, deps: readonly Departure[]): BoardDeparture[] {
  return deps.map(d => ({
    ...d,
    // trip_id is unique per trip; scheduled-only rows have none, so fall back to line + destination + time.
    id: `${d.tripId ?? `${d.line}|${d.headsign}|${d.scheduledAt}`}@${stop.id}`,
    stopId: stop.id,
    stopName: stop.name,
    stopLat: stop.lat,
    stopLng: stop.lng,
    distanceM: Math.round(stop.distance),
  }));
}

/** The next `count` stop IDs of a route, starting at the stop the vehicle is heading to. */
export function nextStopIds(stopIds: readonly string[], nextStopId: string | null, count: number): string[] {
  const from = nextStopId ? stopIds.indexOf(nextStopId) : -1;
  return from >= 0 ? stopIds.slice(from, from + count) : [];
}

/** This trip's row in one stop's arrivals, by exact trip_id; null when the stop has no row for it. */
export function matchTripAtStop(arrivals: readonly RawArrival[], tripId: string, stopId: string): VehicleStopTime | null {
  const a = arrivals.find(x => x.trip_id === tripId);
  return a ? { stopId, scheduledAt: a.scheduled_arrival_unix, estimatedAt: a.estimated_arrival_unix } : null;
}

/** "YYYYMMDD" calendar date in the given time zone. */
export function dateInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** /patterns/{id} returns several versions; use the one valid on `date` (or the day before, for after-midnight trips). */
export function pickPattern(versions: readonly RawPattern[], date: string, previousDate: string): RawPattern | null {
  return versions.find(p => p.valid_on.includes(date)) ?? versions.find(p => p.valid_on.includes(previousDate)) ?? null;
}

export function toVehicleRoute(v: RawVehicle, lines: LinesById, pattern: RawPattern | null, shape: RawShape | null): VehicleRoute {
  const line = lines.get(v.line_id);
  return {
    vehicleId: v.id,
    line: line?.short_name ?? null,
    lineColor: line?.color ?? null,
    headsign: pattern?.headsign ?? null,
    path: shape ? shape.geojson.geometry.coordinates.map(([lng, lat]): [number, number] => [lat, lng]) : [],
    stopIds: pattern ? [...pattern.path].sort((a, b) => a.stop_sequence - b.stop_sequence).map(p => p.stop_id) : [],
    nextStopId: /^\d{6}$/.test(v.stop_id) ? v.stop_id : null,
  };
}
