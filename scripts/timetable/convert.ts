// Core GTFS -> offline timetable conversion (docs/OFFLINE.md). Pure apart from reading rows from a
// GtfsSource, so it is tested on fixtures/gtfs-tml-sample and run on the full TML feed by the CLI.
import {
  addDays,
  areaKey,
  encodePolyline,
  modeOfRouteType,
  type AreaFile,
  type LineShape,
  type OperatorInfo,
  type PatternData,
  type RouteFile,
  type StopRow,
  type TripRow,
} from '../../shared/timetable.ts';
import type { TransportMode } from '../../shared/types.ts';
import type { GtfsSource } from './gtfs.ts';
import type { OperatorConfig } from './operators.ts';

export interface ConvertOptions {
  /** First service day of the window (normally today in Europe/Lisbon), YYYYMMDD. */
  today: string;
  days: number;
  operators: OperatorConfig[];
  version: string;
  /** Douglas-Peucker tolerance for shapes, metres. */
  shapeToleranceM?: number;
}

export interface ConvertResult {
  operators: Omit<OperatorInfo, 'crossCheck'>[];
  excluded: { id: string; name: string; reason: string }[];
  areas: Map<string, AreaFile>;
  routes: Map<number, RouteFile>;
  /** Tram, metro, train and ferry line shapes for the whole region (identical shapes merged). */
  lines: LineShape[];
  feed: { version: string; publisher: string };
  stats: { tripsInWindow: number; duplicateTrips: number; sameDayDuplicates: Record<string, number>; stopTimes: number; patterns: number; stops: number; shapePointsRaw: number; shapePointsKept: number };
}

const toSec = (t: string): number => {
  const [h, m, s] = t.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
};

/** Day bitmask per service_id over the window, plus each service's first/last date overall. */
export async function readServices(src: GtfsSource, today: string, days: number) {
  const window = Array.from({ length: days }, (_, i) => addDays(today, i));
  const idx = new Map(window.map((d, i) => [d, i]));
  const mask = new Map<string, number>();
  const span = new Map<string, [string, string]>();
  const widen = (sid: string, from: string, to: string) => {
    const s = span.get(sid);
    span.set(sid, s ? [from < s[0] ? from : s[0], to > s[1] ? to : s[1]] : [from, to]);
  };
  for await (const r of src('calendar.txt')) {
    widen(r.service_id!, r.start_date!, r.end_date!);
    const wd = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    let m = mask.get(r.service_id!) ?? 0;
    window.forEach((d, i) => {
      const dow = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).getUTCDay();
      if (d >= r.start_date! && d <= r.end_date! && r[wd[dow]!] === '1') m |= 1 << i;
    });
    mask.set(r.service_id!, m);
  }
  for await (const r of src('calendar_dates.txt')) {
    const i = idx.get(r.date!);
    if (r.exception_type === '1') widen(r.service_id!, r.date!, r.date!);
    if (i === undefined) continue;
    const m = mask.get(r.service_id!) ?? 0;
    mask.set(r.service_id!, r.exception_type === '1' ? m | (1 << i) : m & ~(1 << i));
  }
  return { mask, span };
}

/** Number of trips running on `date` in any GTFS feed (used for the cross-check with own feeds). */
export async function countTripsOn(src: GtfsSource, date: string): Promise<number> {
  const { mask } = await readServices(src, date, 1);
  let n = 0;
  for await (const r of src('trips.txt')) if ((mask.get(r.service_id!) ?? 0) & 1) n++;
  return n;
}

// ---- geometry helpers (flat-earth metres, fine at city scale) ----
const M_LAT = 111_320;
function segProject(p: [number, number], a: [number, number], b: [number, number]) {
  const k = Math.cos((a[0] * Math.PI) / 180);
  const ax = a[1] * k * M_LAT, ay = a[0] * M_LAT, bx = b[1] * k * M_LAT, by = b[0] * M_LAT, px = p[1] * k * M_LAT, py = p[0] * M_LAT;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return { t, d: Math.sqrt(ex * ex + ey * ey), len: Math.sqrt(L) };
}
function distM(a: [number, number], b: [number, number]) {
  const k = Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * k * M_LAT, dy = (b[0] - a[0]) * M_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}
