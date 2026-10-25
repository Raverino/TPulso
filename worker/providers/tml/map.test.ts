import { describe, expect, it } from 'vitest';
import { LISBON } from '../../../shared/region';
import { dateInZone, hasPosition, indexLines, pickPattern, toDepartures, toStopLites, toVehicleRoute, toVehiclesNear } from './map';
import type { RawArrival, RawLine, RawPattern, RawShape, RawStop, RawVehicle } from './raw';
import linesJson from '../../../fixtures/lines.json';
import vehiclesJson from '../../../fixtures/vehicles.json';
import nearStops from '../../../fixtures/stops.near-test-1500m.json';
import unservedStops from '../../../fixtures/stops.unserved-sample.json';
import arrivals060035 from '../../../fixtures/arrivals.by_stop.060035.json';
import patternJson from '../../../fixtures/pattern.3715_0_1.json';
import shapeJson from '../../../fixtures/shape._2QDAD_3715_0_1.json';
import meta from '../../../fixtures/_meta.json';

const lines = indexLines(linesJson as RawLine[]);
const vehicles = vehiclesJson as RawVehicle[];
const capturedSec = Math.floor(Date.parse(meta.captured_at) / 1000);
const chosen = meta.chosen_vehicle;

describe('toStopLites', () => {
  const lites = toStopLites([...nearStops, ...unservedStops] as RawStop[]);
  it('keeps only id, name, lat, lng', () => {
    for (const s of lites) expect(Object.keys(s).sort()).toEqual(['id', 'lat', 'lng', 'name']);
    expect(lites.find(s => s.id === '060033')).toEqual({ id: '060033', name: 'Marquês de Pombal (Metro) P1', lat: 38.725878, lng: -9.151315 });
  });
  it('leaves out stops without any line', () => {
    expect(lites).toHaveLength(nearStops.length);
    for (const u of unservedStops) expect(lites.some(s => s.id === u.id)).toBe(false);
  });
});

describe('toDepartures (stop 060035 at capture time)', () => {
  const deps = toDepartures(arrivals060035 as RawArrival[], lines, capturedSec);

  it('returns upcoming departures only, soonest first', () => {
    expect(deps.length).toBeGreaterThan(0);
    const at = deps.map(d => d.estimatedAt ?? d.scheduledAt);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const t of at) expect(t).toBeGreaterThanOrEqual(capturedSec - 60);
  });
  it('leaves out city Carris lines', () => {
    for (const d of deps) expect(['702', '711', '723', '748', '753']).not.toContain(d.line);
  });
  it('marks real time vs scheduled honestly', () => {
    const rt = deps.filter(d => d.estimatedAt !== null);
    const sched = deps.filter(d => d.estimatedAt === null);
    expect(rt.length).toBeGreaterThan(0);
    expect(sched.length).toBeGreaterThan(0);
    for (const d of rt) expect(d.tripId).not.toBeNull();
    for (const d of sched) expect(d.tripId).toBeNull();
  });
  it('shows line number and destination, not internal IDs', () => {
    const d = deps.find(x => x.tripId === chosen.trip_id)!;
    expect(d).toMatchObject({ line: '3715', headsign: 'Santa Marta do Pinhal (via Centro Sul)', estimatedAt: 1792935728, scheduledAt: 1792936080 });
    for (const x of deps) expect(x.line).not.toMatch(/\[/);
  });
});

describe('toVehiclesNear', () => {
  it('finds the captured vehicle near its next stop and links its line exactly', () => {
    const near = toVehiclesNear(vehicles, lines, LISBON.testLocation, 1000);
    const v = near.find(x => x.id === chosen.id)!;
    expect(v).toMatchObject({ line: '3715', tripId: chosen.trip_id });
    expect(v.lineColor).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it('returns nothing outside the radius', () => {
    expect(toVehiclesNear(vehicles, lines, { lat: 41.15, lng: -8.61 }, 1000)).toEqual([]); // Porto
  });
  it('drops vehicles without a GPS fix (reported at 0,0)', () => {
    const noFix = vehicles.filter(v => !hasPosition(v));
    expect(noFix.map(v => v.id)).toEqual(['[BNA17]2051']); // real case in the fixture
    expect(toVehiclesNear(vehicles, lines, { lat: 0, lng: 0 }, 1000)).toEqual([]);
  });
  it('keeps vehicles whose line is unknown, with line = null', () => {
    const all = toVehiclesNear(vehicles, lines, LISBON.testLocation, 200_000);
    expect(all).toHaveLength(vehicles.filter(hasPosition).length);
    expect(all.filter(v => v.line === null).length).toBeLessThanOrEqual(2);
  });
});

describe('dateInZone', () => {
  it('uses Lisbon local date', () => {
    expect(dateInZone(new Date('2026-07-01T23:30:00Z'), 'Europe/Lisbon')).toBe('20260702'); // 00:30 WEST
    expect(dateInZone(new Date('2026-12-01T23:30:00Z'), 'Europe/Lisbon')).toBe('20261201'); // 23:30 WET
  });
});

describe('vehicle route (vehicle -> pattern -> shape)', () => {
  const patterns = patternJson as unknown as RawPattern[];
  const v = vehicles.find(x => x.id === chosen.id)!;

  it('picks the pattern version valid on the capture date', () => {
    expect(pickPattern(patterns, '20261025', '20261024')?.id).toBe('3715_0_1');
    expect(pickPattern(patterns, '19990101', '19981231')).toBeNull();
  });
  it('builds line, destination and a [lat, lng] path from the official shape', () => {
    const p = pickPattern(patterns, '20261025', '20261024');
    const route = toVehicleRoute(v, lines, p, shapeJson as unknown as RawShape);
    expect(route).toMatchObject({ vehicleId: chosen.id, line: '3715', headsign: 'Santa Marta do Pinhal (via Centro Sul)' });
    expect(route.path).toHaveLength(1079);
    const [lat, lng] = route.path[0]!;
    expect(lat).toBeGreaterThan(38);
    expect(lng).toBeLessThan(-8);
  });
  it('returns an empty path when no pattern is available', () => {
    expect(toVehicleRoute(v, lines, null, null).path).toEqual([]);
  });
});
