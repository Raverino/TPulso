// Live GPS buses over the timetable (docs/LIVE.md). Carris Metropolitana's open API reports each bus with the
// GTFS trip_id of the trip it runs; the timetable build writes a trip_id index per line (live/<line>.json), so a
// live bus is linked to its timetable trip by that exact key, never by matching text or nearby positions.
//
// A linked bus keeps its timetable trip key (`${pattern}:${tripIndex}:${serviceDate}`), so selection, the route
// line, the next stops and the departure rows work unchanged; only its position (and source state) is real.
// Pure functions: tested in live.test.ts.

import { addDays, decodePolyline, serviceDayStartMs, type Manifest, type PatternData } from '../../shared/timetable';
import type { Vehicle as LiveBus } from '../../shared/types';
import { pointAlong, type ExpectedVehicle } from './engine';

export type { LiveBus };

/** A GPS fix older than this is shown as Stale ("last seen X ago"), as in src/lib/sourceStatus.ts. */
export const LIVE_STALE_AFTER_S = 120;
/** Older than this, the fix is not shown at all (the bus may have finished its trip long ago). */
export const LIVE_DROP_AFTER_S = 600;

export type LiveState = 'live' | 'stale';

export function liveState(fixAtMs: number, nowMs: number): LiveState | null {
  const age = (nowMs - fixAtMs) / 1000;
  if (age > LIVE_DROP_AFTER_S) return null;
  return age > LIVE_STALE_AFTER_S ? 'stale' : 'live';
}

/** Operators (manifest ids) whose buses come from the live feed: those owning the agencies of the indexed lines. */
export function liveOperators(manifest: Pick<Manifest, 'operators' | 'liveTrips'>): Set<string> {
  const agencies = new Set((manifest.liveTrips?.lines ?? []).map((l) => l.match(/^\[([^\]]+)\]/)?.[1]).filter(Boolean));
  return new Set(manifest.operators.filter((o) => o.agencies.some((a) => agencies.has(a))).map((o) => o.id));
}

/** Trips merged as near duplicates (up to 2 min apart, same pattern) may keep the other listing's start. */
const NEAR_DUPLICATE_S = 120;

/**
 * The timetable trip a live bus runs: the row of `pattern` with the indexed start time, on the service day
 * (today or yesterday, for trips after midnight) whose run is closest to now. Null when the pattern has no such
 * row running on those days.
 */
export function linkTrip(
  manifest: Pick<Manifest, 'window'>,
  pattern: Pick<PatternData, 'id' | 'trips' | 'profiles' | 'stops'>,
  start: number,
  nowMs: number,
): { key: string; tripIndex: number; serviceDate: string } | null {
  let best: { key: string; tripIndex: number; serviceDate: string } | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < manifest.window.days; i++) {
    const date = addDays(manifest.window.first, i);
    const day = serviceDayStartMs(date, 'Europe/Lisbon');
    if (nowMs < day - 3600_000 || nowMs > day + 30 * 3600_000) continue;
    const bit = 1 << i;
    for (let ti = 0; ti < pattern.trips.length; ti++) {
      const [s, pi, mask] = pattern.trips[ti]!;
      if (!(mask & bit)) continue;
      const off = Math.abs(s - start);
      if (off > NEAR_DUPLICATE_S) continue;
      const pr = pattern.profiles[pi]!;
      const from = day + s * 1000;
      const to = day + (s + pr[pr.length - 2]!) * 1000;
      // Distance in time from the scheduled run (0 while it should be running); an exact start always wins.
      const away = nowMs < from ? from - nowMs : nowMs > to ? nowMs - to : 0;
      const score = away + off * 1000 * 60;
      if (score < bestScore) {
        bestScore = score;
        best = { key: `${pattern.id}:${ti}:${date}`, tripIndex: ti, serviceDate: date };
      }
    }
  }
  return best;
}

interface Geo { pts: [number, number][]; cum: number[] }
const geoCache = new WeakMap<PatternData, Geo>();
function geometry(p: PatternData): Geo {
  let g = geoCache.get(p);
  if (!g) {
    const pts = decodePolyline(p.shape);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const k = Math.cos((a[0] * Math.PI) / 180);
      cum.push(cum[i - 1]! + Math.hypot((b[1] - a[1]) * k * 111_320, (b[0] - a[0]) * 111_320));
    }
    geoCache.set(p, (g = { pts, cum }));
  }
  return g;
}

/**
 * Where a GPS position lies along a pattern slice: metres along the slice (scaled to its stop distances, like
 * engine.pointAlong) and the distance off the line. On a route that passes the same street twice, `hint` (an
 * expected distance along) picks the nearer of two equally close points.
 */
export function projectOnPattern(p: PatternData, lat: number, lng: number, hint?: number): { along: number; offM: number } | null {
  const { pts, cum } = geometry(p);
  if (pts.length < 2) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  const total = cum[cum.length - 1]!;
  const span = p.dist[p.dist.length - 1]! || total;
  let best: { along: number; offM: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const ax = a[1] * k * 111_320, ay = a[0] * 111_320;
    const dx = b[1] * k * 111_320 - ax, dy = b[0] * 111_320 - ay;
    const px = lng * k * 111_320 - ax, py = lat * 111_320 - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
    const offM = Math.hypot(px - dx * t, py - dy * t);
    const along = ((cum[i - 1]! + t * (cum[i]! - cum[i - 1]!)) / (total || 1)) * span;
    if (!best || offM < best.offM - 5 || (Math.abs(offM - best.offM) <= 5 && hint !== undefined && Math.abs(along - hint) < Math.abs(best.along - hint))) {
      best = { along, offM };
    }
  }
  return best;
}

