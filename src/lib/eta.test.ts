import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStopEtas, cumulative, DEFAULT_BUS_SPEED_KMH, DWELL_SEC, recentSpeedMps, type RouteStop } from './eta';
import { indexLines, matchTripAtStop, nextStopIds, pickPattern, toVehicleRoute } from '../../worker/providers/tml/map';
import type { RawArrival, RawLine, RawPattern, RawShape, RawVehicle } from '../../worker/providers/tml/raw';
import linesJson from '../../fixtures/lines.json';
import vehiclesJson from '../../fixtures/vehicles.json';
import patternJson from '../../fixtures/pattern.3715_0_1.json';
import shapeJson from '../../fixtures/shape._2QDAD_3715_0_1.json';
import arrivals060035 from '../../fixtures/arrivals.by_stop.060035.json';
import meta from '../../fixtures/_meta.json';

// Real setup from fixtures: the captured bus, its route (pattern + official shape) and its stops.
const chosen = meta.chosen_vehicle;
const v = (vehiclesJson as RawVehicle[]).find(x => x.id === chosen.id)!;
const pattern = pickPattern(patternJson as unknown as RawPattern[], '20261025', '20261024');
const route = toVehicleRoute(v, indexLines(linesJson as RawLine[]), pattern, shapeJson as unknown as RawShape);
const nowSec = Math.floor(Date.parse(meta.captured_at) / 1000);

// Stop names/coordinates from the GTFS extract (its stop_ids are renumbered; legacy_ids holds the API id).
const gtfs = fs.readFileSync(path.resolve(__dirname, '../../fixtures/gtfs/stops.sample.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const head = gtfs[0]!.split(',');
const col = (n: string) => head.indexOf(n);
const stopById = new Map<string, RouteStop>();
for (const line of gtfs.slice(1)) {
  const c = line.split(',');
  const apiId = c[col('legacy_ids')]!.split('|')[0]!;
  stopById.set(apiId, { id: apiId, name: c[col('stop_name')]!, lat: Number(c[col('stop_lat')]), lng: Number(c[col('stop_lon')]) });
}
const remaining = route.stopIds.slice(route.stopIds.indexOf(route.nextStopId!)).map(id => stopById.get(id)!);
const liveRow = matchTripAtStop(arrivals060035 as RawArrival[], chosen.trip_id, '060035')!;

describe('server: next stops and exact trip match (fixtures)', () => {
  it('starts at the stop the bus is heading to', () => {
    expect(nextStopIds(route.stopIds, route.nextStopId, 10)).toEqual(route.stopIds.slice(1, 11));
  });
  it('finds this trip at 060035 by trip_id, with a live estimate', () => {
    expect(liveRow).toEqual({ stopId: '060035', scheduledAt: 1792936080, estimatedAt: 1792935728 });
  });
  it('returns null for a trip that is not in the stop list', () => {
    expect(matchTripAtStop(arrivals060035 as RawArrival[], '[XXXXX]nope', '060035')).toBeNull();
  });
});

describe('buildStopEtas', () => {
  it('gives every remaining stop exactly one state and a time', () => {
    const etas = buildStopEtas({ stops: remaining, path: route.path, vehicle: { lat: v.lat, lng: v.lon }, nowSec, speedMps: null, times: [liveRow] });
    expect(etas).toHaveLength(30);
    expect(etas[0]).toMatchObject({ id: '060035', state: 'live', atSec: 1792935728 });
    expect(etas.slice(1).every(e => e.state === 'estimated')).toBe(true);
    const t = etas.map(e => e.atSec);
    expect(t).toEqual([...t].sort((a, b) => a - b)); // never goes backwards
  });

  it('chains estimates from the last known stop time, with route distance, speed and dwell', () => {
    const etas = buildStopEtas({ stops: remaining, path: route.path, vehicle: { lat: v.lat, lng: v.lon }, nowSec, speedMps: null, times: [liveRow] });
    const cum = cumulative(route.path);
    // Gap between stop 1 and 2 = their route distance at 20 km/h, plus one dwell.
    const gap = etas[1]!.atSec - etas[0]!.atSec;
    expect(gap).toBeGreaterThanOrEqual(DWELL_SEC);
    expect(gap).toBeLessThan(cum[cum.length - 1]! / (DEFAULT_BUS_SPEED_KMH / 3.6));
  });

  it('uses a scheduled-only row as Scheduled, never as Live', () => {
    const sched = { stopId: remaining[3]!.id, scheduledAt: nowSec + 900, estimatedAt: null };
    const etas = buildStopEtas({ stops: remaining, path: route.path, vehicle: { lat: v.lat, lng: v.lon }, nowSec, speedMps: null, times: [liveRow, sched] });
    expect(etas[3]).toMatchObject({ state: 'scheduled', atSec: nowSec + 900 });
    expect(etas[4]!.state).toBe('estimated');
    expect(etas[4]!.atSec).toBeGreaterThan(nowSec + 900); // estimated from the scheduled anchor
  });

  it('estimates from the bus position when no stop has a row', () => {
    const etas = buildStopEtas({ stops: remaining, path: route.path, vehicle: { lat: v.lat, lng: v.lon }, nowSec, speedMps: 10, times: [] });
    expect(etas.every(e => e.state === 'estimated')).toBe(true);
    expect(etas[0]!.atSec).toBeGreaterThanOrEqual(nowSec);
  });

  it('falls back to straight-line distance when there is no route geometry', () => {
    const etas = buildStopEtas({ stops: remaining, path: [], vehicle: { lat: v.lat, lng: v.lon }, nowSec, speedMps: null, times: [] });
    expect(etas).toHaveLength(30);
    expect(etas[29]!.atSec).toBeGreaterThan(etas[0]!.atSec);
  });
});

describe('recentSpeedMps', () => {
  const p = route.path;
  const cum = cumulative(p);
  it('measures speed along the route between fixes, clamped to 8–80 km/h', () => {
    const a = { lat: p[0]![0], lng: p[0]![1], t: 0 };
    const b = { lat: p[60]![0], lng: p[60]![1], t: 60_000 };
    const expected = Math.min(80, Math.max(8, (cum[60]! / 60) * 3.6)) / 3.6;
    expect(recentSpeedMps([a, b], p, cum)).toBeCloseTo(expected, 5);
  });
  it('is null with one fix, too little time, or no movement', () => {
    const a = { lat: p[0]![0], lng: p[0]![1], t: 0 };
    expect(recentSpeedMps([a], p)).toBeNull();
    expect(recentSpeedMps([a, { ...a, t: 2_000 }], p)).toBeNull();
    expect(recentSpeedMps([a, { ...a, t: 30_000 }], p)).toBeNull();
  });
});
