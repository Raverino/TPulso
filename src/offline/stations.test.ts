import { describe, expect, it } from 'vitest';
import type { TransportMode } from '../../shared/types';
import nearStops from '../../fixtures/stops.near-test-1500m.json';
import { clusterScreen, groupStations, normaliseName, spreadOffsets, stationSize, type StationStop } from './stations';

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

describe('clusterScreen (area points)', () => {
  const pts = [
    { id: 'a', x: 0, y: 0, weight: 5 },
    { id: 'b', x: 30, y: 0, weight: 1 },
    { id: 'c', x: 0, y: 40, weight: 2 },
    { id: 'd', x: 200, y: 200, weight: 9 },
    { id: 'e', x: 230, y: 230, weight: 0 },
  ];
  it('groups stations closer than 45 px around the busiest one, and keeps far ones apart', () => {
    const cl = clusterScreen(pts);
    expect(cl.map(c => c.members)).toEqual([['d', 'e'], ['a', 'b', 'c']]);
  });
  it('is deterministic (same result whatever the input order)', () => {
    expect(clusterScreen([...pts].reverse())).toEqual(clusterScreen(pts));
  });
  it('adapts to the zoom: the same stations spread out further apart form separate points', () => {
    const zoomedIn = pts.map(p => ({ ...p, x: p.x * 3, y: p.y * 3 }));
    expect(clusterScreen(zoomedIn)).toHaveLength(5);
  });
});

describe('spreadOffsets', () => {
  it('places markers on a circle far enough apart to tap', () => {
    const o = spreadOffsets(6);
    expect(o).toHaveLength(6);
    expect(o[0]).toEqual({ dx: 0, dy: -38 });
    for (let i = 1; i < o.length; i++) expect(Math.hypot(o[i]!.dx - o[i - 1]!.dx, o[i]!.dy - o[i - 1]!.dy)).toBeGreaterThan(30);
  });
});
