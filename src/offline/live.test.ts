import { describe, expect, it } from 'vitest';
import { encodePolyline, serviceDayStartMs, type PatternData } from '../../shared/timetable';
import { linkTrip, liveOperators, liveState, liveVehicle, projectOnPattern, sliceFor, trackAlong, trackUpdate, type LiveBus } from './live';

// A straight route due north: three stops 500 m apart (1° latitude ≈ 111 320 m).
const M = 1 / 111_320;
const LNG = -9.15;
const pattern: PatternData = {
  id: 7,
  line: '1624',
  color: '#ffdd00',
  textColor: '#000000',
  mode: 'bus',
  op: 'cm',
  lineId: '[LA77N]1624',
  headsign: 'Oeiras',
  first: 0,
  total: 3,
  stops: ['100001', '100002', '100003'],
  dist: [0, 500, 1000],
  shape: encodePolyline([[38.7, LNG], [38.7 + 1000 * M, LNG]]),
  profiles: [[0, 0, 120, 140, 300, 300]],
  // Starts 08:00 and 08:30 on day 0 (bit 1); 08:00 also on day 1 (bit 2).
  trips: [[8 * 3600, 0, 0b11], [8 * 3600 + 1800, 0, 0b01]],
};
const manifest = { window: { first: '20261030', days: 3 } };
const day0 = serviceDayStartMs('20261030', 'Europe/Lisbon');
const bus = (lat: number, ageS = 10, now = day0 + 8 * 3600_000 + 60_000): LiveBus => ({
  id: '[LA77N]1231', lat, lng: LNG, bearing: 0, line: '1624', lineColor: null, lineTextColor: null,
  tripId: '[KMMRZ][LA77N]1624_1_1_0800_0829_0_3', lineId: '[LA77N]1624', headsign: null, timestamp: now - ageS * 1000,
});

describe('live state of a GPS fix', () => {
  it('is Live up to 2 min, Stale up to 10 min, then not shown', () => {
    expect(liveState(0, 30_000)).toBe('live');
    expect(liveState(0, 121_000)).toBe('stale');
    expect(liveState(0, 601_000)).toBeNull();
  });
});

describe('which operators come from the live feed', () => {
  it('is the operators owning the agencies of the indexed lines', () => {
    const ops = liveOperators({
      operators: [
        { id: 'cm', agencies: ['LA77N', 'BNA17'] },
        { id: 'carris', agencies: ['IA9T6'] },
      ] as never,
      liveTrips: { dir: 'live', lines: ['[LA77N]1624', '[BNA17]2652'] },
    });
    expect([...ops]).toEqual(['cm']);
  });
  it('is none for a timetable built without the index', () => {
    expect(liveOperators({ operators: [{ id: 'cm', agencies: ['LA77N'] }] as never })).toEqual(new Set());
  });
});

describe('linking a live bus to its timetable trip (trip_id index: pattern + start)', () => {
  it('picks the row with that start, on the service day running now', () => {
    const now = day0 + 8 * 3600_000 + 60_000;
    expect(linkTrip(manifest, pattern, 8 * 3600, now)).toEqual({ key: '7:0:20261030', tripIndex: 0, serviceDate: '20261030' });
    expect(linkTrip(manifest, pattern, 8 * 3600 + 1800, now)).toEqual({ key: '7:1:20261030', tripIndex: 1, serviceDate: '20261030' });
  });
  it('uses the next day when the bus runs that day', () => {
    const day1 = serviceDayStartMs('20261031', 'Europe/Lisbon');
    expect(linkTrip(manifest, pattern, 8 * 3600, day1 + 8 * 3600_000)?.serviceDate).toBe('20261031');
  });
  it('still finds a late bus whose scheduled run has ended', () => {
    const late = day0 + 8 * 3600_000 + 20 * 60_000; // 15 min after the scheduled end
    expect(linkTrip(manifest, pattern, 8 * 3600, late)?.key).toBe('7:0:20261030');
  });
  it('finds no trip for a start the pattern does not have', () => {
    expect(linkTrip(manifest, pattern, 9 * 3600, day0 + 9 * 3600_000)).toBeNull();
  });
});

