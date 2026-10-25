// The data-source display rule (CLAUDE.md): every departure and vehicle shows where its data comes from.
//   live      = real-time (GPS position / real-time estimate)   -> "3 min"
//   scheduled = timetable only                                  -> "~3 min"
//   stale     = real-time data that is too old to trust         -> "last seen X ago"
//   expected  = estimated position (not used yet)

import type { Departure, Vehicle } from '../../shared/types';

export type SourceState = 'live' | 'scheduled' | 'stale' | 'expected';

/** A GPS fix older than this is shown as stale. Normal fixes are 30–60 s old (docs/DATA.md). */
export const VEHICLE_STALE_AFTER_S = 120;
/** A departure list not refreshed for this long is shown as stale (it normally refreshes every ~20 s). */
export const DEPARTURES_STALE_AFTER_S = 90;

export const SOURCE_TEXT: Record<SourceState, string> = {
  live: 'Live',
  scheduled: 'Scheduled',
  stale: 'Stale',
  expected: 'Expected position',
};

export function vehicleSource(v: Pick<Vehicle, 'timestamp'>, nowMs: number): { state: 'live' | 'stale'; ageSec: number } {
  const ageSec = Math.max(0, Math.round((nowMs - v.timestamp) / 1000));
  return { state: ageSec > VEHICLE_STALE_AFTER_S ? 'stale' : 'live', ageSec };
}

/** `listAgeSec` = how long ago the departure list was fetched. */
export function departureSource(d: Pick<Departure, 'estimatedAt'>, listAgeSec: number): 'live' | 'scheduled' | 'stale' {
  if (listAgeSec > DEPARTURES_STALE_AFTER_S) return 'stale';
  return d.estimatedAt !== null ? 'live' : 'scheduled';
}

/** "12 s", "4 min", "2 h". */
export function agoLabel(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h`;
}

const clock = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' });

/**
 * Countdown to a departure: "now", "3 min", or the clock time from 60 min on.
 * Scheduled times get a "~" prefix. Stale rows show their (last known) time with "~" too.
 */
export function countdownLabel(atSec: number, nowSec: number, state: SourceState): string {
  const approx = state === 'live' ? '' : '~';
  const diff = atSec - nowSec;
  if (diff < 60) return `${approx}now`;
  if (diff < 3600) return `${approx}${Math.floor(diff / 60)} min`;
  return `${approx}${clock.format(new Date(atSec * 1000))}`;
}

export interface DelayInfo {
  minutes: number;
  /** "+3 min" / "−2 min" */
  text: string;
  /** ▲ later than scheduled, ▼ earlier */
  arrow: '▲' | '▼';
  /** For screen readers: "3 min late" */
  spoken: string;
}

/** Delay of a real-time departure versus its schedule; null when on time (under 1 min) or scheduled-only. */
export function delayInfo(d: Pick<Departure, 'estimatedAt' | 'scheduledAt'>): DelayInfo | null {
  if (d.estimatedAt === null) return null;
  const minutes = Math.round((d.estimatedAt - d.scheduledAt) / 60);
  if (minutes === 0) return null;
  return minutes > 0
    ? { minutes, text: `+${minutes} min`, arrow: '▲', spoken: `${minutes} min late` }
    : { minutes, text: `−${-minutes} min`, arrow: '▼', spoken: `${-minutes} min early` };
}
