import { describe, expect, it } from 'vitest';
import { areaSelect, NO_SELECTION, pickedOf, type AreaEvent, type AreaSelection } from './areaSelection';

const run = (...events: AreaEvent[]) => events.reduce<AreaSelection[]>((acc, e) => [...acc, areaSelect(acc[acc.length - 1]!, e)], [NO_SELECTION]);
const tap = (id: string): AreaEvent => ({ type: 'tap', id });
const background: AreaEvent = { type: 'background' };

describe('selection in an expanded area point', () => {
  it('A→B: B is picked and A is no longer selected', () => {
    const s = run(tap('A'), tap('B'));
    expect(s.map(pickedOf)).toEqual([null, 'A', 'B']);
    expect(s.at(-1)).toEqual({ kind: 'picked', id: 'B' });
  });

  it('B→A: A is picked and B is no longer selected', () => {
    expect(run(tap('B'), tap('A')).at(-1)).toEqual({ kind: 'picked', id: 'A' });
  });

  it('A→A: the second tap opens A\'s departures (nothing stays highlighted)', () => {
    const s = run(tap('A'), tap('A'));
    expect(s.at(-1)).toEqual({ kind: 'departures', id: 'A' });
    expect(pickedOf(s.at(-1)!)).toBeNull();
  });

  it('A→background: nothing is selected', () => {
    expect(run(tap('A'), background).at(-1)).toEqual(NO_SELECTION);
  });

  it('A→B→background: nothing is selected (no leftover from A or B)', () => {
    expect(run(tap('A'), tap('B'), background).at(-1)).toEqual(NO_SELECTION);
  });

  it('at most one platform is ever selected, whatever the sequence', () => {
    const ids = ['A', 'B', 'C'];
    let s: AreaSelection = NO_SELECTION;
    for (let i = 0; i < 200; i++) {
      const e: AreaEvent = i % 7 === 6 ? background : tap(ids[(i * 5) % 3]!);
      s = areaSelect(s, e);
      // One state, one id: never two selections at once.
      expect(s.kind === 'none' || ids.includes((s as { id: string }).id)).toBe(true);
    }
  });

  it('from departures: the same platform closes them, another one is picked', () => {
    expect(run(tap('A'), tap('A'), tap('A')).at(-1)).toEqual(NO_SELECTION);
    expect(run(tap('A'), tap('A'), tap('B')).at(-1)).toEqual({ kind: 'picked', id: 'B' });
  });
});