/** Further than this from its route line, a bus is still shown where its GPS says, but not placed on a stop. */
const OFF_ROUTE_M = 150;
/** Within this of a stop, the bus counts as at that stop. */
const AT_STOP_M = 20;

/**
 * A linked live bus as a vehicle of the radar: its GPS position and heading, its timetable trip (key, pattern,
 * destination, operator) and, from where it lies on the slice, its next stop. `expected` (the same trip's
 * timetable position, when running) is the hint for routes that pass a place twice.
 */
export function liveVehicle(
  bus: LiveBus,
  slice: PatternData,
  link: { key: string; tripIndex: number; serviceDate: string },
  state: LiveState,
  expected?: ExpectedVehicle,
): ExpectedVehicle {
  const hint = expected && expected.segment.from >= slice.first ? slice.dist[expected.segment.from - slice.first] : undefined;
  const pr = projectOnPattern(slice, bus.lat, bus.lng, hint);
  let next = expected?.nextStopIndex ?? slice.first;
  let segment = expected?.segment ?? { from: slice.first, to: slice.first, f: 0 };
  let atStop = expected?.atStop ?? false;
  if (pr && pr.offM <= OFF_ROUTE_M) {
    const d = slice.dist;
    let i = 0;
    while (i < d.length - 1 && d[i + 1]! <= pr.along) i++; // i = last stop at or behind the bus
    if (pr.along - d[i]! <= AT_STOP_M) {
      atStop = true;
      next = slice.first + i;
      segment = { from: next, to: next, f: 0 };
    } else if (i < d.length - 1 && d[i + 1]! - pr.along <= AT_STOP_M) {
      atStop = true;
      next = slice.first + i + 1;
      segment = { from: next, to: next, f: 0 };
    } else if (i < d.length - 1) {
      atStop = false;
      next = slice.first + i + 1;
      segment = { from: slice.first + i, to: next, f: (pr.along - d[i]!) / (d[i + 1]! - d[i]! || 1) };
    }
  }
  // On the route: the point of the line nearest to the GPS fix (a bus drives on its line; GPS wanders a few metres).
  const along = pr && pr.offM <= OFF_ROUTE_M ? pr.along : null;
  const on = along !== null ? pointAlong(slice, along) : null;
  return {
    key: link.key,
    patternId: slice.id,
    tripIndex: link.tripIndex,
    serviceDate: link.serviceDate,
    line: slice.line,
    color: slice.color,
    textColor: slice.textColor,
    mode: slice.mode,
    op: slice.op,
    headsign: slice.headsign,
    lat: on ? on.lat : bus.lat,
    lng: on ? on.lng : bus.lng,
    bearing: on ? on.bearing : (bus.bearing ?? expected?.bearing ?? 0),
    atStop,
    nextStopIndex: next,
    segment,
    live: { state, fixAt: bus.timestamp, busId: bus.id, slice, along },
  };
}

/**
 * How a live bus moves on screen between GPS fixes: along its route line, never through buildings and never in
 * jumps. From where it is drawn, it travels to the newest fix's point on the line at a steady pace, over as long as
 * the bus itself took between its last two fixes (3–30 s), so it moves continuously at about its real speed and
 * reaches each fix as the next one is due. GPS noise that would move it a little backwards is ignored (a bus does
 * not reverse); a large step back (a new trip, or a wrong earlier point) is taken at once.
 */
export interface Track {
  slice: PatternData;
  from: number;
  to: number;
  t0: number;
  dur: number;
  fixAt: number;
}

export const TRACK_MIN_MS = 3_000;
export const TRACK_MAX_MS = 30_000;
/** Backwards by more than this is a real change (taken at once), less is GPS noise (held). */
export const TRACK_JUMP_BACK_M = 150;

/** Metres along the track's slice where the bus is drawn at `ts`. */
export function trackAlong(t: Track, ts: number): number {
  if (t.dur <= 0) return t.to;
  const s = Math.min(1, Math.max(0, (ts - t.t0) / t.dur));
  return t.from + (t.to - t.from) * s;
}

/** The track after a (possibly unchanged) fix at `along` metres on `slice`, at screen time `ts`. */
export function trackUpdate(t: Track | undefined, slice: PatternData, along: number, fixAt: number, ts: number): Track {
  if (!t) return { slice, from: along, to: along, t0: ts, dur: 0, fixAt };
  // Same fix: nothing new (near an area edge the bus may be matched to the neighbouring slice; switch only with a fix).
  if (t.fixAt === fixAt) return t;
  let from = trackAlong(t, ts);
  if (t.slice !== slice) {
    // The bus moved into another area's slice of the same route: carry on from where it is drawn.
    const here = pointAlong(t.slice, from);
    from = projectOnPattern(slice, here.lat, here.lng)?.along ?? along;
  }
  let to = along;
  if (to < from) {
    if (from - to > TRACK_JUMP_BACK_M) from = to;
    else to = from;
  }
  const dur = Math.min(TRACK_MAX_MS, Math.max(TRACK_MIN_MS, fixAt - t.fixAt));
  return { slice, from, to, t0: ts, dur, fixAt };
}

/**
 * Picks, among the loaded slices of a pattern, the one the bus is on (closest to its line; a slice whose stops
 * cover the bus beats a neighbouring one).
 */
export function sliceFor(slices: readonly PatternData[], lat: number, lng: number): PatternData | undefined {
  let best: { p: PatternData; off: number } | undefined;
  for (const p of slices) {
    const pr = projectOnPattern(p, lat, lng);
    if (!pr) continue;
    if (!best || pr.offM < best.off) best = { p, off: pr.offM };
  }
  return best?.p;
}
