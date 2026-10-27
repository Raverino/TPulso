// TPulso: the mode filter (All / Bus / Train / Tram·Metro / Ferry) and stop-kind labels — one rule for the
// whole app: vehicles, stations and platforms, departure lists, the stop panel and every count.
import type { TransportMode } from '../../shared/types';
import type { StopKind } from './stations';

/** The mode filter: all modes, or one. */
export type FilterMode = 'all' | TransportMode;

/** True when something served by `modes` belongs to the filter (a multi-mode station: under any of its modes). */
export const matchesFilter = (modes: readonly TransportMode[] | ReadonlySet<TransportMode>, filter: FilterMode): boolean =>
  filter === 'all' || (Array.isArray(modes) ? modes.includes(filter as TransportMode) : (modes as ReadonlySet<TransportMode>).has(filter as TransportMode));

/** Only the items (vehicles, departures) of the filtered mode. */
export function filterByMode<T extends { mode: TransportMode }>(items: readonly T[], filter: FilterMode): T[] {
  return filter === 'all' ? [...items] : items.filter(x => x.mode === filter);
}

const KIND_NAME: Record<StopKind, string> = { metro: 'metro', train: 'train', ferry: 'ferry', tram: 'tram', bus: 'bus' };
const KIND_NOUN: Record<StopKind, string> = { metro: 'station', train: 'station', ferry: 'pier', tram: 'stop', bus: 'stop' };

/**
 * "Bus stop", "Metro station", "Tram and bus stop", "Train and bus station"… from the kinds that serve a place
 * (in the fixed order metro, train, ferry, tram, bus; the noun follows the main kind).
 */
export function stopKindLabel(kinds: readonly StopKind[]): string {
  const order: StopKind[] = ['metro', 'train', 'ferry', 'tram', 'bus'];
  const list = order.filter(k => kinds.includes(k));
  if (!list.length) return 'Stop';
  const names = list.map(k => KIND_NAME[k]);
  const joined = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${joined[0]!.toUpperCase()}${joined.slice(1)} ${KIND_NOUN[list[0]!]}`;
}
