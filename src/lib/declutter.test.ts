import { describe, expect, it } from "vitest";
import { declutter, StableDeclutter } from "./declutter";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("declutter", () => {
  it("leaves pins that do not overlap where they are", () => {
    const out = declutter([{ key: "a", x: 0, y: 0 }, { key: "b", x: 40, y: 0 }], 28);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }]);
  });

  it("pushes two overlapping pins apart, half each, along their line", () => {
    const out = declutter([{ key: "a", x: 0, y: 0 }, { key: "b", x: 10, y: 0 }], 28);
    expect(dist(out[0]!, out[1]!)).toBeCloseTo(28, 5);
    expect(out[0]!.x).toBeCloseTo(-9, 5);
    expect(out[1]!.x).toBeCloseTo(19, 5);
    expect(out[0]!.y).toBe(0);
  });

  it("splits pins on the very same spot in a direction that does not depend on their order", () => {
    const one = declutter([{ key: "a", x: 5, y: 5 }, { key: "b", x: 5, y: 5 }], 28);
    const two = declutter([{ key: "b", x: 5, y: 5 }, { key: "a", x: 5, y: 5 }], 28);
    expect(dist(one[0]!, one[1]!)).toBeCloseTo(28, 5);
    expect(one[0]!.x).toBeCloseTo(two[1]!.x, 9);
    expect(one[0]!.y).toBeCloseTo(two[1]!.y, 9);
    expect(one[1]!.x).toBeCloseTo(two[0]!.x, 9);
  });

  it("never moves a fixed pin", () => {
    const out = declutter([{ key: "ride", x: 0, y: 0, fixed: true }, { key: "b", x: 4, y: 3 }], 28);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(dist(out[0]!, out[1]!)).toBeCloseTo(28, 5);
  });

  it("opens up a cluster so no two pins overlap much", () => {
    const pins = Array.from({ length: 6 }, (_, i) => ({ key: `v${i}`, x: i * 2, y: (i % 2) * 2 }));
    const out = declutter(pins, 28, 30);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(dist(out[i]!, out[j]!)).toBeGreaterThan(24);
  });

  it("gives the same answer for the same input", () => {
    const pins = [{ key: "x", x: 1, y: 1 }, { key: "y", x: 3, y: 2 }, { key: "z", x: 2, y: 9 }];
    expect(declutter(pins, 28)).toEqual(declutter(pins, 28));
  });
});

describe('StableDeclutter (moving vehicles, no spinning)', () => {
  it('lets a vehicle pass another side by side, never swinging around it', () => {
    const s = new StableDeclutter();
    let prevB: { x: number; y: number } | null = null;
    let maxStep = 0;
    const sides = new Set<number>();
    // b drives along x past a parked a (both on the same road, y = 0), 2 px per frame.
    for (let x = -60; x <= 60; x += 2) {
      const [pa, pb] = s.run([{ key: 'a', x: 0, y: 0, fixed: true }, { key: 'b', x, y: 0 }], 28);
      expect(pa).toEqual({ x: 0, y: 0 });
      expect(dist(pa!, pb!)).toBeGreaterThanOrEqual(27.99);
      if (Math.abs(x) < 28) sides.add(Math.sign(pb!.y)); // pushed across the road, always to the same side
      if (prevB) maxStep = Math.max(maxStep, dist(prevB, pb!));
      prevB = pb!;
    }
    expect(sides.size).toBe(1);
    expect(maxStep).toBeLessThan(12); // smooth: no jump to the other side
  });
  it('keeps two vehicles at one stop in a fixed arrangement while they wiggle', () => {
    const s = new StableDeclutter();
    const first = s.run([{ key: 'a', x: 100, y: 100 }, { key: 'b', x: 101, y: 100 }], 28);
    for (const [dx, dy] of [[-1, 0], [0, 1], [0, -1], [1, 1]]) {
      const now = s.run([{ key: 'a', x: 100, y: 100 }, { key: 'b', x: 100 + dx!, y: 100 + dy! }], 28);
      // Pushed apart to the same sides every time (along the direction chosen at first contact), never swapped.
      expect(Math.sign(now[1]!.y - now[0]!.y)).toBe(Math.sign(first[1]!.y - first[0]!.y));
      expect(dist(now[0]!, now[1]!)).toBeGreaterThanOrEqual(27.99);
    }
  });
  it('forgets a pair once the two are well apart, and leaves distant pins alone', () => {
    const s = new StableDeclutter();
    s.run([{ key: 'a', x: 0, y: 0 }, { key: 'b', x: 10, y: 0 }], 28);
    expect(s.pairs).toBe(1);
    const out = s.run([{ key: 'a', x: 0, y: 0 }, { key: 'b', x: 100, y: 0 }], 28);
    expect(s.pairs).toBe(0);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
  it('does not depend on the order of the list', () => {
    const one = new StableDeclutter().run([{ key: 'a', x: 0, y: 0 }, { key: 'b', x: 5, y: 3 }], 28);
    const two = new StableDeclutter().run([{ key: 'b', x: 5, y: 3 }, { key: 'a', x: 0, y: 0 }], 28);
    expect(two[1]).toEqual(one[0]);
    expect(two[0]).toEqual(one[1]);
  });
});
