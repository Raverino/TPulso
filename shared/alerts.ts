// Service alerts (docs/ALERTS.md), shared by the Worker (/api/alerts) and the app. Alerts are linked to the
// timetable only by keys: the regional GTFS agency_id, line id and stop_id, never by matching names.

/** Where an alert comes from. */
export type AlertSourceId = 'tml' | 'ttsl';

export interface ServiceAlert {
  /** Unique across sources, e.g. "tml:GZ1Q4" (internal, never displayed). */
  id: string;
  source: AlertSourceId;
  /** Regional GTFS agency_id of the operator (OperatorInfo.agencies). */
  agencyId: string;
  /**
   * What the alert is attached to: whole lines, some stops, or the operator as a whole. An operator-wide notice
   * (Transtejo/Soflusa RSS, or a TML "agency" alert) has no lines or stops.
   */
  scope: 'lines' | 'stops' | 'agency';
  /** Affected lines (line ids such as "[BNA17]2303"); `stopIds` empty = the whole line. */
  lines: { lineId: string; stopIds: string[] }[];
  /** Affected stops (GTFS stop_id); `lineIds` empty = every line at the stop. */
  stops: { stopId: string; lineIds: string[] }[];
  /** Portuguese, as published. */
  title: string;
  description: string;
  /** GTFS-Realtime vocabulary (CONSTRUCTION, STRIKE…; DETOUR, SIGNIFICANT_DELAYS…); UNKNOWN_* when not given. */
  cause: string;
  effect: string;
  /** Unix ms; null = open-ended. A notice without a validity period (RSS) has start = its publication time. */
  start: number | null;
  end: number | null;
  /** True when the validity is not stated by the source but assumed (RSS: shown for 30 days after publication). */
  endAssumed: boolean;
  url: string | null;
  imageUrl: string | null;
}

export interface AlertSourceStatus {
  id: AlertSourceId;
  ok: boolean;
  /** Alerts this source contributed (after filtering). */
  count: number;
  /** Short reason when not ok, e.g. "upstream 503". */
  error?: string;
}

export interface AlertList {
  generatedAt: string;
  /** Per source: a failed source leaves the others usable (partial result). */
  sources: AlertSourceStatus[];
  alerts: ServiceAlert[];
}

/** One alert source (TML hub, an operator feed…). Throws when the source cannot be read. */
export interface AlertSource {
  id: AlertSourceId;
  fetchAlerts(nowMs: number): Promise<ServiceAlert[]>;
}

/** What the Worker serves: every source combined, with per-source status. */
export interface AlertsProvider {
  alerts(nowMs: number): Promise<AlertList>;
}

/**
 * The line id of a GTFS route_id: the route id without its last "_<number>" (variant), e.g.
 * "[BNA17]2303_1" -> "[BNA17]2303". TML alerts name lines this way. Approved by the owner on 2026-10-28
 * (docs/DATA.md §3). Route ids that do not end in "_<number>" (MobiCascais "[HF16N]M25_A", TCB) have no line id:
 * returns null, so their line alerts are never linked by guessing.
 */
export function lineIdOfRoute(routeId: string): string | null {
  const m = /^(.+)_\d+$/.exec(routeId);
  return m ? m[1]! : null;
}

/** Still in force, or starting later (an alert that has ended is dropped). */
export function notEnded(a: Pick<ServiceAlert, 'end'>, nowMs: number): boolean {
  return a.end === null || a.end > nowMs;
}
