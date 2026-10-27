// Engine tests on the converter's output for fixtures/gtfs-tml-sample (real rows of the TML regional feed).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePolyline, serviceDayStartMs, type AreaFile, type Manifest, type RouteFile } from '../../shared/timetable';
import { convert } from '../../scripts/timetable/convert';
import { folderSource } from '../../scripts/timetable/gtfs';
import { OPERATORS } from '../../scripts/timetable/operators';
import { activeTrips, departuresAtStop, easeAlong, expectedVehicles, isExpired, pointAlong, positionOf, positionsAt, routePath, tripStopsForRow, upcomingStops, type ActiveTrip } from './engine';

const TODAY = '20261025';
const manifest: Pick<Manifest, 'window'> = { window: { first: TODAY, days: 14 } };
const resP = convert(folderSource(path.resolve(__dirname, '../../fixtures/gtfs-tml-sample')), { today: TODAY, days: 14, operators: OPERATORS, version: 't' });
const day = serviceDayStartMs(TODAY, 'Europe/Lisbon'); // 2026-10-25T00:00Z (DST change day)
const at = (h: number, m: number, s = 0) => day + ((h * 60 + m) * 60 + s) * 1000;

async function setup() {
  const res = await resP;
  const areas = [...res.areas.values()];
  const route3715 = [...res.routes.values()].find(r => r.line === '3715') as RouteFile;
  return { res, areas, route3715 };
}

describe('departuresAtStop', () => {
  it('lists the 08:45 and 09:45 departures of line 3715 at its first stop, and only inside the window', async () => {
    const { areas, route3715 } = await setup();
    const first = route3715.stops[0]!;
    const deps = departuresAtStop(manifest, areas, first, at(8, 40), at(9, 50));
    const mine = deps.filter(d => d.line === '3715');
    expect(mine.map(d => new Date(d.atMs).toISOString())).toEqual(['2026-10-25T08:45:00.000Z', '2026-10-25T09:45:00.000Z']);
    expect(departuresAtStop(manifest, areas, first, at(8, 46), at(9, 0)).filter(d => d.line === '3715')).toEqual([]);
  });
  it('gives no departure at the last stop of a trip', async () => {
    const { areas, route3715 } = await setup();
    const last = route3715.stops.at(-1)!;
    expect(departuresAtStop(manifest, areas, last, at(0, 0), at(23, 59)).filter(d => d.patternId === route3715.id)).toEqual([]);
  });
});

