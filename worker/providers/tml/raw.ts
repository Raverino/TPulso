// Shapes of the Carris Metropolitana v2 API responses we use (only the fields we read).
// Captured examples live in fixtures/.

export interface RawStop {
  id: string;
  long_name: string;
  lat: number;
  lon: number;
  line_ids: string[];
}

export interface RawLine {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  pattern_ids: string[];
}

export interface RawArrival {
  line_id: string;
  pattern_id: string;
  route_id: string;
  headsign: string;
  trip_id: string | null;
  vehicle_id: string | null;
  scheduled_arrival_unix: number;
  estimated_arrival_unix: number | null;
  observed_arrival_unix: number | null;
  stop_sequence: number;
}

export interface RawVehicle {
  id: string;
  agency_id: string;
  lat: number;
  lon: number;
  bearing: number | null;
  line_id: string;
  pattern_id: string;
  route_id: string;
  trip_id: string;
  stop_id: string;
  timestamp: number;
}

export interface RawPattern {
  id: string;
  line_id: string;
  headsign: string;
  shape_id: string;
  valid_on: string[];
  path: { stop_id: string; stop_sequence: number }[];
}

export interface RawShape {
  shape_id: string;
  geojson: { geometry: { type: 'LineString'; coordinates: [number, number][] } };
}
