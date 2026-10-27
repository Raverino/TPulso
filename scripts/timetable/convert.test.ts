// Converter tests on fixtures/gtfs-tml-sample: real rows from the TML regional feed (2026-10-24 version):
// two Carris Metropolitana trips of one pattern (3715), two Metro trips, a Transtejo ferry trip,
// a city Carris trip running past midnight (until 24:24) and an MTS trip (not running on 2026-10-25).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  areaKey,
  areasAround,
  decodePolyline,
  encodePolyline,
  modeOfRouteType,
  serviceDayStartMs,
} from '../../shared/timetable.ts';
import { convert, countTripsOn, cumulative, mergeNearDuplicates, sliceShape, stopDistances } from './convert.ts';
import { folderSource } from './gtfs.ts';
import { OPERATORS } from './operators.ts';

const src = folderSource(path.resolve(import.meta.dirname, '../../fixtures/gtfs-tml-sample'));
const TODAY = '20261025';
const resP = convert(src, { today: TODAY, days: 14, operators: OPERATORS, version: 'test' });

describe('operators: included only when they run today', () => {
  it('includes Carris Metropolitana, Metro, Transtejo and Carris with their trips today', async () => {
    const res = await resP;
    const byId = Object.fromEntries(res.operators.map(o => [o.id, o]));
    expect(byId.cm).toMatchObject({ tripsToday: 2, modes: ['bus'] });
    expect(byId.metro).toMatchObject({ tripsToday: 2, modes: ['tram'] });
    expect(byId.ttsl).toMatchObject({ tripsToday: 1, modes: ['ferry'] });
    expect(byId.carris).toMatchObject({ tripsToday: 1, modes: ['tram'] }); // route 76_0 is tram 15E
    for (const o of res.operators) expect(o.dateTo >= TODAY).toBe(true);
  });
  it('excludes MTS (no trips today) and operators missing from the sample, with a reason', async () => {
    const res = await resP;
    const mts = res.excluded.find(e => e.id === 'mts')!;
    expect(mts.reason).toMatch(/^no trips on 20261025/);
    expect(res.excluded.find(e => e.id === 'cp')?.reason).toBe('not in the feed');
    for (const r of res.routes.values()) expect(r.op).not.toBe('mts');
  });
  it('excludes an operator whose dates ended before the build day', async () => {
    const later = await convert(src, { today: '20300201', days: 14, operators: OPERATORS, version: 'x' });
    expect(later.operators).toEqual([]);
    expect(later.excluded.find(e => e.id === 'metro')?.reason).toMatch(/^expired on 2026/);
  });
});

describe('patterns and trips', () => {
  it('groups the two 3715 trips into one pattern with their real start times', async () => {
    const res = await resP;
    const p = [...res.routes.values()].find(r => r.line === '3715')!;
    // First departures in stop_times are 08:45 and 09:45 (the trip ids' "0830"/"0930" are labels, not times).
    expect(p.trips.map(t => t[0]).sort((a, b) => a - b)).toEqual([8 * 3600 + 45 * 60, 9 * 3600 + 45 * 60]);
    expect(p.headsign).toBeTruthy();
    // Both trips run today (bit 0) and the profile starts at 0.
    for (const t of p.trips) expect(t[2] & 1).toBe(1);
    expect(p.profiles[0]![1]).toBe(0);
  });
  it('keeps times after midnight as GTFS seconds (> 24 h) on the previous service day', async () => {
    const res = await resP;
    const night = [...res.routes.values()].find(r => r.op === 'carris')!;
    const [start, pi] = night.trips[0]!;
    const prof = night.profiles[pi]!;
    const lastArrival = start + prof[prof.length - 2]!;
    expect(lastArrival).toBe(24 * 3600 + 24 * 60); // 24:24:00
    expect(night.trips[0]![2] & 1).toBe(1); // belongs to service day 2026-10-25
  });
  it('merges exact duplicate trips (as the regional feed has for TCB), combining their days', async () => {
    // Feed the sample twice for trips.txt/stop_times.txt with a second "plan" prefix on the trip ids,
    // the way the regional feed lists TCB under two overlapping plans.
    const twice: typeof src = async function* (file) {
      for await (const r of src(file)) yield r;
      if (file === 'trips.txt' || file === 'stop_times.txt') for await (const r of src(file)) yield { ...r, trip_id: `[PLAN2]${r.trip_id}` };
    };
    const res = await convert(twice, { today: TODAY, days: 14, operators: OPERATORS, version: 't' });
    expect(res.stats.duplicateTrips).toBe(res.stats.tripsInWindow);
    expect(res.operators.find(o => o.id === 'cm')?.tripsToday).toBe(2);
  });
  it('maps route types to filter modes', () => {
    expect([0, 1, 2, 3, 4, 109, 1200].map(modeOfRouteType)).toEqual(['tram', 'tram', 'train', 'bus', 'ferry', 'train', 'ferry']);
  });
});

