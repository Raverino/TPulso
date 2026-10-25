import { describe, expect, it } from 'vitest';
import type { TransportMode } from '../../shared/types';
import nearStops from '../../fixtures/stops.near-test-1500m.json';
import { groupStations, normaliseName, stationSize, type StationStop } from './stations';

// Real stops around Marquês de Pombal (fixture from the TML API).
const bus = new Set<TransportMode>(['bus']);
const stops: StationStop[] = nearStops.map(s => ({ id: s.id, name: s.long_name, lat: s.lat, lng: s.lon, modes: bus }));

describe('normaliseName', () => {
  it('drops accents, case, bracketed notes, platform codes and filler words', () => {
    expect(normaliseName('Marquês de Pombal (Metro) P1')).toBe('marques pombal');
    expect(normaliseName('Marquês Pombal')).toBe('marques pombal');
    expect(normaliseName('MARQUÊS DE POMBAL')).toBe('marques pombal');
    expect(normaliseName('Cais do Sodré (Cais 2)')).toBe('cais sodre');
    expect(normaliseName('R Joaquim António Aguiar')).toBe('r joaquim antonio aguiar');
  });
});

describe('groupStations', () => {
  const stations = groupStations(stops);
  it('merges the six Marquês de Pombal (Metro) platforms into one station, keeping all stop ids', () => {
    const mp = stations.find(s => s.stopIds.includes('060033'))!;
    expect(mp.stopIds).toEqual(['060033', '060123', '060143', '060149', '060405', '060462']);
    expect(mp.name).toBe('Marquês de Pombal (Metro)'); // platform codes belong to a stop, not the station
  });
  it('keeps differently named stops apart, and same-named stops more than 60 m apart', () => {
    expect(stations.find(s => s.stopIds.includes('060035'))!.stopIds).toEqual(['060035']); // R Joaquim António Aguiar
    // "Amoreiras" appears twice in the fixture (060027, 060037): ~200 m apart, so two stations.
    const am = stations.filter(s => s.name === 'Amoreiras');
    expect(am.length).toBe(2);
  });
  it('combines the modes of a multi-mode station in a fixed order', () => {
    const multi = groupStations([
      { id: 'a', name: 'Cais do Sodré', lat: 38.7056, lng: -9.1452, modes: new Set<TransportMode>(['train']) },
      { id: 'b', name: 'Cais do Sodré (Metro)', lat: 38.7058, lng: -9.1455, modes: new Set<TransportMode>(['tram']) },
      { id: 'c', name: 'Cais do Sodré', lat: 38.7059, lng: -9.1450, modes: new Set<TransportMode>(['bus', 'ferry']) },
    ]);
    expect(multi).toHaveLength(1);
    expect(multi[0]!.modes).toEqual(['bus', 'tram', 'train', 'ferry']);
  });
});

describe('stationSize', () => {
  it('grows with departures but stays between the min and max', () => {
    expect(stationSize(0)).toBe(14);
    expect(stationSize(4)).toBeGreaterThan(stationSize(1));
    expect(stationSize(500)).toBe(30);
  });
});
