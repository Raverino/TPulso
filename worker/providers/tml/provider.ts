import type { RegionConfig } from '../../../shared/region';
import type { DepartureList, LatLng, StopList, TransitProvider, VehicleList, VehicleRoute } from '../../../shared/types';
import { TmlClient } from './client';
import { stripNamespace } from './ids';
import { dateInZone, indexLines, pickPattern, toDepartures, toStopLites, toVehicleRoute, toVehiclesNear } from './map';
import type { RawArrival, RawLine, RawPattern, RawShape, RawStop, RawVehicle } from './raw';

// Cache times (seconds). Vehicles/arrivals follow the API's own Cache-Control (5 s / 20 s).
const TTL = { stops: 24 * 3600, lines: 3600, arrivals: 20, vehicles: 5, pattern: 3600, shape: 3600 } as const;

const DAY_MS = 24 * 3600 * 1000;

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
    const [arrivals, lines] = await Promise.all([
      this.client.getJson<RawArrival[]>(`/arrivals/by_stop/${encodeURIComponent(stopId)}`, TTL.arrivals),
      this.lines(),
    ]);
    // The API answers 404 for an unknown stop; that is "no departures", not an outage.
    return { stopId, generatedAt: new Date(nowSec * 1000).toISOString(), departures: toDepartures(arrivals ?? [], lines, nowSec) };
  }

  async vehiclesNear(center: LatLng, radiusM: number): Promise<VehicleList> {
    const [vehicles, lines] = await Promise.all([this.rawVehicles(), this.lines()]);
    return { generatedAt: new Date().toISOString(), vehicles: toVehiclesNear(vehicles, lines, center, radiusM) };
  }

  /** Line, destination and route geometry for one live vehicle; null if the vehicle is not in the feed. */
  async vehicleRoute(vehicleId: string, now: Date): Promise<VehicleRoute | null> {
    const [vehicles, lines] = await Promise.all([this.rawVehicles(), this.lines()]);
    const v = vehicles.find(x => x.id === vehicleId);
    if (!v) return null;

    // Approved link #2 (docs/DATA.md §3): vehicle.pattern_id -> /patterns id.
    const versions = await this.client.getJson<RawPattern[]>(`/patterns/${encodeURIComponent(stripNamespace(v.pattern_id))}`, TTL.pattern);
    const tz = this.region.timeZone;
    const pattern = versions ? pickPattern(versions, dateInZone(now, tz), dateInZone(new Date(now.getTime() - DAY_MS), tz)) : null;
    const shape = pattern ? await this.client.getJson<RawShape>(`/shapes/${encodeURIComponent(pattern.shape_id)}`, TTL.shape) : null;
    return toVehicleRoute(v, lines, pattern, shape);
  }

  private rawVehicles(): Promise<RawVehicle[]> {
    return this.require<RawVehicle[]>('/vehicles', TTL.vehicles);
  }

  private async lines() {
    return indexLines(await this.require<RawLine[]>('/lines', TTL.lines));
  }

  private async require<T>(path: string, ttl: number): Promise<T> {
    const data = await this.client.getJson<T>(path, ttl);
    if (data === null) throw new Error(`TML API ${path} not found`);
    return data;
  }
}
