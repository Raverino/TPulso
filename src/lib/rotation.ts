// TPulso: the maths of turning the map (src/components/transit/TransitMap.tsx, Compass). Pure functions, tested.

/** Angle difference folded into -180..180 degrees. */
export const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Screen angle (degrees, clockwise from the +x axis) of point (x, y) around the centre (cx, cy). */
export const pointerAngle = (cx: number, cy: number, x: number, y: number) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;

/** Bearing samples of the last ~120 ms of a gesture: { time (ms), bearing (degrees, not wrapped) }. */
export interface BearingSample {
  t: number;
  b: number;
}
export const VELOCITY_WINDOW_MS = 120;

/** A flick never spins the map faster than this (degrees per ms = 500°/s; a glide adds at most ~160°). */
export const MAX_RELEASE_V = 0.5;
/** Speed estimates from samples closer together than this are noise (e.g. two events in one frame). */
const MIN_SAMPLE_SPAN_MS = 20;

/** Turning speed at release (degrees per ms) from the samples of the last 120 ms; 0 if too few, capped. */
export function releaseVelocity(samples: readonly BearingSample[], now = samples.at(-1)?.t ?? 0): number {
  const recent = samples.filter(s => now - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0]!, last = recent.at(-1)!;
  const dt = last.t - first.t;
  if (dt < MIN_SAMPLE_SPAN_MS) return 0;
  return Math.max(-MAX_RELEASE_V, Math.min(MAX_RELEASE_V, (last.b - first.b) / dt));
}

/** Glide after release: exponential decay with this time constant (ms), stopped below GLIDE_MIN_V. */
export const GLIDE_TAU_MS = 325;
export const GLIDE_MIN_V = 0.01; // degrees per ms (10°/s)

/** One glide step of `dtMs`: the new speed and the angle turned meanwhile (the exact integral of the decay). */
export function glideStep(v: number, dtMs: number, tauMs = GLIDE_TAU_MS): { v: number; delta: number } {
  const k = Math.exp(-dtMs / tauMs);
  return { v: v * k, delta: v * tauMs * (1 - k) };
}

/** Total angle a glide starting at speed `v` adds before it stops (≈ v × tau). */
export const glideDistance = (v: number, tauMs = GLIDE_TAU_MS) => v * tauMs;

/** North snap: within this many degrees of north, the map settles exactly on north. */
export const NORTH_SNAP_DEG = 5;
/** The bearing to settle on after a gesture: the nearest multiple of 360 when within 5° of north, else unchanged. */
export function settleBearing(b: number, within = NORTH_SNAP_DEG): number {
  const off = normDeg(b);
  return Math.abs(off) <= within ? b - off : b;
}
