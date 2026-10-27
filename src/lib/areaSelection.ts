// TPulso: selection inside an expanded area point, as one small state machine (the single source of truth for
// the map letters and the station-list rows). Exactly one platform is selected at a time:
//   none ──tap X──▶ picked X ──tap X──▶ departures X (its panel opens, station focus)
//   picked X ──tap Y──▶ picked Y (X returns to normal)        any ──background / close──▶ none
//   departures X ──tap X──▶ none (the panel closes)          departures X ──tap Y──▶ picked Y

export type AreaSelection = { kind: 'none' } | { kind: 'picked'; id: string } | { kind: 'departures'; id: string };
export type AreaEvent = { type: 'tap'; id: string } | { type: 'background' } | { type: 'close' };

export const NO_SELECTION: AreaSelection = { kind: 'none' };

export function areaSelect(s: AreaSelection, e: AreaEvent): AreaSelection {
  if (e.type !== 'tap') return NO_SELECTION;
  if (s.kind === 'picked' && s.id === e.id) return { kind: 'departures', id: e.id };
  if (s.kind === 'departures' && s.id === e.id) return NO_SELECTION;
  return { kind: 'picked', id: e.id };
}

/** The platform highlighted on the map and in the list (none while its departures are open). */
export const pickedOf = (s: AreaSelection): string | null => (s.kind === 'picked' ? s.id : null);
