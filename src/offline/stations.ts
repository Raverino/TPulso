// Stops on the map (docs/OFFLINE.md). The individual stop IDs are kept (for departures and vehicle filtering)
// and never shown.
// - A *place* is the stops of one mode within 40 m of each other (metro, train and ferry: one station). It has
//   one name: the most common stop name in the group (a tie goes to the shortest); other spellings are not shown.
// - A bus/tram place whose stops serve opposite directions is split into one marker per direction (*platforms*),
//   all with the place name; each knows its "other side". A place with one direction stays one marker.
// Stops are never merged across modes.
import { distanceMeters } from '../../shared/geo';
import type { AreaFile } from '../../shared/timetable';
import type { TransportMode } from '../../shared/types';
import { pointAlong } from './engine';

/** What a stop is served by, for grouping: bus/tram places are split by direction, the others never. */
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
  /** The place name (shared by both platforms of a split place). */
  name: string;
  /** Normalised name (area points count stations by name). */
  nameKey: string;
  lat: number;
  lng: number;
  stopIds: string[];
  /** Modes serving any member stop, in a fixed order (bus, tram, train, ferry). */
  modes: TransportMode[];
  /** One direction of a split bus/tram place, or a whole place (one marker). */
  kind: 'platform' | 'station';
  /** Platforms: main direction of travel, degrees clockwise from north. */
  heading: number | null;
  /** Platforms: the destination most trips leaving here go to. */
  towards: string | null;
  /** Platforms: the platform on the other side of the street (opposite direction), if any. */
  otherSide: { id: string; towards: string | null } | null;
}

export const PLACE_MERGE_M = 40;
/** Directions less than this apart are one platform; a place splits only if two are at least OPPOSITE_DEG apart. */
const SAME_DIRECTION_DEG = 60;
const OPPOSITE_DEG = 120;
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
 * `metroOperators` (region config) marks metro lines, which share the tram mode but are grouped like trains.
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

function groupsOf<T>(items: readonly T[], find: (i: number) => number): T[][] {
  const g = new Map<number, T[]>();
  items.forEach((it, i) => {
    const r = find(i);
    const a = g.get(r);
    if (a) a.push(it);
    else g.set(r, [it]);
  });
  return [...g.values()];
}

function mostCommon(counts: Map<string, number>): string | null {
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0]))[0];
  return best ? best[0] : null;
}

