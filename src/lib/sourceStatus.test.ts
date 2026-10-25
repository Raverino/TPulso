import { describe, expect, it } from 'vitest';
import type { Departure } from '../../shared/types';
import { agoLabel, countdownLabel, delayInfo, departureSource, vehicleSource } from './sourceStatus';
import { indexLines, toDepartures } from '../../worker/providers/tml/map';
import type { RawArrival, RawLine } from '../../worker/providers/tml/raw';
import linesJson from '../../fixtures/lines.json';
import vehiclesJson from '../../fixtures/vehicles.json';
import arrivals060035 from '../../fixtures/arrivals.by_stop.060035.json';
import meta from '../../fixtures/_meta.json';

const capturedMs = Date.parse(meta.captured_at);
const capturedSec = Math.floor(capturedMs / 1000);
const deps: Departure[] = toDepartures(arrivals060035 as RawArrival[], indexLines(linesJson as RawLine[]), capturedSec);

describe('vehicleSource (fixture vehicles at capture time)', () => {
  it('treats normal fixes as live and old fixes as stale', () => {
    const states = vehiclesJson.map(v => vehicleSource(v, capturedMs));
    expect(states.filter(s => s.state === 'live').length).toBeGreaterThan(300);
    expect(vehicleSource({ timestamp: capturedMs - 121_000 }, capturedMs)).toEqual({ state: 'stale', ageSec: 121 });
    expect(vehicleSource({ timestamp: capturedMs - 30_000 }, capturedMs)).toEqual({ state: 'live', ageSec: 30 });
  });
});

describe('departureSource', () => {
  const rt = deps.find(d => d.estimatedAt !== null)!;
  const sched = deps.find(d => d.estimatedAt === null)!;
  it('is live for real-time rows and scheduled for timetable rows', () => {
    expect(departureSource(rt, 10)).toBe('live');
    expect(departureSource(sched, 10)).toBe('scheduled');
  });
  it('is stale for both once the list is too old', () => {
    expect(departureSource(rt, 120)).toBe('stale');
    expect(departureSource(sched, 120)).toBe('stale');
  });
});

describe('countdownLabel', () => {
  it('shows "3 min" for live and "~3 min" for scheduled', () => {
    expect(countdownLabel(capturedSec + 200, capturedSec, 'live')).toBe('3 min');
    expect(countdownLabel(capturedSec + 200, capturedSec, 'scheduled')).toBe('~3 min');
    expect(countdownLabel(capturedSec + 30, capturedSec, 'live')).toBe('now');
  });
  it('switches to Lisbon clock time from 60 min on', () => {
    // 2026-10-25T13:41:38Z + 2 h = 15:41 UTC = 15:41 Lisbon (WET after 25 Oct)
    expect(countdownLabel(capturedSec + 7200, capturedSec, 'scheduled')).toBe('~15:41');
  });
});

describe('delayInfo', () => {
  it('uses text and an arrow, from the fixture departure of the captured vehicle', () => {
    const d = deps.find(x => x.tripId === meta.chosen_vehicle.trip_id)!; // 13:42:08 est vs 13:48 sched
    expect(delayInfo(d)).toEqual({ minutes: -6, text: '−6 min', arrow: '▼', spoken: '6 min early' });
  });
  it('reports lateness with ▲', () => {
    expect(delayInfo({ scheduledAt: 1000, estimatedAt: 1180 })).toMatchObject({ text: '+3 min', arrow: '▲' });
  });
  it('is null for on-time and scheduled-only rows', () => {
    expect(delayInfo({ scheduledAt: 1000, estimatedAt: 1020 })).toBeNull();
    expect(delayInfo({ scheduledAt: 1000, estimatedAt: null })).toBeNull();
  });
});

describe('agoLabel', () => {
  it('formats seconds, minutes and hours', () => {
    expect(agoLabel(12)).toBe('12 s');
    expect(agoLabel(150)).toBe('2 min');
    expect(agoLabel(7300)).toBe('2 h');
  });
});