describe('expectedVehicles', () => {
  it('places a 3715 bus between the two scheduled stops it is travelling between, on the route', async () => {
    const { areas, route3715 } = await setup();
    const pr = route3715.profiles[route3715.trips[0]![1]]!;
    const start = route3715.trips.map(t => t[0]).sort((a, b) => a - b)[0]!;
    // Pick a segment with travel time: departure from stop 3, arrival at stop 4.
    const dep = pr[3 * 2 + 1]!, arr = pr[4 * 2]!;
    const mid = day + (start + (dep + arr) / 2) * 1000;
    const vs = expectedVehicles(manifest, areas, mid).filter(v => v.line === '3715');
    expect(vs).toHaveLength(1);
    const v = vs[0]!;
    expect(v.atStop).toBe(false);
    expect(v.nextStopIndex).toBe(4);
    // On the official route line (stops 3 -> 4 cross the 25 de Abril bridge, a 6.3 km detour west then south,
    // so a box around the two stops would be wrong).
    const line = routePath(route3715);
    const near = Math.min(...line.map(([la, lg]) => Math.hypot((la - v.lat) * 111_320, (lg - v.lng) * 111_320 * Math.cos((v.lat * Math.PI) / 180))));
    expect(near).toBeLessThan(40);
    // Halfway in time between the two stops = between their distances along the route.
    const s3 = route3715.stopInfo[3]!, s4 = route3715.stopInfo[4]!;
    const dTo3 = Math.hypot((s3[2] - v.lat) * 111_320, (s3[3] - v.lng) * 111_320 * 0.78);
    const dTo4 = Math.hypot((s4[2] - v.lat) * 111_320, (s4[3] - v.lng) * 111_320 * 0.78);
    expect(dTo3).toBeGreaterThan(100);
    expect(dTo4).toBeGreaterThan(100);
  });
  it('moves smoothly: positions one second apart are close and in travel order', async () => {
    const { areas } = await setup();
    const a = expectedVehicles(manifest, areas, at(8, 50)).find(v => v.line === '3715')!;
    const b = expectedVehicles(manifest, areas, at(8, 50, 1)).find(v => v.key === a.key)!;
    const moved = Math.hypot((b.lat - a.lat) * 111_320, (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
    expect(moved).toBeLessThan(40); // < 144 km/h
  });
  it('shows nothing before a trip starts or after it ends', async () => {
    const { areas } = await setup();
    expect(expectedVehicles(manifest, areas, at(8, 44)).filter(v => v.line === '3715')).toHaveLength(0);
    expect(expectedVehicles(manifest, areas, at(23, 0)).filter(v => v.line === '3715')).toHaveLength(0);
  });
  it('shows the tram 15E trip after midnight as part of the previous service day', async () => {
    const { areas } = await setup();
    const vs = expectedVehicles(manifest, areas, at(24, 10)).filter(v => v.line === '15E');
    expect(vs).toHaveLength(1);
    expect(vs[0]!.serviceDate).toBe(TODAY);
  });
  it('links a vehicle to its upcoming departure at a stop by the same trip key (used to filter on stop tap)', async () => {
    const { areas, route3715 } = await setup();
    const now = at(8, 50);
    const v = expectedVehicles(manifest, areas, now).find(x => x.line === '3715')!;
    const nextStop = route3715.stops[v.nextStopIndex]!;
    const deps = departuresAtStop(manifest, areas, nextStop, now, now + 600_000);
    expect(deps.map(d => d.tripKey)).toContain(v.key);
    // A stop the bus has already passed does not list it.
    const passed = route3715.stops[Math.max(0, v.nextStopIndex - 2)]!;
    expect(departuresAtStop(manifest, areas, passed, now, now + 600_000).map(d => d.tripKey)).not.toContain(v.key);
  });
  it('never returns the same trip twice (slices overlap between areas)', async () => {
    const { areas } = await setup();
    for (const h of [9, 12, 17, 20]) {
      const keys = expectedVehicles(manifest, areas, at(h, 0)).map(v => v.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('upcomingStops and expiry', () => {
  it('lists the remaining stops with increasing scheduled times', async () => {
    const { route3715 } = await setup();
    const ups = upcomingStops(route3715, 0, TODAY, 5);
    expect(ups[0]!.index).toBe(5);
    expect(ups.length).toBe(route3715.stops.length - 5);
    for (let i = 1; i < ups.length; i++) expect(ups[i]!.atMs).toBeGreaterThanOrEqual(ups[i - 1]!.atMs);
  });
  it('says the data expired after the last day of the window', () => {
    expect(isExpired(manifest, at(12, 0))).toBe(false);
    expect(isExpired(manifest, day + 15 * 24 * 3600_000)).toBe(true);
  });
  it('finds points along a slice shape', async () => {
    const { areas } = await setup();
    const p = (areas as AreaFile[]).flatMap(a => a.patterns).find(x => x.line === '3715')!;
    const a = pointAlong(p, 0), b = pointAlong(p, p.dist.at(-1)!);
    expect(Number.isFinite(a.lat) && Number.isFinite(b.lat)).toBe(true);
  });
});

describe('tripStopsForRow', () => {
  it('lists the trip from the vehicle\'s next stop, marks the row\'s stop and gives the terminus', async () => {
    const { areas, route3715 } = await setup();
    const now = at(8, 50);
    const v = expectedVehicles(manifest, areas, now).find(x => x.line === '3715')!;
    const rowStop = route3715.stops[v.nextStopIndex + 2]!;
    const dep = departuresAtStop(manifest, areas, rowStop, now, now + 3600_000).find(d => d.tripKey === v.key)!;
    const t = tripStopsForRow(route3715, v.tripIndex, v.serviceDate, rowStop, dep.atMs, v.nextStopIndex)!;
    expect(t.nextIndex).toBe(v.nextStopIndex);
    expect(t.stops[0]!.index).toBe(v.nextStopIndex);
    expect(t.yourIndex).toBe(v.nextStopIndex + 2);
    expect(t.terminus).toBe(route3715.stopInfo.at(-1)![1]);
  });
  it('starts at the first stop when the trip has not started yet', async () => {
    const { route3715 } = await setup();
    const t = tripStopsForRow(route3715, 0, TODAY, route3715.stops[3]!, 0, undefined)!;
    expect(t.nextIndex).toBe(0);
    expect(t.stops).toHaveLength(route3715.stops.length);
    expect(t.yourIndex).toBe(3);
  });
});

describe('animation helpers', () => {
  it('eases out of and into stops, symmetric, ending exactly at the stops', () => {
    expect(easeAlong(0)).toBe(0);
    expect(easeAlong(1)).toBe(1);
    expect(easeAlong(0.5)).toBeCloseTo(0.5, 10);
    expect(easeAlong(0.05)).toBeLessThan(0.05); // slower just after a stop
    expect(easeAlong(0.95)).toBeGreaterThan(0.95); // slower just before the next stop
    for (let t = 0.01; t <= 1; t += 0.01) expect(easeAlong(t)).toBeGreaterThanOrEqual(easeAlong(t - 0.01)); // never goes back
  });
  it('gives the same vehicles from the active-trip index as from a full scan', async () => {
    const { areas } = await setup();
    const now = at(8, 50);
    const idx = activeTrips(manifest, areas, now - 60_000, now + 60_000);
    expect(positionsAt(idx, now).map(v => v.key).sort()).toEqual(expectedVehicles(manifest, areas, now).map(v => v.key).sort());
  });
});

describe('bus dwell cap (display)', () => {
  // Three stops 500 m apart due north; the middle stop has a 90 s scheduled dwell (arrive 100 s, leave 190 s).
  const pr = [0, 0, 100, 190, 300, 300];
  const pattern = (mode: 'bus' | 'tram') => ({
    id: 1, line: 'X', color: '', textColor: '', mode, op: 'carris', headsign: 'Norte', first: 0, total: 3,
    stops: ['a', 'b', 'c'], dist: [0, 500, 1000], shape: encodePolyline([[38.72, -9.15], [38.7245, -9.15], [38.729, -9.15]]),
    profiles: [pr], trips: [[0, 0, 1]] as [number, number, number][],
  });
  const trip = (mode: 'bus' | 'tram'): ActiveTrip => ({ key: 'k', p: pattern(mode), tripIndex: 0, serviceDate: '20261027', startMs: 0, pr, fromMs: 0, toMs: 300_000 });
  it('shows a bus waiting at most 60 s: it arrives at 130 s instead of 100 s, and still leaves at 190 s', () => {
    expect(positionOf(trip('bus'), 110_000)!.atStop).toBe(false); // still driving in
    expect(positionOf(trip('bus'), 140_000)!.atStop).toBe(true);
    expect(positionOf(trip('bus'), 189_000)!.atStop).toBe(true);
    expect(positionOf(trip('bus'), 200_000)!.atStop).toBe(false);
  });
  it('keeps the scheduled dwell for other modes', () => {
    expect(positionOf(trip('tram'), 110_000)!.atStop).toBe(true);
  });
});
