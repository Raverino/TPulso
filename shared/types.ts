// Data shapes shared by the server (Worker) and the app. No operator-internal IDs are meant
// for display: show `line`, `headsign` and stop `name` only.

export type TransportMode = 'bus' | 'tram' | 'train' | 'ferry';

export interface LatLng {
  lat: number;
  lng: number;
}

/** One entry of the trimmed stop list the phone caches. */
export interface StopLite {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface StopList {
  generatedAt: string;
  stops: StopLite[];
}

export interface Departure {
  /** Present only for real-time rows; links to Vehicle.tripId. */
  tripId: string | null;
  vehicleId: string | null;
  line: string;
  lineColor: string;
  lineTextColor: string;
  headsign: string;
  /** Unix seconds. */
  scheduledAt: number;
  /** Unix seconds; null = scheduled only (no real-time estimate). */
  estimatedAt: number | null;
}

/** A departure on the combined board for all stops inside the radar. */
export interface BoardDeparture extends Departure {
  /** Stable key for this departure at this stop (internal, never displayed). */
  id: string;
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  distanceM: number;
}

export interface Board {
  generatedAt: string;
  /** Stops inside the radius, and how many of them were queried / failed. */
  stopsInRadius: number;
  stopsQueried: number;
  stopsFailed: number;
  /** IDs of the stops whose departures are included (nearest first). */
  stopIds: string[];
  departures: BoardDeparture[];
}

export interface DepartureList {
  stopId: string;
  generatedAt: string;
  departures: Departure[];
}

export interface Vehicle {
  id: string;
  lat: number;
  lng: number;
  /** Degrees, 0 = north. */
  bearing: number | null;
  line: string | null;
  lineColor: string | null;
  lineTextColor: string | null;
  tripId: string;
  /** Destination; null when the operator's route data is not available. */
  headsign: string | null;
  /** Unix milliseconds of the GPS fix. */
  timestamp: number;
}

export interface VehicleList {
  generatedAt: string;
  vehicles: Vehicle[];
}

export interface VehicleRoute {
  vehicleId: string;
  line: string | null;
  lineColor: string | null;
  headsign: string | null;
  /** [lat, lng] pairs; empty when the route geometry is not available. */
  path: [number, number][];
  /** Stop IDs of the route in travel order (empty when not available). */
  stopIds: string[];
  /** The stop the vehicle is heading to / serving now, if known. */
  nextStopId: string | null;
}

/** This vehicle's own row at one of its next stops, matched by exact trip_id. */
export interface VehicleStopTime {
  stopId: string;
  /** Unix seconds. */
  scheduledAt: number;
  /** Unix seconds; null = no live estimate (scheduled time only). */
  estimatedAt: number | null;
}

export interface VehicleStopTimes {
  vehicleId: string;
  generatedAt: string;
  /** Stops that were checked (the next few on the route, in travel order). */
  checkedStopIds: string[];
  /** Rows found for this trip; a checked stop without a row is simply absent. */
  times: VehicleStopTime[];
}

/** What every operator implementation must provide. */
export interface TransitProvider {
  stopList(): Promise<StopList>;
  departures(stopId: string, nowSec: number): Promise<DepartureList>;
  board(center: LatLng, radiusM: number, nowSec: number): Promise<Board>;
  vehiclesNear(center: LatLng, radiusM: number): Promise<VehicleList>;
  vehicleRoute(vehicleId: string, now: Date): Promise<VehicleRoute | null>;
  vehicleStopTimes(vehicleId: string, now: Date): Promise<VehicleStopTimes | null>;
}
