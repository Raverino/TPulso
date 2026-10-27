import { describe, expect, it } from 'vitest';
import type { TransportMode } from '../../shared/types';
import { filterByMode, matchesFilter, stopKindLabel, type FilterMode } from './modeFilter';

// A small mixed fixture: a shared tram + bus stop (like Jardim Amoreiras), a bus-only stop, a metro station
// (tram mode), a train station; vehicles and departures of every mode.
const stations: { name: string; modes: TransportMode[] }[] = [
  { name: 'Jardim Amoreiras', modes: ['bus', 'tram'] },
  { name: 'Rato', modes: ['bus'] },
  { name: 'Marquês de Pombal (metro)', modes: ['tram'] },
  { name: 'Campolide (train)', modes: ['train'] },
];
const departures: { line: string; mode: TransportMode }[] = [
  { line: '24E', mode: 'tram' },
  { line: '713', mode: 'bus' },
  { line: '774', mode: 'bus' },
  { line: 'Az', mode: 'tram' },
  { line: 'Sintra', mode: 'train' },
  { line: 'Cacilhas', mode: 'ferry' },
];
const vehicles = departures.map((d, i) => ({ id: `v${i}`, ...d }));

const shown = (filter: FilterMode) => ({
  stations: stations.filter(s => matchesFilter(s.modes, filter)).map(s => s.name),
  departures: filterByMode(departures, filter).map(d => d.line),
  vehicles: filterByMode(vehicles, filter).length,
});

describe('mode filter: one rule everywhere', () => {
  it('All shows everything', () => {
    expect(shown('all')).toEqual({ stations: stations.map(s => s.name), departures: departures.map(d => d.line), vehicles: 6 });
  });
  it('Tram/Metro: trams and metro only; the shared stop stays, with only its tram departures', () => {
    expect(shown('tram')).toEqual({ stations: ['Jardim Amoreiras', 'Marquês de Pombal (metro)'], departures: ['24E', 'Az'], vehicles: 2 });
  });
  it('Bus: buses only; the shared stop stays, with only its bus departures', () => {
    expect(shown('bus')).toEqual({ stations: ['Jardim Amoreiras', 'Rato'], departures: ['713', '774'], vehicles: 2 });
  });
  it('Train and Ferry', () => {
    expect(shown('train')).toEqual({ stations: ['Campolide (train)'], departures: ['Sintra'], vehicles: 1 });
    expect(shown('ferry')).toEqual({ stations: [], departures: ['Cacilhas'], vehicles: 1 });
  });
  it('accepts a set of modes too', () => {
    expect(matchesFilter(new Set<TransportMode>(['bus', 'tram']), 'tram')).toBe(true);
    expect(matchesFilter(new Set<TransportMode>(['bus']), 'tram')).toBe(false);
  });
});

describe('stop kind label', () => {
  it('names every mode serving the place', () => {
    expect(stopKindLabel(['tram', 'bus'])).toBe('Tram and bus stop');
    expect(stopKindLabel(['bus'])).toBe('Bus stop');
    expect(stopKindLabel(['metro'])).toBe('Metro station');
    expect(stopKindLabel(['train', 'bus'])).toBe('Train and bus station');
    expect(stopKindLabel(['ferry'])).toBe('Ferry pier');
    expect(stopKindLabel(['metro', 'tram', 'bus'])).toBe('Metro, tram and bus station');
  });
});
