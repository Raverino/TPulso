import { describe, expect, it } from 'vitest';
import { stripNamespace } from './ids';
import type { RawArrival, RawLine, RawVehicle } from './raw';
import linesJson from '../../../fixtures/lines.json';
import vehiclesJson from '../../../fixtures/vehicles.json';
import arrivals060033 from '../../../fixtures/arrivals.by_stop.060033.json';
import arrivals060035 from '../../../fixtures/arrivals.by_stop.060035.json';
import meta from '../../../fixtures/_meta.json';

const lines = linesJson as RawLine[];
const vehicles = vehiclesJson as RawVehicle[];
const arrivals = [...arrivals060033, ...arrivals060035] as RawArrival[];
const lineIds = new Set(lines.map(l => l.id));
const patternIds = new Set(lines.flatMap(l => l.pattern_ids));
const TML_AGENCIES = ['LA77N', 'BNA17', 'YA15B', 'A2L1N'];

describe('stripNamespace', () => {
  it('removes one or more leading [XXXXX] tags', () => {
    expect(stripNamespace('[YA15B]3715')).toBe('3715');
    expect(stripNamespace('[PL3CL][YA15B]3715_0_1')).toBe('3715_0_1');
  });
  it('leaves IDs without a prefix unchanged', () => {
    expect(stripNamespace('3715_0_1')).toBe('3715_0_1');
    expect(stripNamespace('060033')).toBe('060033');
  });
  it('only touches the start of the string', () => {
    expect(stripNamespace('3715[YA15B]')).toBe('3715[YA15B]');
    expect(stripNamespace('Amoreiras (Metro) [P1]')).toBe('Amoreiras (Metro) [P1]');
  });
});

describe('link 1: arrival.line_id -> /lines id (fixtures)', () => {
  it('resolves every TML-agency arrival', () => {
    const tml = arrivals.filter(a => TML_AGENCIES.some(ag => a.line_id.startsWith(`[${ag}]`)));
    expect(tml.length).toBeGreaterThan(100);
    for (const a of tml) expect(lineIds.has(stripNamespace(a.line_id)), a.line_id).toBe(true);
  });
  it('does not resolve city Carris (IA9T6) arrivals, which are out of scope', () => {
    const carris = arrivals.filter(a => a.line_id.startsWith('[IA9T6]'));
    expect(carris.length).toBeGreaterThan(0);
    for (const a of carris) expect(lineIds.has(stripNamespace(a.line_id)), a.line_id).toBe(false);
  });
});

describe('link 2: vehicle.pattern_id -> /patterns id (fixtures)', () => {
  it('resolves the captured vehicle to the captured pattern file', () => {
    expect(stripNamespace(meta.chosen_vehicle.pattern_id)).toBe('3715_0_1');
  });
  it('resolves all vehicles except those whose line is missing from /lines', () => {
    const unresolved = vehicles.filter(v => !patternIds.has(stripNamespace(v.pattern_id)));
    // Known data gap (docs/DATA.md mismatch #4): lines 4606 and 2527 are not in /lines at all.
    for (const v of unresolved) expect(lineIds.has(v.line_id), v.line_id).toBe(false);
    expect(unresolved.length).toBeLessThanOrEqual(2);
  });
});
