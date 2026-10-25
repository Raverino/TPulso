// One marker per physical station: stops with the same normalised name within 60 m are merged.
// The individual stop IDs are kept (for departures and vehicle filtering) and never shown.
import { distanceMeters } from '../../shared/geo';
import type { TransportMode } from '../../shared/types';

export interface StationStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  modes: ReadonlySet<TransportMode>;
}

export interface Station {
  /** Smallest member stop id (stable, internal only). */
  id: string;
  name: string;
  lat: number;
  lng: number;
  stopIds: string[];
  /** Modes serving any member stop, in a fixed order (bus, tram, train, ferry). */
  modes: TransportMode[];
}

export const MERGE_DISTANCE_M = 60;
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

export function groupStations(stops: readonly StationStop[], maxM = MERGE_DISTANCE_M): Station[] {
  const parent = stops.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const byName = new Map<string, number[]>();
  stops.forEach((s, i) => {
    const k = normaliseName(s.name);
    const a = byName.get(k);
    if (a) a.push(i);
    else byName.set(k, [i]);
  });
  // Link every pair with the same normalised name within maxM (chains merge too, e.g. platforms P1…P6).
  for (const idx of byName.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        if (distanceMeters(stops[idx[a]!]!, stops[idx[b]!]!) <= maxM) parent[find(idx[a]!)] = find(idx[b]!);
      }
    }
  }
  const groups = new Map<number, StationStop[]>();
  stops.forEach((s, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });
  return [...groups.values()].map(members => {
    // Name: the most common original name; on a tie, the shortest (usually without platform codes).
    const counts = new Map<string, number>();
    for (const m of members) {
      const n = displayName(m.name);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const name = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0]))[0]![0];
    const modes = new Set<TransportMode>();
    for (const m of members) for (const md of m.modes) modes.add(md);
    const ids = members.map(m => m.id).sort();
    return {
      id: ids[0]!,
      name,
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
      stopIds: ids,
      modes: MODE_ORDER.filter(m => modes.has(m)),
    };
  });
}

/** Marker size in px from the number of departures in the next 10 minutes (clamped, so it stays tappable). */
export function stationSize(departures: number, min = 14, max = 30): number {
  if (departures <= 0) return min;
  return Math.round(Math.min(max, min + Math.sqrt(departures) * 3));
}
