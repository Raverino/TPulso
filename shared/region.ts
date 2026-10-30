import type { LatLng, TransportMode } from './types';

/** Everything region-specific lives here, so another region/operator can be added later. */
export interface RegionConfig {
  id: string;
  name: string;
  timeZone: string;
  /** Used when GPS is denied or the user is outside `bounds`. Always shown with a "TEST" label. */
  testLocation: LatLng & { label: string };
  /** Rough bounding box of the country; outside it we switch to TEST mode. */
  bounds: { south: number; west: number; north: number; east: number };
  radii: readonly number[];
  defaultRadius: number;
  /** Modes our providers deliver real data for. Other modes are shown in the filter as "no data yet". */
  modesWithData: readonly TransportMode[];
  /** Operators whose tram-mode lines are a metro: their stops are merged into stations like trains. */
  metroOperators: readonly string[];
  /**
   * Full names of lines whose code alone is not understood (manifest operator id -> line code -> name), shown next
   * to the code. Display only: nothing is linked by these names.
   */
  lineNames: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export const LISBON: RegionConfig = {
  id: 'pt-lisbon-tml',
  name: 'Área Metropolitana de Lisboa',
  timeZone: 'Europe/Lisbon',
  testLocation: { lat: 38.725878, lng: -9.151315, label: 'Marquês de Pombal' },
  // Mainland Portugal plus a margin (Azores/Madeira are not served by TML anyway).
  bounds: { south: 36.8, west: -9.6, north: 42.2, east: -6.1 },
  radii: [100, 200, 500, 1000],
  defaultRadius: 200,
  // Carris Metropolitana (TML) runs buses only. Metro, trains and ferries: see docs/OPERATORS.md.
  modesWithData: ['bus'],
  // Metro de Lisboa (manifest operator id): one station per metro stop, not one platform per direction.
  metroOperators: ['metro'],
  // Metro de Lisboa's line codes (its GTFS route_short_name): Azul, Amarela, Verde, Vermelha.
  lineNames: { metro: { Az: 'Linha Azul', Am: 'Linha Amarela', Vd: 'Linha Verde', Vm: 'Linha Vermelha' } },
};

/** The full name of a line (e.g. "Linha Azul" for Metro "Az"), or undefined when its code is the name. */
export function lineNameOf(region: Pick<RegionConfig, 'lineNames'>, op: string, line: string): string | undefined {
  return region.lineNames[op]?.[line];
}

export function isInsideBounds(p: LatLng, b: RegionConfig['bounds']): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}
