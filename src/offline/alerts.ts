// TPulso: which service alerts concern what is on screen (docs/ALERTS.md, phase 3). Linked by keys only: a
// pattern's line id (PatternData.lineId), a stop id, an operator's agency ids. Nothing is matched by name.
import type { ServiceAlert } from '../../shared/alerts';

/** In force now (an announced alert starts later; an ended one is gone). */
export function isCurrent(a: Pick<ServiceAlert, 'start' | 'end'>, now: number): boolean {
  return (a.start === null || a.start <= now) && (a.end === null || a.end > now);
}

/** Alerts in force, indexed by line and stop, for the departure rows and vehicle pins. */
export interface AlertIndex {
  /**
   * Alerts on a departure: a line alert for its line (the whole line, or this stop of it), or a stop alert for
   * its stop (all lines there, or its line). `kind` says which, for the row's label.
   */
  forDeparture(lineId: string | undefined, stopId: string): { alerts: ServiceAlert[]; kind: 'line' | 'stop' } | null;
  /** Line alerts for a vehicle's line (any part of the line). */
  forLine(lineId: string | undefined): ServiceAlert[];
}

export function buildAlertIndex(alerts: readonly ServiceAlert[], now: number): AlertIndex {
  const byLine = new Map<string, { a: ServiceAlert; stopIds: readonly string[] }[]>();
  const byStop = new Map<string, { a: ServiceAlert; lineIds: readonly string[] }[]>();
  for (const a of alerts) {
    if (!isCurrent(a, now)) continue;
    if (a.scope === 'lines') for (const l of a.lines) push(byLine, l.lineId, { a, stopIds: l.stopIds });
    if (a.scope === 'stops') for (const s of a.stops) push(byStop, s.stopId, { a, lineIds: s.lineIds });
  }
  return {
    forDeparture(lineId, stopId) {
      const line = lineId ? (byLine.get(lineId) ?? []).filter((x) => x.stopIds.length === 0 || x.stopIds.includes(stopId)).map((x) => x.a) : [];
      const stop = (byStop.get(stopId) ?? []).filter((x) => x.lineIds.length === 0 || (!!lineId && x.lineIds.includes(lineId))).map((x) => x.a);
      if (line.length) return { alerts: unique([...line, ...stop]), kind: 'line' };
      return stop.length ? { alerts: unique(stop), kind: 'stop' } : null;
    },
    forLine(lineId) {
      return lineId ? unique((byLine.get(lineId) ?? []).map((x) => x.a)) : [];
    },
  };
}

/** What is on screen: the departures at the radar's stops and the vehicles inside it. */
export interface HereContext {
  departures: readonly { lineId: string | undefined; stopId: string; op: string }[];
  vehicles: readonly { lineId: string | undefined; op: string }[];
  /** Operator id -> its regional agency ids (Manifest.operators[].agencies). */
  agenciesOf: ReadonlyMap<string, readonly string[]>;
}

/**
 * The alerts that concern the radar: those on a line or stop here, and operator-wide notices of the operators
 * here. A line alert of an operator whose lines have no line key (MobiCascais, TCB) cannot be linked to a line,
 * so it is listed when that operator is here. In force now (`current`) and announced for later (`announced`).
 */
export function alertsHere(alerts: readonly ServiceAlert[], ctx: HereContext, now: number): { current: ServiceAlert[]; announced: ServiceAlert[] } {
  const lineIds = new Set<string>();
  const stopIds = new Set<string>();
  const agencies = new Set<string>();
  const unlinkedAgencies = new Set<string>();
  const add = (x: { lineId: string | undefined; op: string }) => {
    if (x.lineId) lineIds.add(x.lineId);
    for (const ag of ctx.agenciesOf.get(x.op) ?? []) {
      agencies.add(ag);
      if (!x.lineId) unlinkedAgencies.add(ag);
    }
  };
  for (const d of ctx.departures) {
    add(d);
    stopIds.add(d.stopId);
  }
  for (const v of ctx.vehicles) add(v);

  const relevant = (a: ServiceAlert) =>
    a.scope === 'lines'
      ? a.lines.some((l) => lineIds.has(l.lineId)) || unlinkedAgencies.has(a.agencyId)
      : a.scope === 'stops'
        ? a.stops.some((s) => stopIds.has(s.stopId))
        : agencies.has(a.agencyId);
  const current: ServiceAlert[] = [];
  const announced: ServiceAlert[] = [];
  for (const a of alerts) {
    if (a.end !== null && a.end <= now) continue;
    if (!relevant(a)) continue;
    (isCurrent(a, now) ? current : announced).push(a);
  }
  // Lines and stops first, operator-wide notices last; newest first within each.
  const order = (a: ServiceAlert) => (a.scope === 'agency' ? 1 : 0);
  const newest = (x: ServiceAlert, y: ServiceAlert) => order(x) - order(y) || (y.start ?? 0) - (x.start ?? 0);
  current.sort(newest);
  announced.sort((x, y) => (x.start ?? 0) - (y.start ?? 0));
  return { current, announced };
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function unique(a: ServiceAlert[]): ServiceAlert[] {
  return [...new Map(a.map((x) => [x.id, x])).values()];
}

/** Effect in plain English (GTFS-Realtime vocabulary); null when not stated. */
const EFFECT: Record<string, string> = {
  NO_SERVICE: 'No service',
  REDUCED_SERVICE: 'Reduced service',
  SIGNIFICANT_DELAYS: 'Delays possible',
  DETOUR: 'Detour',
  ADDITIONAL_SERVICE: 'Extra service',
  MODIFIED_SERVICE: 'Changed service',
  STOP_MOVED: 'Stop moved',
  ACCESSIBILITY_ISSUE: 'Accessibility',
  NO_EFFECT: 'Information',
};
export const effectLabel = (effect: string): string | null => EFFECT[effect] ?? null;