describe('placing the GPS position on the route', () => {
  it('measures the distance along the line and off it', () => {
    const p = projectOnPattern(pattern, 38.7 + 250 * M, LNG + 0.0001)!;
    expect(p.along).toBeCloseTo(250, 0);
    expect(p.offM).toBeGreaterThan(5);
    expect(p.offM).toBeLessThan(12);
  });
  it('gives the next stop and the share of the segment from where the bus is', () => {
    const link = { key: '7:0:20261030', tripIndex: 0, serviceDate: '20261030' };
    const v = liveVehicle(bus(38.7 + 600 * M), pattern, link, 'live');
    expect(v).toMatchObject({ key: '7:0:20261030', line: '1624', headsign: 'Oeiras', op: 'cm', atStop: false, nextStopIndex: 2 });
    expect(v.segment.from).toBe(1);
    expect(v.segment.f).toBeCloseTo(0.2, 2);
    expect(v.lat).toBeCloseTo(38.7 + 600 * M, 6); // on the line, where the fix is
    expect(v.live).toMatchObject({ state: 'live', fixAt: expect.any(Number), busId: '[LA77N]1231', slice: pattern });
    expect(v.live!.along).toBeCloseTo(600, 0);
  });
  it('counts a bus within 20 m of a stop as at that stop', () => {
    const link = { key: '7:0:20261030', tripIndex: 0, serviceDate: '20261030' };
    const v = liveVehicle(bus(38.7 + 510 * M), pattern, link, 'stale');
    expect(v).toMatchObject({ atStop: true, nextStopIndex: 1, segment: { from: 1, to: 1, f: 0 }, live: { state: 'stale' } });
  });
  it('draws the bus on its line, at the point nearest to the GPS fix', () => {
    const link = { key: '7:0:20261030', tripIndex: 0, serviceDate: '20261030' };
    const b = { ...bus(38.7 + 300 * M), lng: LNG + 0.0001 }; // ~9 m beside the line
    const v = liveVehicle(b, pattern, link, 'live');
    expect(v.lng).toBeCloseTo(LNG, 6);
    expect(v.lat).toBeCloseTo(38.7 + 300 * M, 6);
    expect(v.live!.along).toBeCloseTo(300, 0);
  });
  it('picks the loaded slice the bus is on', () => {
    const other = { ...pattern, shape: encodePolyline([[38.7, LNG + 0.01], [38.71, LNG + 0.01]]) };
    expect(sliceFor([other, pattern], 38.7 + 300 * M, LNG)).toBe(pattern);
  });
});

describe('moving a live bus along its line between fixes', () => {
  it('starts at the first fix', () => {
    const t = trackUpdate(undefined, pattern, 200, 1_000, 0);
    expect(trackAlong(t, 0)).toBe(200);
    expect(trackAlong(t, 99_999)).toBe(200);
  });
  it('travels to the next fix at a steady pace, over the time between the two fixes', () => {
    let t = trackUpdate(undefined, pattern, 200, 1_000, 0);
    t = trackUpdate(t, pattern, 400, 21_000, 5_000); // 20 s between the fixes
    expect(trackAlong(t, 5_000)).toBe(200);
    expect(trackAlong(t, 15_000)).toBeCloseTo(300, 6);
    expect(trackAlong(t, 25_000)).toBe(400);
    expect(trackAlong(t, 60_000)).toBe(400); // waits there for the next fix, never runs past it
  });
  it('carries on from where it is drawn when a new fix comes mid-way', () => {
    let t = trackUpdate(undefined, pattern, 0, 0, 0);
    t = trackUpdate(t, pattern, 200, 20_000, 0);
    t = trackUpdate(t, pattern, 500, 40_000, 10_000); // drawn at 100 m when this fix arrives
    expect(trackAlong(t, 10_000)).toBeCloseTo(100, 6);
    expect(trackAlong(t, 30_000)).toBe(500);
  });
  it('ignores a small step back (GPS noise) and takes a large one at once', () => {
    let t = trackUpdate(undefined, pattern, 300, 0, 0);
    t = trackUpdate(t, pattern, 280, 20_000, 1_000);
    expect(trackAlong(t, 1_000)).toBe(300);
    expect(trackAlong(t, 50_000)).toBe(300);
    t = trackUpdate(t, pattern, 50, 40_000, 2_000);
    expect(trackAlong(t, 2_000)).toBe(50);
  });
  it('keeps the same track while the fix has not changed', () => {
    const t = trackUpdate(undefined, pattern, 300, 0, 0);
    expect(trackUpdate(t, pattern, 300, 0, 5_000)).toBe(t);
  });
  it('limits the glide to 3–30 s', () => {
    let t = trackUpdate(undefined, pattern, 0, 0, 0);
    t = trackUpdate(t, pattern, 100, 500, 0);
    expect(t.dur).toBe(3_000);
    t = trackUpdate(t, pattern, 200, 120_500, 0);
    expect(t.dur).toBe(30_000);
  });
});
