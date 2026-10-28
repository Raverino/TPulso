import { describe, expect, it } from "vitest";
import { declutter } from "./declutter";

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
