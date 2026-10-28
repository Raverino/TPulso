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
