import { describe, expect, it } from 'vitest';
import { encodePolyline, serviceDayStartMs, type PatternData } from '../../shared/timetable';
import { linkTrip, liveOperators, liveState, liveVehicle, projectOnPattern, sliceFor, type LiveBus } from './live';

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
    expect(v.lat).toBeCloseTo(38.7 + 600 * M, 9); // the GPS position itself, not moved onto the line
    expect(v.live).toEqual({ state: 'live', fixAt: expect.any(Number), busId: '[LA77N]1231' });
  });
  it('counts a bus within 20 m of a stop as at that stop', () => {
    const link = { key: '7:0:20261030', tripIndex: 0, serviceDate: '20261030' };
    const v = liveVehicle(bus(38.7 + 510 * M), pattern, link, 'stale');
    expect(v).toMatchObject({ atStop: true, nextStopIndex: 1, segment: { from: 1, to: 1, f: 0 }, live: { state: 'stale' } });
  });
  it('picks the loaded slice the bus is on', () => {
    const other = { ...pattern, shape: encodePolyline([[38.7, LNG + 0.01], [38.71, LNG + 0.01]]) };
    expect(sliceFor([other, pattern], 38.7 + 300 * M, LNG)).toBe(pattern);
  });
});
