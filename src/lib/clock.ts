// TPulso: one shared clock for the whole app. A single 1 s timer; components read a value derived from it with
// useClock(fn) and re-render only when *that value* changes (e.g. a "~3 min" label flips once a minute), so the
// clock tick does not re-render the app. During a test ride the clock is simulated (1×/5×/10×).
import { useCallback, useSyncExternalStore } from 'react';

interface Sim {
  baseSim: number;
  baseReal: number;
  speed: number;
}
let sim: Sim | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** The current (simulated during a ride) time, computed now. Cheap; safe to call every animation frame. */
export function clockNow(): number {
  const t = Date.now();
  return sim ? sim.baseSim + (t - sim.baseReal) * sim.speed : t;
}

/** The time all subscribers see until the next tick (so every component renders the same moment). */
let current = clockNow();

function emit() {
  current = clockNow();
  for (const l of listeners) l();
}
/** Ticks on each real second boundary, so the header clock changes when the real second does. */
function schedule() {
  timer = setTimeout(() => {
    emit();
    schedule();
  }, 1000 - (Date.now() % 1000) + 5);
}
function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) schedule();
  return () => {
    listeners.delete(l);
    if (!listeners.size) clearTimeout(timer);
  };
}

/** Start, change or end the test ride's simulated clock. */
export function setSimClock(s: Sim | null) {
  sim = s;
  emit();
}

/**
 * A value derived from the clock. `fn` must return a primitive (string/number/boolean): the component re-renders
 * only when it changes. Example: `useClock((t) => Math.floor(t / 15_000))` re-renders every 15 s.
 */
export function useClock<T extends string | number | boolean | null>(fn: (nowMs: number) => T, deps: readonly unknown[] = []): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const get = useCallback(() => fn(current), deps);
  return useSyncExternalStore(subscribe, get, get);
}
