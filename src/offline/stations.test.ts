import { describe, expect, it } from 'vitest';
import type { TransportMode } from '../../shared/types';
import nearStops from '../../fixtures/stops.near-test-1500m.json';
import { encodePolyline, type AreaFile, type PatternData } from '../../shared/timetable';
import { clusterScreen, groupStations, normaliseName, spreadOffsets, stationSize, stopDirections, letterOrder, letterFor, shortLabel, type StationStop, type StopDirection, type StopKind } from './stations';

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
  it('makes one place of the real Marquês de Pombal stops of one mode within 40 m, with one name', () => {
    const stations = groupStations(stops);
    const mp = stations.find(s => s.stopIds.includes('060033'))!;
    for (const id of ['060123', '060143', '060149', '060405', '060462']) expect(mp.stopIds).toContain(id);
    expect(mp.kind).toBe('station'); // no directions known: never split
    expect(mp.towards).toBeNull();
    // The name is one of the real stop names (never an id, never invented), without platform codes.
    expect(stops.some(s => s.name.startsWith(mp.name))).toBe(true);
    expect(mp.name).not.toMatch(/ P\d$/);
  });

  it('names a place after its most common stop name; a tie goes to the shortest', () => {
    const [p] = groupStations([
      at('a', 'Marquês Pombal', 38.72, -9.145),
      at('b', 'Mq. Pombal - Av. Fontes P. Melo', 38.72, -9.145 + east(20)),
      at('c', 'Marquês Pombal', 38.72, -9.145 + east(35)),
    ]);
    expect(p!.name).toBe('Marquês Pombal');
    const [q] = groupStations([at('a', 'Rato (Largo)', 38.72, -9.15), at('b', 'Rato', 38.72, -9.15 + east(10))]);
    expect(q!.name).toBe('Rato');
  });

  it('splits a place with opposite directions into two platforms with the same name, each other\'s other side', () => {
    const st = groupStations([
      at('a', 'Av. da Liberdade', 38.72, -9.145, dir('bus', 0, { 'Cais do Sodré': 9, Rossio: 2 })),
      at('b', 'Av. Liberdade', 38.72, -9.145 + east(25), dir('bus', 180, { Odivelas: 7 })),
      at('c', 'Av. da Liberdade', 38.72, -9.145 + east(5), dir('bus', 10, { Rossio: 1 })),
    ]);
    expect(st).toHaveLength(2);
    expect(new Set(st.map(s => s.name))).toEqual(new Set(['Av. da Liberdade']));
    const sa = st.find(s => s.stopIds.includes('a'))!, sb = st.find(s => s.stopIds.includes('b'))!;
    expect(sa.stopIds).toEqual(['a', 'c']);
    expect(sa).toMatchObject({ kind: 'platform', towards: 'Cais do Sodré' });
    expect(sa.otherSide).toEqual({ id: 'b', towards: 'Odivelas' });
    expect(sb.otherSide).toEqual({ id: 'a', towards: 'Cais do Sodré' });
  });

  it('keeps a place with one direction as one marker without a direction', () => {
    const st = groupStations([
      at('a', 'Rato', 38.72, -9.15, dir('bus', 90, { Belém: 3 })),
      at('b', 'Rato', 38.72, -9.15 + east(30), dir('bus', 100, { Algés: 4 })),
    ]);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'station', heading: null, towards: null, otherSide: null, stopIds: ['a', 'b'] });
  });

  it('merges metro, train and ferry stops of one mode within 40 m into one station, never split', () => {
    const st = groupStations([
      at('m1', 'Marquês de Pombal (Metro) P1', 38.7259, -9.1503, dir('metro', 10), ['tram']),
      at('m2', 'Marquês de Pombal', 38.7259, -9.1503 + east(30), dir('metro', 190), ['tram']),
    ]);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'station', heading: null, stopIds: ['m1', 'm2'] });
  });

  it('never merges across modes, even with the same name and 10 m apart', () => {
    const st = groupStations([
      at('b', 'Marquês Pombal', 38.7259, -9.1503, dir('bus', 0)),
      at('m', 'Marquês de Pombal (Metro)', 38.7259, -9.1503 + east(10), dir('metro', null), ['tram']),
    ]);
    expect(st).toHaveLength(2);
  });
});

describe('letters of an expanded area point', () => {
  it('orders by name so same-named platforms get adjacent letters, then by direction', () => {
    const order = letterOrder([
      { id: '3', name: 'Rato', heading: 180 },
      { id: '1', name: 'Marquês Pombal', heading: 270 },
      { id: '2', name: 'Rato', heading: 0 },
      { id: '4', name: 'Amoreiras', heading: null },
    ]);
    expect(order.map(s => s.id)).toEqual(['4', '1', '2', '3']);
  });
  it('gives A, B, … Z, then AA', () => {
    expect([0, 1, 25, 26, 27].map(letterFor)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('shortLabel', () => {
  it('keeps short names and cuts long ones to 22 characters with an ellipsis', () => {
    expect(shortLabel('Marquês Pombal')).toBe('Marquês Pombal');
    const s = shortLabel('Mq. Pombal - R. Joaquim António Aguiar');
    expect(s.length).toBeLessThanOrEqual(22);
    expect(s.endsWith('…')).toBe(true);
    expect(s.startsWith('Mq. Pombal - R.')).toBe(true);
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