export function cumulative(pts: [number, number][]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1]! + distM(pts[i - 1]!, pts[i]!));
  return c;
}
export function simplify(pts: [number, number][], tolM: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = segProject(pts[i]!, pts[a]!, pts[b]!).d;
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > tolM && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/**
 * Distance along the shape of each stop, in travel order: each stop is projected onto the shape segments
 * from the previous stop's position onwards, so loops and returning routes keep their order.
 */
export function stopDistances(shape: [number, number][], cum: number[], stops: [number, number][]): number[] {
  const out: number[] = [];
  let seg = 0;
  let prev = 0;
  for (const s of stops) {
    let best = { seg, t: 0, d: Infinity };
    for (let i = seg; i < shape.length - 1; i++) {
      const p = segProject(s, shape[i]!, shape[i + 1]!);
      // Only positions at or beyond the previous stop count (an out-and-back route passes a spot twice).
      const along = cum[i]! + (cum[i + 1]! - cum[i]!) * p.t;
      if (along < prev - 1) continue;
      if (p.d < best.d - 0.01) best = { seg: i, t: p.t, d: p.d };
      // Stop searching once far past a good match (keeps loops from snapping to a later pass).
      if (best.d < 30 && cum[i]! - cum[best.seg]! > 2000) break;
    }
    if (best.d === Infinity) best = { seg: Math.max(0, shape.length - 2), t: 1, d: 0 };
    const d = Math.max(prev, cum[best.seg]! + (cum[best.seg + 1]! - cum[best.seg]!) * best.t);
    out.push(Math.round(d));
    prev = d;
    seg = best.seg;
  }
  return out;
}
/** Points of the shape between two distances, with interpolated end points. */
export function sliceShape(shape: [number, number][], cum: number[], d0: number, d1: number): [number, number][] {
  const at = (d: number): [number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < d) i++;
    const a = shape[i - 1]!, b = shape[i]!;
    const f = cum[i]! - cum[i - 1]! ? Math.min(1, Math.max(0, (d - cum[i - 1]!) / (cum[i]! - cum[i - 1]!))) : 0;
    return [+(a[0] + (b[0] - a[0]) * f).toFixed(6), +(a[1] + (b[1] - a[1]) * f).toFixed(6)];
  };
  const out: [number, number][] = [at(d0)];
  for (let i = 0; i < shape.length; i++) if (cum[i]! > d0 && cum[i]! < d1) out.push(shape[i]!);
  out.push(at(d1));
  return out;
}

