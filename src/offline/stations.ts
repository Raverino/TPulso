// Stops on the map (docs/OFFLINE.md). The individual stop IDs are kept (for departures and vehicle filtering)
// and never shown.
// - Bus and tram stops become *platforms*: one stop, or stops on the same side of the street (within 15 m, same
//   main direction of travel). Opposite directions are never merged; each platform knows its "other side".
// - Metro, train and ferry stops of the same mode within 40 m become one *station* (all its platforms merged).
// Stops are never merged by name alone, and never across modes.
import { distanceMeters } from '../../shared/geo';
import type { AreaFile } from '../../shared/timetable';
import type { TransportMode } from '../../shared/types';
import { pointAlong } from './engine';

/** What a stop is served by, for grouping: bus/tram stops are split by direction, the others merged. */
export type StopKind = 'bus' | 'tram' | 'metro' | 'train' | 'ferry';
const DIRECTIONAL: ReadonlySet<StopKind> = new Set(['bus', 'tram']);

/** Direction of travel at a stop, from the trips that serve it (see stopDirections). */
export interface StopDirection {
  kind: StopKind;
  /** Sum of unit vectors of the heading just after the stop (x = east, y = north), weighted by trips. */
  x: number;
  y: number;
  /** Number of trips counted. */
  weight: number;
  /** Trips per destination (headsign) leaving this stop (trips ending here are not counted). */
  dests: ReadonlyMap<string, number>;
}

export interface StationStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  modes: ReadonlySet<TransportMode>;
  /** From stopDirections; without it a stop counts as a bus stop with no known direction. */
  dir?: StopDirection | undefined;
}

export interface Station {
  /** Smallest member stop id (stable, internal only). */
  id: string;
  name: string;
  /** Normalised name (area points count stations by name). */
  nameKey: string;
  lat: number;
  lng: number;
  stopIds: string[];
  /** Modes serving any member stop, in a fixed order (bus, tram, train, ferry). */
  modes: TransportMode[];
  /** A bus/tram platform (one direction) or a merged metro/train/ferry station. */
  kind: 'platform' | 'station';
  /** Platforms: main direction of travel, degrees clockwise from north (null if unknown). */
  heading: number | null;
  /** Platforms: the destination most trips leaving here go to. */
  towards: string | null;
  /** Platforms: the platform on the other side of the street (opposite direction), if any. */
  otherSide: { id: string; towards: string | null } | null;
}

export const PLATFORM_MERGE_M = 15;
export const STATION_MERGE_M = 40;
/** Same side: main directions less than this apart. Other side: at least OPPOSITE_DEG apart. */
const SAME_DIRECTION_DEG = 60;
const OPPOSITE_DEG = 120;
/** An "other side" platform with the same name may be this far away (else STATION_MERGE_M). */
const OTHER_SIDE_SAME_NAME_M = 80;
const MODE_ORDER: TransportMode[] = ['bus', 'tram', 'train', 'ferry'];
const FILLER = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * "Marquês de Pombal (Metro) P1" -> "marques pombal": no accents or case, bracketed notes and platform
 * codes (P1, P 2, Cais 3) dropped, filler words removed, punctuation collapsed.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(p|cais|plataforma)\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !FILLER.has(w))
    .join(' ');
}

/** Station name for display: a platform code (" P1", " Cais 2") belongs to one stop, not the station. */
export function displayName(name: string): string {
  return name.replace(/\s+(P|Cais|Plataforma)\s*\d+\s*$/i, '').trim();
}

/**
 * Direction of travel and destinations at every stop of the loaded areas, from the patterns serving it:
 * the shape's heading just after the stop (just before it for a last stop), weighted by the number of trips.
 * `metroOperators` (region config) marks metro lines, which share the tram mode but are merged like trains.
 */
