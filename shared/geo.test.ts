import { describe, expect, it } from 'vitest';
import { distanceMeters, withinRadius } from './geo';
import { LISBON } from './region';
import type { StopLite } from './types';
import rawStops from '../fixtures/stops.near-test-1500m.json';

const T = LISBON.testLocation;
const stops: StopLite[] = rawStops.map(s => ({ id: s.id, name: s.long_name, lat: s.lat, lng: s.lon }));

describe('distanceMeters', () => {
  it('is 0 for the same point', () => {
    expect(distanceMeters(T, T)).toBe(0);
  });
  it('matches the known distance from the old Avenida da Liberdade TEST point (~729 m haversine)', () => {
    const p1 = stops.find(s => s.id === '060033')!;
    expect(distanceMeters({ lat: 38.72079702815775, lng: -9.146010904277587 }, p1)).toBeCloseTo(729, -1);
  });
});

describe('withinRadius around the TEST point', () => {
  it('finds the Marquês de Pombal stops, nearest first', () => {
    const r100 = withinRadius(stops, T, 100);
    expect(r100.map(s => s.id)).toEqual(['060033', '060123', '060462', '060143']);
    expect(withinRadius(stops, T, 200)).toHaveLength(6);
    for (const s of withinRadius(stops, T, 1000)) expect(s.distance).toBeLessThanOrEqual(1000);
  });
});
