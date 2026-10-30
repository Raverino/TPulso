/**
 * TPulso: keeps map pins from covering each other. Vehicle positions are computed from the timetable (Expected),
 * so a few pixels of offset on screen are harmless, while a pin hidden under another is not.
 *
 * Pairs closer than `minPx` are pushed apart along the line between them (half each; a fixed pin does not move,
 * the other moves the whole way), a few rounds. Pins on the very same spot get a stable direction from their
 * keys, so the result never flickers between frames. Same input → same output.
 */
export interface ScreenPin {
  key: string;
  x: number;
  y: number;
  /** Never moved (e.g. the vehicle a test ride follows). */
  fixed?: boolean;
}

export function declutter(pins: readonly ScreenPin[], minPx: number, rounds = 6): { x: number; y: number }[] {
  const p = pins.map((q) => ({ x: q.x, y: q.y }));
  const n = p.length;
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = p[i]!, b = p[j]!;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minPx) continue;
        if (d < 0.01) {
          const ang = angleOf(pins[i]!.key, pins[j]!.key);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        const push = minPx - d;
        const fi = !!pins[i]!.fixed, fj = !!pins[j]!.fixed;
        if (fi && fj) continue;
        const si = fi ? 0 : fj ? 1 : 0.5;
        const sj = fj ? 0 : fi ? 1 : 0.5;
        a.x -= dx * push * si;
        a.y -= dy * push * si;
        b.x += dx * push * sj;
        b.y += dy * push * sj;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return p;
}

/**
 * TPulso: the same, for moving vehicles, without spinning. Pushing two pins apart along the line between them
 * (declutter above) makes them orbit each other when one passes the other: that line turns as they move. Here
 * each close pair keeps the direction it got when the two first came close: across the line between them at that
 * moment (for two vehicles on one road: across the road, like two lanes). While they stay close, they are only
 * moved along that direction, just enough to be `minPx` apart, so they pass side by side and merge back smoothly.
 * Two pins on the very same spot get a direction from their keys. A pair's direction is forgotten once the two are
 * well apart again. One instance per animation loop (it remembers the pairs between frames).
 */
export class StableDeclutter {
  private axes = new Map<string, { ux: number; uy: number }>();

  /** Pairs remembered now (for tests). */
  get pairs(): number {
    return this.axes.size;
  }

  run(pins: readonly ScreenPin[], minPx: number, rounds = 6): { x: number; y: number }[] {
    const p = pins.map((q) => ({ x: q.x, y: q.y }));
    const n = p.length;
    const keep = new Set<string>();
    // Pairs in order of their keys, so a pair's direction never depends on the list order.
    const pairOf = (i: number, j: number) => (pins[i]!.key < pins[j]!.key ? [i, j] : [j, i]) as [number, number];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [lo, hi] = pairOf(i, j);
        const vx = pins[hi]!.x - pins[lo]!.x, vy = pins[hi]!.y - pins[lo]!.y;
        const d = Math.hypot(vx, vy);
        const k = `${pins[lo]!.key}|${pins[hi]!.key}`;
        if (d < minPx * 1.5 && this.axes.has(k)) keep.add(k);
        else if (d < minPx) {
          let ux: number, uy: number;
          if (d < 0.5) {
            const ang = angleOf(pins[lo]!.key, pins[hi]!.key);
            ux = Math.cos(ang);
            uy = Math.sin(ang);
          } else {
            ux = -vy / d;
            uy = vx / d;
          }
          if (ux < 0 || (ux === 0 && uy < 0)) {
            ux = -ux;
            uy = -uy;
          }
          this.axes.set(k, { ux, uy });
          keep.add(k);
        }
      }
    }
    for (const k of this.axes.keys()) if (!keep.has(k)) this.axes.delete(k);

    for (let round = 0; round < rounds; round++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const [lo, hi] = pairOf(i, j);
          const a = p[lo]!, b = p[hi]!;
          const vx = b.x - a.x, vy = b.y - a.y;
          const d2 = vx * vx + vy * vy;
          if (d2 >= minPx * minPx - 0.01) continue;
          const u = this.axes.get(`${pins[lo]!.key}|${pins[hi]!.key}`);
          if (!u) continue;
          const fa = !!pins[lo]!.fixed, fb = !!pins[hi]!.fixed;
          if (fa && fb) continue;
          // Smallest shift s >= 0 along u that makes |v + u·s| = minPx.
          const vu = vx * u.ux + vy * u.uy;
          const s = -vu + Math.sqrt(Math.max(0, vu * vu - d2 + minPx * minPx));
          if (s <= 0.01) continue;
          const sa = fa ? 0 : fb ? 1 : 0.5;
          const sb = fb ? 0 : fa ? 1 : 0.5;
          a.x -= u.ux * s * sa;
          a.y -= u.uy * s * sa;
          b.x += u.ux * s * sb;
          b.y += u.uy * s * sb;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return p;
  }
}

/** A stable angle for two keys (order-independent in magnitude, so the pair always splits the same way). */
function angleOf(a: string, b: string): number {
  let h = 2166136261;
  for (const ch of a < b ? a + "|" + b : b + "|" + a) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const ang = ((h >>> 0) % 360) * (Math.PI / 180);
  return a < b ? ang : ang + Math.PI;
}
