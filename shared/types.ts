// Data shapes shared by the server (Worker) and the app. No operator-internal IDs are meant
// for display: show `line`, `headsign` and stop `name` only.

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
}

/** What every operator implementation must provide. */
export interface TransitProvider {
  stopList(): Promise<StopList>;
  departures(stopId: string, nowSec: number): Promise<DepartureList>;
  vehiclesNear(center: LatLng, radiusM: number): Promise<VehicleList>;
  vehicleRoute(vehicleId: string, now: Date): Promise<VehicleRoute | null>;
}