describe('geometry', () => {
  it('places stops along the shape in travel order', async () => {
    const res = await resP;
    for (const r of res.routes.values()) {
      expect(r.dist).toHaveLength(r.stops.length);
      for (let i = 1; i < r.dist.length; i++) expect(r.dist[i]!).toBeGreaterThanOrEqual(r.dist[i - 1]!);
      expect(r.dist[0]).toBe(0);
      // The encoded shape is about as long as the distance from first to last stop.
      const pts = decodePolyline(r.shape);
      const len = cumulative(pts).at(-1)!;
      expect(Math.abs(len - r.dist.at(-1)!)).toBeLessThan(Math.max(30, len * 0.02));
    }
  });
  it('slices a shape between two distances with interpolated ends', () => {
    const shape: [number, number][] = [[38.7, -9.1], [38.701, -9.1], [38.702, -9.1]];
    const cum = cumulative(shape);
    const s = sliceShape(shape, cum, cum[1]! / 2, cum[2]!);
    expect(s[0]![0]).toBeCloseTo(38.7005, 5);
    expect(s.at(-1)).toEqual([38.702, -9.1]);
  });
  it('keeps order on a route that passes the same place twice', () => {
    const shape: [number, number][] = [[38.7, -9.1], [38.71, -9.1], [38.7, -9.1]]; // out and back
    const cum = cumulative(shape);
    const d = stopDistances(shape, cum, [[38.7, -9.1], [38.71, -9.1], [38.7, -9.1]]);
    expect(d[0]).toBe(0);
    expect(d[2]).toBeGreaterThan(d[1]!);
  });
  it('keeps the drawn line within 2.5 m of every raw shape point (curves are not cut)', async () => {
    const res = await resP;
    const route = [...res.routes.values()].find(r => r.line === '3715')!;
    const raw: [number, number, number][] = [];
    for await (const r of src('shapes.txt')) if (r.shape_id === '[PL3CL][YA15B]3715_0_1') raw.push([+r.shape_pt_sequence!, +r.shape_pt_lat!, +r.shape_pt_lon!]);
    raw.sort((a, b) => a[0] - b[0]);
    const line = decodePolyline(route.shape);
    const k = Math.cos((38.7 * Math.PI) / 180);
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const ax = a[1] * k * 111_320, ay = a[0] * 111_320, bx = b[1] * k * 111_320, by = b[0] * 111_320, px = p[1] * k * 111_320, py = p[0] * 111_320;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      return Math.hypot(ax + dx * t - px, ay + dy * t - py);
    };
    // Only points between the first and last stop (the drawn line runs first stop -> terminus).
    const first = route.stopInfo[0]!, last = route.stopInfo.at(-1)!;
    const near = (p: [number, number], s: readonly [string, string, number, number]) => Math.hypot((p[0] - s[2]) * 111_320, (p[1] - s[3]) * 111_320 * k);
    const i0 = raw.findIndex(p => near([p[1], p[2]], first) < 40);
    let i1 = raw.length - 1;
    while (i1 > 0 && near([raw[i1]![1], raw[i1]![2]], last) > 40) i1--;
    let worst = 0;
    let worstAt: [number, number] = [0, 0];
    for (const [, la, lg] of raw.slice(Math.max(0, i0), i1 + 1)) {
      // The line starts and ends exactly at the stops; raw points just before/after them are not part of it.
      if (near([la, lg], first) < 30 || near([la, lg], last) < 30) continue;
      let best = Infinity;
      for (let i = 0; i < line.length - 1; i++) best = Math.min(best, segDist([la, lg], line[i]!, line[i + 1]!));
      if (best > worst) { worst = best; worstAt = [la, lg]; }
    }
    expect(worst, `at ${worstAt}`).toBeLessThan(2.5);
  });
  it('writes region-wide line shapes for tram, metro, train and ferry only, first stop to terminus', async () => {
    const res = await resP;
    expect(res.lines.length).toBeGreaterThan(0);
    for (const l of res.lines) expect(l.mode).not.toBe('bus');
    expect(new Set(res.lines.map(l => l.mode))).toEqual(new Set(['tram', 'ferry']));
    for (const l of res.lines) expect(l.shape).toBe(res.routes.get(l.id)!.shape);
  });
  it('round-trips polylines', () => {
    const pts: [number, number][] = [[38.72588, -9.15132], [38.7259, -9.1514]];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
});

describe('area files', () => {
  it('put each stop in its area and include one neighbour stop on each side of a slice', async () => {
    const res = await resP;
    const route = [...res.routes.values()].find(r => r.line === '3715')!;
    for (const [k, a] of res.areas) {
      for (const s of a.stops) expect(areaKey(s[2], s[3])).toBe(k);
      for (const p of a.patterns) {
        expect(p.stops.length).toBe(p.dist.length);
        expect(p.profiles[0]!.length).toBe(p.stops.length * 2);
        expect(p.dist[0]).toBe(0);
      }
    }
    // Every stop of the 3715 route appears in some area.
    const inAreas = new Set([...res.areas.values()].flatMap(a => a.stops.map(s => s[0])));
    for (const s of route.stops) expect(inAreas.has(s)).toBe(true);
  });
  it('finds the areas around a point', () => {
    const keys = areasAround(38.725878, -9.151315, 1000);
    expect(keys).toContain(areaKey(38.725878, -9.151315));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.length).toBeLessThanOrEqual(9);
  });
});

