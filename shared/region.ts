import type { LatLng } from './types';

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
};

export function isInsideBounds(p: LatLng, b: RegionConfig['bounds']): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}
