import { describe, expect, it } from 'vitest';
import type { TransportMode } from '../../shared/types';
import nearStops from '../../fixtures/stops.near-test-1500m.json';
import { encodePolyline, type AreaFile, type PatternData } from '../../shared/timetable';
import { clusterScreen, groupStations, normaliseName, spreadOffsets, stationSize, stopDirections, type StationStop, type StopDirection, type StopKind } from './stations';

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

// A direction for a synthetic stop: heading in degrees, trips per destination.
const dir = (kind: StopKind, heading: number | null, dests: Record<string, number> = {}): StopDirection => {
  const w = Object.values(dests).reduce((s, x) => s + x, 0) || 1;
  const h = ((heading ?? 0) * Math.PI) / 180;
  return { kind, x: heading === null ? 0 : Math.sin(h) * w, y: heading === null ? 0 : Math.cos(h) * w, weight: heading === null ? 0 : w, dests: new Map(Object.entries(dests)) };
};
const at = (id: string, name: string, lat: number, lng: number, d?: StopDirection, modes: TransportMode[] = ['bus']): StationStop =>
  ({ id, name, lat, lng, modes: new Set(modes), dir: d });
/** About `m` metres east of 38.72 N, in degrees of longitude. */
const east = (m: number) => m / 86_860;

describe('groupStations', () => {
  it('never merges real stops more than 15 m apart (no directions known: distance only)', () => {
    const stations = groupStations(stops);
    for (const st of stations) expect(st.kind).toBe('platform');
    // The six "Marquês de Pombal (Metro)" bus stops stand around the roundabout: not one marker any more.
    const mp = stations.find(s => s.stopIds.includes('060033'))!;
    expect(mp.stopIds.length).toBeLessThan(6);
  });

  it('keeps the two sides of a street apart and links them as each other\'s "other side"', () => {
    const [a, b] = [
      at('a', 'Av. da Liberdade', 38.72, -9.145, dir('bus', 0, { 'Cais do Sodré': 9, Rossio: 2 })),
      at('b', 'Av. Liberdade', 38.72, -9.145 + east(25), dir('bus', 180, { Odivelas: 7 })),
    ];
    const st = groupStations([a, b]);
    expect(st).toHaveLength(2);
    const sa = st.find(s => s.id === 'a')!, sb = st.find(s => s.id === 'b')!;
    expect(sa.towards).toBe('Cais do Sodré');
    expect(sa.heading).toBeCloseTo(0, 0);
    expect(sa.otherSide).toEqual({ id: 'b', towards: 'Odivelas' });
    expect(sb.otherSide).toEqual({ id: 'a', towards: 'Cais do Sodré' });
  });

  it('pairs "other sides" both ways, best pair first; a third platform links one way', () => {
    const st = groupStations([
      at('a', 'Saldanha', 38.72, -9.145, dir('bus', 0, { Norte: 1 })),
      at('b', 'Saldanha', 38.72, -9.145 + east(25), dir('bus', 180, { Sul: 1 })),
      at('c', 'Av. República', 38.72, -9.145 - east(30), dir('bus', 185, { Sul: 1 })),
    ]);
    const by = (id: string) => st.find(s => s.id === id)!;
    expect(by('a').otherSide?.id).toBe('b');
    expect(by('b').otherSide?.id).toBe('a');
    expect(by('c').otherSide?.id).toBe('a');
  });

  it('merges stops on the same side (within 15 m, same direction) into one platform, not opposite ones', () => {
    const same = groupStations([
      at('a', 'Rato', 38.72, -9.15, dir('bus', 90, { Belém: 3 })),
      at('b', 'Rato', 38.72, -9.15 + east(10), dir('bus', 100, { Belém: 1, Algés: 4 })),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0]!.stopIds).toEqual(['a', 'b']);
    expect(same[0]!.towards).toBe('Algés');
    const opposite = groupStations([
      at('a', 'Rato', 38.72, -9.15, dir('bus', 90)),
      at('b', 'Rato', 38.72, -9.15 + east(10), dir('bus', 270)),
    ]);
    expect(opposite).toHaveLength(2);
  });

  it('merges metro, train and ferry stops of the same mode within 40 m into one station, whatever their names', () => {
    const st = groupStations([
      at('m1', 'Marquês de Pombal (Metro) P1', 38.7259, -9.1503, dir('metro', 10), ['tram']),
      at('m2', 'Marquês Pombal - Linha Azul', 38.7259, -9.1503 + east(30), dir('metro', 190), ['tram']),
    ]);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'station', heading: null, towards: null, otherSide: null, stopIds: ['m1', 'm2'] });
  });

  it('never merges across modes, even with the same name and 10 m apart', () => {
    const st = groupStations([
      at('b', 'Marquês Pombal', 38.7259, -9.1503, dir('bus', 0)),
      at('m', 'Marquês de Pombal (Metro)', 38.7259, -9.1503 + east(10), dir('metro', null), ['tram']),
    ]);
    expect(st).toHaveLength(2);
    expect(st.map(s => s.kind).sort()).toEqual(['platform', 'station']);
  });
});

describe('stopDirections', () => {
  // A line due north through three stops, 100 m apart; 4 trips to "Norte".
  const pts: [number, number][] = [[38.72, -9.15], [38.7209, -9.15], [38.7218, -9.15]];
  const pattern = (op: string, mode: TransportMode): PatternData => ({
    id: 1, line: '1', color: '', textColor: '', mode, op, headsign: 'Norte', first: 0, total: 3,
    stops: ['s1', 's2', 's3'], dist: [0, 100, 200], shape: encodePolyline(pts), profiles: [[0, 0, 60, 60, 120, 120]],
    trips: [[0, 0, 1], [600, 0, 1], [1200, 0, 1], [1800, 0, 1]],
  });
  const area = (p: PatternData): AreaFile => ({ format: 1, version: 'v', area: '0_0', stops: [], patterns: [p] });

  it('gives each stop the heading of the shape after it and its destinations (not at the last stop)', () => {
    const d = stopDirections([area(pattern('carris', 'bus'))], ['metro']);
    const s1 = d.get('s1')!;
    expect(s1.kind).toBe('bus');
    expect(((Math.atan2(s1.x, s1.y) * 180) / Math.PI + 360) % 360).toBeCloseTo(0, 0);
    expect(s1.weight).toBe(4);
    expect(s1.dests.get('Norte')).toBe(4);
    expect(d.get('s3')!.dests.size).toBe(0); // trips end there
  });

  it('marks stops of the metro operators as metro (merged like trains), and counts a pattern once per stop', () => {
    const p = pattern('metro', 'tram');
    const d = stopDirections([area(p), area(p)], ['metro']);
    expect(d.get('s2')!.kind).toBe('metro');
    expect(d.get('s2')!.weight).toBe(4);
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
