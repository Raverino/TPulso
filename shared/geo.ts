import type { LatLng } from './types';

// From the old Dutch-Routes project: flat-earth approximation, accurate to well under 1 % at radar distances.
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dx = (a.lng - b.lng) * mPerDegLng(a.lat);
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Items within `radius` metres of `center`, nearest first, with their distance. */
export function withinRadius<T extends LatLng>(items: readonly T[], center: LatLng, radius: number): (T & { distance: number })[] {
  const out: (T & { distance: number })[] = [];
  for (const it of items) {
    const distance = distanceMeters(it, center);
    if (distance <= radius) out.push({ ...it, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