export async function convert(src: GtfsSource, opt: ConvertOptions): Promise<ConvertResult> {
  // 1.5 m keeps curves such as the Marquês de Pombal roundabout (5 m cut its corners).
  const tol = opt.shapeToleranceM ?? 1.5;
  const opOfAgency = new Map<string, OperatorConfig>();
  for (const o of opt.operators) for (const a of o.agencies) opOfAgency.set(a, o);

  let feed = { version: '', publisher: '' };
  for await (const r of src('feed_info.txt')) feed = { version: r.feed_version ?? '', publisher: r.feed_publisher_name ?? '' };

  const { mask, span } = await readServices(src, opt.today, opt.days);

  const routes = new Map<string, { op: OperatorConfig; line: string; mode: TransportMode; color: string; text: string }>();
  for await (const r of src('routes.txt')) {
    const op = opOfAgency.get(r.agency_id!);
    if (!op) continue;
    routes.set(r.route_id!, {
      op,
      line: r.route_short_name || r.route_long_name || '?',
      mode: modeOfRouteType(Number(r.route_type)),
      color: r.route_color ? `#${r.route_color}` : '',
      text: r.route_text_color ? `#${r.route_text_color}` : '',
    });
  }

  // Trips: per operator, date span over the whole feed and trips today; keep trips running in the window.
  interface Trip { route: string; shape: string; headsign: string; days: number; st: number[] }
  const trips = new Map<string, Trip>();
  const opSpan = new Map<string, [string, string]>();
  const opToday = new Map<string, number>();
  const opModes = new Map<string, Set<TransportMode>>();
  for await (const r of src('trips.txt')) {
    const route = routes.get(r.route_id!);
    if (!route) continue;
    const s = span.get(r.service_id!);
    if (s) {
      const cur = opSpan.get(route.op.id);
      opSpan.set(route.op.id, cur ? [s[0] < cur[0] ? s[0] : cur[0], s[1] > cur[1] ? s[1] : cur[1]] : [s[0], s[1]]);
    }
    const days = mask.get(r.service_id!) ?? 0;
    if (!days) continue;
    if (days & 1) opToday.set(route.op.id, (opToday.get(route.op.id) ?? 0) + 1);
    trips.set(r.trip_id!, { route: r.route_id!, shape: r.shape_id ?? '', headsign: r.trip_headsign ?? '', days, st: [] });
  }

  // Include an operator only if it runs today and its dates cover today.
  const operators: ConvertResult['operators'] = [];
  const excluded: ConvertResult['excluded'] = [];
  const included = new Set<string>();
  for (const o of opt.operators) {
    const sp = opSpan.get(o.id);
    const today = opToday.get(o.id) ?? 0;
    if (!sp) excluded.push({ id: o.id, name: o.name, reason: 'not in the feed' });
    else if (sp[1] < opt.today) excluded.push({ id: o.id, name: o.name, reason: `expired on ${sp[1]}` });
    else if (today === 0) excluded.push({ id: o.id, name: o.name, reason: `no trips on ${opt.today} (feed dates ${sp[0]}–${sp[1]})` });
    else {
      included.add(o.id);
      operators.push({ id: o.id, name: o.name, modes: [], dateFrom: sp[0], dateTo: sp[1], tripsToday: today });
    }
  }
  for (const [id, t] of trips) if (!included.has(routes.get(t.route)!.op.id)) trips.delete(id);

  // stop_times: [seq, stopIndex, arr, dep] per trip
  const stopIndex = new Map<string, number>();
  const stopIds: string[] = [];
  let stopTimes = 0;
  for await (const r of src('stop_times.txt')) {
    const t = trips.get(r.trip_id!);
    if (!t) continue;
    let si = stopIndex.get(r.stop_id!);
    if (si === undefined) { si = stopIds.length; stopIndex.set(r.stop_id!, si); stopIds.push(r.stop_id!); }
    const arr = toSec(r.arrival_time || r.departure_time!);
    const dep = toSec(r.departure_time || r.arrival_time!);
    t.st.push(Number(r.stop_sequence), si, arr, dep);
    stopTimes++;
  }
  const stopInfo = new Array<StopRow | undefined>(stopIds.length);
  for await (const r of src('stops.txt')) {
    const si = stopIndex.get(r.stop_id!);
    if (si !== undefined) stopInfo[si] = [r.stop_id!, r.stop_name ?? '', +Number(r.stop_lat).toFixed(6), +Number(r.stop_lon).toFixed(6)];
  }

  // Patterns and time profiles
  interface Pattern { id: number; route: string; shape: string; headsign: string; stops: number[]; profiles: Map<string, number>; trips: TripRow[] }
  const patterns = new Map<string, Pattern>();
  // Exact duplicates (same route, destination, stops and times) are merged: the TML regional feed lists
  // TCB's trips twice, once per overlapping plan (docs/DATA.md). Days of both copies are combined.
  const seenTrips = new Map<string, TripRow>();
  let duplicateTrips = 0;
  /** Duplicates that ran on the same day as their twin (real double listings), per operator. */
  const sameDayDuplicates: Record<string, number> = {};
  for (const t of trips.values()) {
    const n = t.st.length / 4;
    if (n < 2) continue;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => t.st[a * 4]! - t.st[b * 4]!);
    const seq = order.map(i => t.st[i * 4 + 1]!);
    if (seq.some(si => !stopInfo[si])) continue; // stop missing from stops.txt: skip rather than guess
    const key = `${t.route}|${t.shape}|${t.headsign}|${seq.join(',')}`;
    let p = patterns.get(key);
    if (!p) { p = { id: patterns.size, route: t.route, shape: t.shape, headsign: t.headsign, stops: seq, profiles: new Map(), trips: [] }; patterns.set(key, p); }
    const start = t.st[order[0]! * 4 + 3]!;
    const prof = order.flatMap(i => [t.st[i * 4 + 2]! - start, t.st[i * 4 + 3]! - start]).join(',');
    t.st = []; // free memory
    const dupKey = `${t.route}|${t.headsign}|${seq.join(',')}|${start}|${prof}`;
    const twin = seenTrips.get(dupKey);
    if (twin) {
      if (twin[2] & t.days) {
        const op = routes.get(t.route)!.op.id;
        sameDayDuplicates[op] = (sameDayDuplicates[op] ?? 0) + 1;
      }
      twin[2] |= t.days;
      duplicateTrips++;
      continue;
    }
    let pi = p.profiles.get(prof);
    if (pi === undefined) { pi = p.profiles.size; p.profiles.set(prof, pi); }
    const row: TripRow = [start, pi, t.days];
    p.trips.push(row);
    seenTrips.set(dupKey, row);
  }
  trips.clear();
  // Trips today per operator, counted after merging duplicates.
  const todayAfter = new Map<string, number>();
  for (const p of patterns.values()) {
    const op = routes.get(p.route)!.op.id;
    todayAfter.set(op, (todayAfter.get(op) ?? 0) + p.trips.filter(t => t[2] & 1).length);
  }
  for (const o of operators) o.tripsToday = todayAfter.get(o.id) ?? 0;

  // Shapes (only those used), simplified
  const usedShapes = new Set([...patterns.values()].map(p => p.shape).filter(Boolean));
  const rawShapes = new Map<string, [number, number, number][]>();
  for await (const r of src('shapes.txt')) {
    if (!usedShapes.has(r.shape_id!)) continue;
    let a = rawShapes.get(r.shape_id!);
    if (!a) rawShapes.set(r.shape_id!, (a = []));
    a.push([Number(r.shape_pt_sequence), Number(r.shape_pt_lat), Number(r.shape_pt_lon)]);
  }
  let shapePointsRaw = 0, shapePointsKept = 0;
  const shapes = new Map<string, [number, number][]>();
  for (const [id, a] of rawShapes) {
    a.sort((x, y) => x[0] - y[0]);
    shapePointsRaw += a.length;
    const s = simplify(a.map(p => [p[1], p[2]] as [number, number]), tol);
    shapePointsKept += s.length;
    shapes.set(id, s);
  }
  rawShapes.clear();

  // Build route files and area files
  const areas = new Map<string, AreaFile>();
  const routesOut = new Map<number, RouteFile>();
  const lines = new Map<string, LineShape>();
  const area = (k: string) => {
    let a = areas.get(k);
    if (!a) areas.set(k, (a = { format: 1, version: opt.version, area: k, stops: [], patterns: [] }));
    return a;
  };
  const areaStops = new Map<string, Set<number>>();
  for (const p of patterns.values()) {
    const r = routes.get(p.route)!;
    opModes.set(r.op.id, (opModes.get(r.op.id) ?? new Set()).add(r.mode));
    const pts = p.stops.map(si => [stopInfo[si]![2], stopInfo[si]![3]] as [number, number]);
    // No shape: straight lines between stops (the line is then approximate, but positions stay on it).
    const own = shapes.get(p.shape);
    const shape = own && own.length >= 2 ? own : pts;
    const cum = cumulative(shape);
    const dist = stopDistances(shape, cum, pts);
    const profiles = [...p.profiles.keys()].map(s => s.split(',').map(Number));
    const base = {
      id: p.id, line: r.line, color: r.color, textColor: r.text, mode: r.mode, op: r.op.id, headsign: p.headsign,
      total: p.stops.length, trips: p.trips,
    };
    const fullShape = encodePolyline(sliceShape(shape, cum, dist[0]!, dist[dist.length - 1]!));
    if (r.mode !== 'bus' && !lines.has(fullShape)) lines.set(fullShape, { id: p.id, line: r.line, mode: r.mode, color: r.color, shape: fullShape });
    routesOut.set(p.id, {
      format: 1, version: opt.version, ...base, first: 0,
      // The shape is cut at the first stop, so distances are counted from there.
      stops: p.stops.map(si => stopIds[si]!), dist: dist.map(d => d - dist[0]!),
      shape: fullShape,
      profiles, stopInfo: p.stops.map(si => stopInfo[si]!),
    });
    // Area slices: stops in the area plus one neighbour on each side.
    const byArea = new Map<string, number[]>();
    p.stops.forEach((si, i) => {
      const k = areaKey(stopInfo[si]![2], stopInfo[si]![3]);
      let a = byArea.get(k);
      if (!a) byArea.set(k, (a = []));
      a.push(i);
      let s = areaStops.get(k);
      if (!s) areaStops.set(k, (s = new Set()));
      s.add(si);
    });
    for (const [k, idxs] of byArea) {
      const lo = Math.max(0, idxs[0]! - 1);
      const hi = Math.min(p.stops.length - 1, idxs[idxs.length - 1]! + 1);
      const d0 = dist[lo]!;
      const slice: PatternData = {
        ...base, first: lo,
        stops: p.stops.slice(lo, hi + 1).map(si => stopIds[si]!),
        dist: dist.slice(lo, hi + 1).map(d => d - d0),
        shape: encodePolyline(sliceShape(shape, cum, d0, dist[hi]!)),
        profiles: profiles.map(pr => pr.slice(lo * 2, hi * 2 + 2)),
      };
      area(k).patterns.push(slice);
    }
  }
  for (const [k, set] of areaStops) area(k).stops = [...set].map(si => stopInfo[si]!).sort((a, b) => a[0].localeCompare(b[0]));
  for (const o of operators) o.modes = [...(opModes.get(o.id) ?? [])].sort();

  return {
    operators, excluded, areas, routes: routesOut, lines: [...lines.values()], feed,
    stats: {
      tripsInWindow: [...patterns.values()].reduce((s, p) => s + p.trips.length, 0),
      duplicateTrips,
      sameDayDuplicates,
      stopTimes, patterns: patterns.size, stops: stopIds.length, shapePointsRaw, shapePointsKept,
    },
  };
}
