import { withinRadius } from '../../../shared/geo';
import type { RegionConfig } from '../../../shared/region';
import type { Board, DepartureList, LatLng, StopList, TransitProvider, VehicleList, VehicleRoute, VehicleStopTimes } from '../../../shared/types';
import { TmlClient } from './client';
import { stripNamespace } from './ids';
import {
  dateInZone,
  indexLines,
  matchTripAtStop,
  nextStopIds,
  pickPattern,
  rawVehiclesNear,
  toBoardDepartures,
  toDepartures,
  toStopLites,
  toVehicle,
  toVehicleRoute,
  type DepartureWindow,
  type LinesById,
} from './map';
import type { RawArrival, RawLine, RawPattern, RawShape, RawStop, RawVehicle } from './raw';

// Cache times (seconds). Vehicles/arrivals follow the API's own Cache-Control (5 s / 20 s).
const TTL = { stops: 24 * 3600, lines: 3600, arrivals: 20, vehicles: 5, pattern: 3600, shape: 3600 } as const;

const DAY_MS = 24 * 3600 * 1000;

/** The board queries at most this many stops (nearest first), to bound upstream calls. */
export const MAX_BOARD_STOPS = 20;
const BOARD_WINDOW: DepartureWindow = { pastGraceSec: 60, horizonSec: 30 * 60, max: 12 };
/** Destinations are looked up for at most this many distinct patterns per request. */
const MAX_HEADSIGN_PATTERNS = 30;
/** A selected vehicle's own times are looked up at this many next stops. */
export const VEHICLE_STOP_TIMES_COUNT = 10;

export class TmlProvider implements TransitProvider {
  private readonly client: TmlClient;
  private readonly region: RegionConfig;

  constructor(region: RegionConfig, client = new TmlClient()) {
    this.region = region;
    this.client = client;
  }

  async stopList(): Promise<StopList> {
    const raw = await this.require<RawStop[]>('/stops', TTL.stops);
    return { generatedAt: new Date().toISOString(), stops: toStopLites(raw) };
  }

  async departures(stopId: string, nowSec: number): Promise<DepartureList> {
    const [arrivals, lines] = await Promise.all([this.arrivals(stopId), this.lines()]);
    return { stopId, generatedAt: new Date(nowSec * 1000).toISOString(), departures: toDepartures(arrivals, lines, nowSec) };
  }

  /** Departures in the next 30 min from every stop inside the radius (nearest MAX_BOARD_STOPS stops). */
  async board(center: LatLng, radiusM: number, nowSec: number): Promise<Board> {
    const [{ stops }, lines] = await Promise.all([this.stopList(), this.lines()]);
    const inside = withinRadius(stops, center, radiusM);
    const queried = inside.slice(0, MAX_BOARD_STOPS);
    const results = await Promise.allSettled(queried.map(s => this.arrivals(s.id)));
    let failed = 0;
    const departures = results.flatMap((r, i) => {
      if (r.status === 'rejected') {
        failed++;
        return [];
      }
      return toBoardDepartures(queried[i]!, toDepartures(r.value, lines, nowSec, BOARD_WINDOW));
    });
    // Every stop failing means the data source is down: report that instead of an empty board.
    if (queried.length > 0 && failed === queried.length) throw (results[0] as PromiseRejectedResult).reason;
    departures.sort((a, b) => (a.estimatedAt ?? a.scheduledAt) - (b.estimatedAt ?? b.scheduledAt));
    return {
      generatedAt: new Date(nowSec * 1000).toISOString(),
      stopsInRadius: inside.length,
      stopsQueried: queried.length,
      stopsFailed: failed,
      stopIds: queried.map(s => s.id),
      departures,
    };
  }

  async vehiclesNear(center: LatLng, radiusM: number, now = new Date()): Promise<VehicleList> {
    const [vehicles, lines] = await Promise.all([this.rawVehicles(), this.lines()]);
    const near = rawVehiclesNear(vehicles, center, radiusM);
    // Destination comes from the vehicle's pattern (approved link #2, docs/DATA.md §3).
    const patternIds = [...new Set(near.map(v => stripNamespace(v.pattern_id)))].slice(0, MAX_HEADSIGN_PATTERNS);
    const patterns = new Map(await Promise.all(patternIds.map(async id => [id, await this.patternFor(id, now).catch(() => null)] as const)));
    return {
      generatedAt: now.toISOString(),
      vehicles: near.map(v => toVehicle(v, lines, patterns.get(stripNamespace(v.pattern_id))?.headsign ?? null)),
    };
  }

  /** Line, destination, stops and route geometry for one live vehicle; null if the vehicle is not in the feed. */
  async vehicleRoute(vehicleId: string, now: Date): Promise<VehicleRoute | null> {
    const [vehicles, lines] = await Promise.all([this.rawVehicles(), this.lines()]);
    const v = vehicles.find(x => x.id === vehicleId);
    if (!v) return null;
    const pattern = await this.patternFor(stripNamespace(v.pattern_id), now);
    const shape = pattern ? await this.client.getJson<RawShape>(`/shapes/${encodeURIComponent(pattern.shape_id)}`, TTL.shape) : null;
    return toVehicleRoute(v, lines, pattern, shape);
  }

  /**
   * This vehicle's own times at its next VEHICLE_STOP_TIMES_COUNT stops: each stop's arrivals are fetched
   * and the vehicle's row is found by exact trip_id. Stops without a row are left out (the app estimates them).
   */
  async vehicleStopTimes(vehicleId: string, now: Date): Promise<VehicleStopTimes | null> {
    const route = await this.vehicleRoute(vehicleId, now);
    if (!route) return null;
    const v = (await this.rawVehicles()).find(x => x.id === vehicleId);
    if (!v) return null;
    const checked = nextStopIds(route.stopIds, route.nextStopId, VEHICLE_STOP_TIMES_COUNT);
    const rows = await Promise.allSettled(checked.map(id => this.arrivals(id)));
    const times = rows.flatMap((r, i) => {
      if (r.status === 'rejected') return [];
      const t = matchTripAtStop(r.value, v.trip_id, checked[i]!);
      return t ? [t] : [];
    });
    return { vehicleId, generatedAt: now.toISOString(), checkedStopIds: checked, times };
  }

  /** The pattern version valid today (Lisbon), or null when the API has none (docs/DATA.md mismatch #10). */
  private async patternFor(patternId: string, now: Date): Promise<RawPattern | null> {
    const versions = await this.client.getJson<RawPattern[]>(`/patterns/${encodeURIComponent(patternId)}`, TTL.pattern);
    if (!versions) return null;
    const tz = this.region.timeZone;
    return pickPattern(versions, dateInZone(now, tz), dateInZone(new Date(now.getTime() - DAY_MS), tz));
  }

  private async arrivals(stopId: string): Promise<RawArrival[]> {
    // The API answers 404 for an unknown stop; that is "no departures", not an outage.
    return (await this.client.getJson<RawArrival[]>(`/arrivals/by_stop/${encodeURIComponent(stopId)}`, TTL.arrivals)) ?? [];
  }

  private rawVehicles(): Promise<RawVehicle[]> {
    return this.require<RawVehicle[]>('/vehicles', TTL.vehicles);
  }

  private async lines(): Promise<LinesById> {
    return indexLines(await this.require<RawLine[]>('/lines', TTL.lines));
  }

  private async require<T>(path: string, ttl: number): Promise<T> {
    const data = await this.client.getJson<T>(path, ttl);
    if (data === null) throw new Error(`TML API ${path} not found`);
    return data;
  }
}