export function stopDirections(areas: readonly AreaFile[], metroOperators: readonly string[]): Map<string, StopDirection> {
  const acc = new Map<string, { kinds: Set<StopKind>; x: number; y: number; weight: number; dests: Map<string, number> }>();
  const seen = new Set<string>(); // a pattern appears in every area it crosses: count each (pattern, stop) once
  const metro = new Set(metroOperators);
  for (const a of areas) {
    for (const p of a.patterns) {
      const kind: StopKind = p.mode === 'tram' && metro.has(p.op) ? 'metro' : p.mode;
      const w = p.trips.length;
      const n = p.stops.length;
      for (let i = 0; i < n; i++) {
        const id = p.stops[i]!;
        const k = `${p.id}|${p.first + i}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const d = p.dist[i]!;
        const last = p.first + i === p.total - 1;
        const step = i < n - 1 ? Math.min(15, (p.dist[i + 1]! - d) / 2) : i > 0 ? -Math.min(15, (d - p.dist[i - 1]!) / 2) : 0;
        let e = acc.get(id);
        if (!e) acc.set(id, (e = { kinds: new Set(), x: 0, y: 0, weight: 0, dests: new Map() }));
        e.kinds.add(kind);
        if (step !== 0) {
          const h = (pointAlong(p, d + step).bearing * Math.PI) / 180;
          e.x += Math.sin(h) * w;
          e.y += Math.cos(h) * w;
          e.weight += w;
        }
        if (!last && p.headsign) e.dests.set(p.headsign, (e.dests.get(p.headsign) ?? 0) + w);
      }
    }
  }
  const out = new Map<string, StopDirection>();
  for (const [id, e] of acc) {
    // One kind per stop: the merged kinds win (a metro stop stays a metro stop), then tram over bus.
    const kind = (['metro', 'train', 'ferry', 'tram', 'bus'] as const).find(k => e.kinds.has(k))!;
    out.set(id, { kind, x: e.x, y: e.y, weight: e.weight, dests: e.dests });
  }
  return out;
}

const headingOf = (x: number, y: number, weight: number): number | null =>
  weight > 0 && Math.hypot(x, y) >= 0.2 * weight ? (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360 : null;
const angleBetween = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

function unionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  return { find, join: (a: number, b: number) => void (parent[find(a)] = find(b)) };
}

function mostCommon(counts: Map<string, number>): string | null {
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0]))[0];
  return best ? best[0] : null;
}

export function groupStations(stops: readonly StationStop[]): Station[] {
  const kindOf = (s: StationStop): StopKind => s.dir?.kind ?? 'bus';
  const headingOfStop = (s: StationStop) => (s.dir ? headingOf(s.dir.x, s.dir.y, s.dir.weight) : null);
  const uf = unionFind(stops.length);
  // Pairs only within the same kind; a grid of ~50 m cells keeps this from comparing every pair.
  const cell = (s: StationStop) => `${Math.floor(s.lat / 0.00045)}|${Math.floor(s.lng / 0.00057)}`;
  const grid = new Map<string, number[]>();
  stops.forEach((s, i) => {
    const k = cell(s);
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  });
  const neighbours = (s: StationStop): number[] => {
    const ci = Math.floor(s.lat / 0.00045), cj = Math.floor(s.lng / 0.00057);
    const out: number[] = [];
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) out.push(...(grid.get(`${ci + di}|${cj + dj}`) ?? []));
    return out;
  };
  stops.forEach((a, i) => {
    const ka = kindOf(a);
    const ha = headingOfStop(a);
    for (const j of neighbours(a)) {
      if (j <= i) continue;
      const b = stops[j]!;
      if (kindOf(b) !== ka) continue;
      const d = distanceMeters(a, b);
      if (DIRECTIONAL.has(ka)) {
        // Same platform: same side (≤ 15 m) and the same main direction (unknown direction: distance only).
        const hb = headingOfStop(b);
        if (d <= PLATFORM_MERGE_M && (ha === null || hb === null || angleBetween(ha, hb) < SAME_DIRECTION_DEG)) uf.join(i, j);
      } else if (d <= STATION_MERGE_M) uf.join(i, j); // metro, train, ferry: one station
    }
  });

  const groups = new Map<number, StationStop[]>();
  stops.forEach((s, i) => {
    const r = uf.find(i);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });
  const out: Station[] = [...groups.values()].map(members => {
    // Name: the most common original name; on a tie, the shortest (usually without platform codes).
    const names = new Map<string, number>();
    for (const m of members) names.set(displayName(m.name), (names.get(displayName(m.name)) ?? 0) + 1);
    const name = mostCommon(names)!;
    const modes = new Set<TransportMode>();
    for (const m of members) for (const md of m.modes) modes.add(md);
    const ids = members.map(m => m.id).sort();
    const platform = DIRECTIONAL.has(kindOf(members[0]!));
    let x = 0, y = 0, weight = 0;
    const dests = new Map<string, number>();
    for (const m of members) {
      if (!m.dir) continue;
      x += m.dir.x;
      y += m.dir.y;
      weight += m.dir.weight;
      for (const [h, c] of m.dir.dests) dests.set(h, (dests.get(h) ?? 0) + c);
    }
    return {
      id: ids[0]!,
      name,
      nameKey: normaliseName(name),
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
      stopIds: ids,
      modes: MODE_ORDER.filter(m => modes.has(m)),
      kind: platform ? 'platform' : 'station',
      heading: platform ? headingOf(x, y, weight) : null,
      towards: platform ? mostCommon(dests) : null,
      otherSide: null,
    };
  });

  // Other side: a platform of the same kind heading the opposite way — same name within 80 m, or any name
  // within 40 m; the same name first, then the nearest.
  const stopById = new Map(stops.map(s => [s.id, s]));
  const kindOfStation = new Map(out.map(st => [st.id, kindOf(stopById.get(st.id)!)]));
  const platforms = out.filter(st => st.kind === 'platform' && st.heading !== null);
  // ~100 m cells: candidates are at most 80 m away, so the 3 × 3 cells around a platform hold them all.
  const pcell = (lat: number, lng: number) => [Math.floor(lat / 0.0009), Math.floor(lng / 0.00115)] as const;
  const pgrid = new Map<string, Station[]>();
  for (const p of platforms) {
    const [i, j] = pcell(p.lat, p.lng);
    const k = `${i}|${j}`;
    const a = pgrid.get(k);
    if (a) a.push(p);
    else pgrid.set(k, [p]);
  }
  const candidates: { a: Station; b: Station; score: number }[] = [];
  for (const a of platforms) {
    const [ci, cj] = pcell(a.lat, a.lng);
    const near: Station[] = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) near.push(...(pgrid.get(`${ci + di}|${cj + dj}`) ?? []));
    for (const b of near) {
      if (b === a || kindOfStation.get(b.id) !== kindOfStation.get(a.id)) continue;
      if (angleBetween(a.heading!, b.heading!) < OPPOSITE_DEG) continue;
      const d = distanceMeters(a, b);
      const sameName = a.nameKey === b.nameKey;
      if (d > (sameName ? OTHER_SIDE_SAME_NAME_M : STATION_MERGE_M)) continue;
      candidates.push({ a, b, score: (sameName ? 0 : 1000) + d });
    }
  }
  // Best pairs first, each platform in one pair, so the link works both ways (A ↔ B). A platform left over
  // (e.g. three platforms at a junction) still links one way to its best opposite.
  candidates.sort((x, y) => x.score - y.score || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  const paired = new Set<string>();
  for (const { a, b } of candidates) {
    if (paired.has(a.id) || paired.has(b.id)) continue;
    paired.add(a.id);
    paired.add(b.id);
    a.otherSide = { id: b.id, towards: b.towards };
    b.otherSide = { id: a.id, towards: a.towards };
  }
  for (const { a, b } of candidates) if (!a.otherSide) a.otherSide = { id: b.id, towards: b.towards };
  return out;
}

/** Marker size in px from the number of departures in the next 10 minutes (clamped, so it stays tappable). */
export function stationSize(departures: number, min = 14, max = 30): number {
  if (departures <= 0) return min;
  return Math.round(Math.min(max, min + Math.sqrt(departures) * 3));
}

// ---- Level 2: area points on screen ---------------------------------------------------------------------

/** Station markers closer than this on screen (at the current zoom) are grouped into one area point. */
export const AREA_CLUSTER_PX = 45;

export interface ScreenPoint {
  id: string;
  /** Pixel position at the current zoom (map.project). */
  x: number;
  y: number;
  /** Departures in the next 10 minutes: busier stations seed the groups. */
  weight: number;
}

export interface ScreenCluster {
  /** Member station ids, sorted (stable key for the group). */
  members: string[];
  x: number;
  y: number;
}

/**
 * Deterministic greedy clustering: stations are visited busiest first (ties by id); each unassigned station
 * starts a group and takes every other unassigned station within `px` of it. Same input, same groups.
 */
export function clusterScreen(points: readonly ScreenPoint[], px = AREA_CLUSTER_PX): ScreenCluster[] {
  const order = [...points].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const out: ScreenCluster[] = [];
  for (const seed of order) {
    if (used.has(seed.id)) continue;
    const group = order.filter(p => !used.has(p.id) && Math.hypot(p.x - seed.x, p.y - seed.y) <= px);
    for (const p of group) used.add(p.id);
    out.push({
      members: group.map(p => p.id).sort(),
      x: group.reduce((s, p) => s + p.x, 0) / group.length,
      y: group.reduce((s, p) => s + p.y, 0) / group.length,
    });
  }
  return out;
}

/** Pixel offsets that spread `n` markers on a small circle around an area point (first one at the top). */
export function spreadOffsets(n: number, minRadiusPx = 38, gapPx = 34): { dx: number; dy: number }[] {
  const r = Math.max(minRadiusPx, (n * gapPx) / (2 * Math.PI));
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { dx: Math.round(r * Math.cos(a)), dy: Math.round(r * Math.sin(a)) };
  });
}