describe('service days', () => {
  it('counts trips running on a date in a GTFS feed (cross-check helper)', async () => {
    expect(await countTripsOn(src, TODAY)).toBe(6); // 2 CM + 2 Metro + ferry + night Carris (MTS not today)
  });
  it('starts a service day at noon minus 12 h, which differs from midnight on the DST change day', () => {
    // 2026-10-25: clocks go back at 02:00 in Lisbon. Noon is 12:00 UTC, so the day starts at 00:00 UTC,
    // while local midnight was 23:00 UTC the evening before.
    expect(new Date(serviceDayStartMs('20261025', 'Europe/Lisbon')).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(new Date(serviceDayStartMs('20261026', 'Europe/Lisbon')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(new Date(serviceDayStartMs('20260701', 'Europe/Lisbon')).toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });
  it('adds days across month ends', () => {
    expect(addDays('20261031', 1)).toBe('20261101');
  });
});

describe('near-duplicate trips (Carris 734 in the evening: the same bus listed twice)', () => {
  // Two profiles of one 4-stop pattern: [arrival, departure] offsets; the second runs up to 2 min later.
  const profiles = [
    [0, 0, 300, 300, 600, 600, 900, 900],
    [0, 0, 300, 360, 660, 660, 1020, 1020],
  ];
  const WEEKDAYS = 0b1111100111110;
  it('merges a trip listed twice with every stop time within 2 minutes (same start, real 734 days)', () => {
    const r = mergeNearDuplicates([[73500, 0, WEEKDAYS], [73500, 1, WEEKDAYS]], profiles);
    expect(r.merged).toBe(1);
    expect(r.kept).toEqual([[73500, 0, WEEKDAYS]]);
  });
  it('keeps trips 3 minutes apart, and trips on different days', () => {
    expect(mergeNearDuplicates([[73500, 0, WEEKDAYS], [73680, 0, WEEKDAYS]], profiles).merged).toBe(0);
    expect(mergeNearDuplicates([[73500, 0, 0b0001], [73500, 1, 0b0010]], profiles).merged).toBe(0);
  });
  it('keeps the later listing for the days the first does not run', () => {
    const r = mergeNearDuplicates([[73500, 0, 0b0011], [73560, 0, 0b0110]], profiles);
    expect(r.merged).toBe(1);
    expect(r.kept).toEqual([[73500, 0, 0b0011], [73560, 0, 0b0100]]);
  });
  it('does not merge when one stop is more than 2 minutes off', () => {
    const late = [[0, 0, 300, 300, 600, 600, 900, 900], [0, 0, 300, 300, 600, 600, 1030, 1030]];
    expect(mergeNearDuplicates([[73500, 0, WEEKDAYS], [73500, 1, WEEKDAYS]], late).merged).toBe(0);
  });
});