export function groupStations(stops: readonly StationStop[]): Station[] {
  const kindOf = (s: StationStop): StopKind => s.dir?.kind ?? 'bus';
  const headingOfStop = (s: StationStop) => (s.dir ? headingOf(s.dir.x, s.dir.y, s.dir.weight) : null);

  // 1. Places: stops of the same kind within 40 m (chained). A grid of ~50 m cells limits the pairs compared.
  const uf = unionFind(stops.length);
  const grid = new Map<string, number[]>();
  const cellOf = (s: StationStop) => [Math.floor(s.lat / 0.00045), Math.floor(s.lng / 0.00057)] as const;
  stops.forEach((s, i) => {
    const [ci, cj] = cellOf(s);
    const k = `${ci}|${cj}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  });
  stops.forEach((a, i) => {
    const [ci, cj] = cellOf(a);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const j of grid.get(`${ci + di}|${cj + dj}`) ?? []) {
          if (j > i && kindOf(stops[j]!) === kindOf(a) && distanceMeters(a, stops[j]!) <= PLACE_MERGE_M) uf.join(i, j);
        }
      }
    }
  });

  const out: Station[] = [];
  for (const place of groupsOf(stops, uf.find)) {
    // 2. One name per place: the most common stop name; a tie goes to the shortest.
    const names = new Map<string, number>();
    for (const m of place) names.set(displayName(m.name), (names.get(displayName(m.name)) ?? 0) + 1);
    const name = mostCommon(names)!;
    const nameKey = normaliseName(name);

    // 3. Bus/tram: one platform per direction (directions < 60° apart join; a stop with no known direction
    //    joins the busiest platform). Split only if two platforms run in opposite directions.
    let parts: StationStop[][] = [place];
    if (DIRECTIONAL.has(kindOf(place[0]!))) {
      const known = place.filter(s => headingOfStop(s) !== null);
      const unknown = place.filter(s => headingOfStop(s) === null);
      const ud = unionFind(known.length);
      known.forEach((a, i) => known.forEach((b, j) => j > i && angleBetween(headingOfStop(a)!, headingOfStop(b)!) < SAME_DIRECTION_DEG && ud.join(i, j)));
      const dirs = groupsOf(known, ud.find);
      const head = (g: StationStop[]) => headingOf(...sumDir(g));
      const opposite = dirs.some((a, i) => dirs.some((b, j) => j > i && angleBetween(head(a)!, head(b)!) >= OPPOSITE_DEG));
      if (opposite) {
        const busiest = dirs.reduce((x, y) => (sumDir(y)[2] > sumDir(x)[2] ? y : x));
        busiest.push(...unknown);
        parts = dirs;
      }
    }

    const split = parts.length > 1;
    const platforms = parts.map((members): Station => {
      const modes = new Set<TransportMode>();
      for (const m of members) for (const md of m.modes) modes.add(md);
      const ids = members.map(m => m.id).sort();
      const dests = new Map<string, number>();
      for (const m of members) for (const [h, c] of m.dir?.dests ?? []) dests.set(h, (dests.get(h) ?? 0) + c);
      return {
        id: ids[0]!,
        name,
        nameKey,
        lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
        lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
        stopIds: ids,
        modes: MODE_ORDER.filter(m => modes.has(m)),
        kind: split ? 'platform' : 'station',
        heading: split ? headingOf(...sumDir(members)) : null,
        towards: split ? mostCommon(dests) : null,
        otherSide: null,
      };
    });
    if (split) linkOtherSides(platforms);
    out.push(...platforms);
  }
  return out;

  function sumDir(g: readonly StationStop[]): [number, number, number] {
    let x = 0, y = 0, w = 0;
    for (const s of g) {
      if (!s.dir) continue;
      x += s.dir.x;
      y += s.dir.y;
      w += s.dir.weight;
    }
    return [x, y, w];
  }
}

/**
 * "Other side" within one place: the most opposite pairs first (then the nearest), each platform in one pair so
 * the link works both ways; a platform left over (e.g. a third direction at a junction) links one way.
 */
function linkOtherSides(platforms: Station[]) {
  const pairs: { a: Station; b: Station; score: number }[] = [];
  for (const a of platforms) {
    for (const b of platforms) {
      if (a === b || a.heading === null || b.heading === null) continue;
      const angle = angleBetween(a.heading, b.heading);
      if (angle < OPPOSITE_DEG) continue;
      pairs.push({ a, b, score: (180 - angle) * 10 + distanceMeters(a, b) });
    }
  }
  pairs.sort((x, y) => x.score - y.score || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  const paired = new Set<string>();
  for (const { a, b } of pairs) {
    if (paired.has(a.id) || paired.has(b.id)) continue;
    paired.add(a.id);
    paired.add(b.id);
    a.otherSide = { id: b.id, towards: b.towards };
    b.otherSide = { id: a.id, towards: a.towards };
  }
  for (const { a, b } of pairs) if (!a.otherSide) a.otherSide = { id: b.id, towards: b.towards };
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

// ---- Letters of a spread area point ----------------------------------------------------------------------

/**
 * Order of the stations of an expanded area point, which is also their letter order (A, B, C…): by name, so
 * same-named platforms get adjacent letters, then by direction (north first, clockwise), then by id (stable).
 */
export function letterOrder<T extends { id: string; name: string; heading: number | null }>(stations: readonly T[]): T[] {
  return [...stations].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'pt') ||
      (a.heading ?? 999) - (b.heading ?? 999) ||
      a.id.localeCompare(b.id),
  );
}

/** A, B, … Z, then AA, AB … (an area point never has that many, but never repeat a letter). */
export function letterFor(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : letterFor(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

/** The map label of a single marker: at most `max` characters, ending in "…" when shortened (full name in the panel). */
export function shortLabel(name: string, max = 22): string {
  const n = name.trim();
  if (n.length <= max) return n;
  return n.slice(0, max - 1).trimEnd() + '…';
}

// ---- Initials of single stations -------------------------------------------------------------------------

/** Linking words are left out of initials ("Praça de Espanha" → "PE"). */
const LINKING = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'a', 'o']);
const mainWords = (name: string) =>
  displayName(name)
    .split(/[\s\-–—/.,()]+/)
    .filter(w => w && !LINKING.has(w.toLowerCase()));

/** Initials of the main words of a station name, at most 3 letters ("Marquês de Pombal" → "MP"). */
export function initialsOf(name: string): string {
  return mainWords(name).slice(0, 3).map(w => w[0]!.toUpperCase()).join('') || '?';
}

/**
 * Initials for the visible single stations, unique among them (in priority order: the first keeps its plain
 * initials). A clash is extended with the next letter of the last word used ("RA" → "RAT") when there is room,
 * else numbered ("MP" → "MP2").
 */
export function uniqueInitials(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    const base = initialsOf(name);
    const words = mainWords(name);
    const candidates = [base];
    const last = words[Math.min(words.length, 3) - 1];
    if (base.length < 3 && last && last.length > 1) candidates.push(base + last[1]!.toUpperCase());
    for (let k = 2; k < 100; k++) candidates.push(`${base}${k}`);
    const pick = candidates.find(c => !used.has(c))!;
    used.add(pick);
    return pick;
  });
}
