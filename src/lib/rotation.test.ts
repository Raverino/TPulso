import { describe, expect, it } from 'vitest';
import { GLIDE_MIN_V, glideDistance, glideStep, normDeg, pointerAngle, releaseVelocity, settleBearing } from './rotation';

describe('map rotation maths', () => {
  it('folds angles into -180..180', () => {
    expect(normDeg(190)).toBe(-170);
    expect(normDeg(-190)).toBe(170);
    expect(normDeg(360)).toBe(0);
  });

  it('measures the pointer angle around the circle centre (screen: clockwise, y down)', () => {
    expect(pointerAngle(0, 0, 10, 0)).toBe(0);
    expect(pointerAngle(0, 0, 0, 10)).toBe(90); // below the centre
    expect(pointerAngle(0, 0, -10, 0)).toBe(180);
  });

  it('takes the release speed from the last 120 ms only', () => {
    const samples = [
      { t: 0, b: 0 },
      { t: 200, b: 100 }, // old: ignored
      { t: 300, b: 110 },
      { t: 400, b: 140 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo(0.3); // 30° in 100 ms
    expect(releaseVelocity([{ t: 0, b: 0 }])).toBe(0);
    // a near-instant jump is not a flick; a very fast flick is capped
    expect(releaseVelocity([{ t: 0, b: 0 }, { t: 5, b: 90 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, b: 0 }, { t: 30, b: 90 }])).toBe(0.5);
  });

  it('glides with a natural (exponential) decay whose steps add up to v × tau', () => {
    let v = 0.4;
    let turned = 0;
    let frames = 0;
    while (Math.abs(v) > GLIDE_MIN_V && frames < 1000) {
      const g = glideStep(v, 16);
      v = g.v;
      turned += g.delta;
      frames++;
    }
    expect(frames).toBeGreaterThan(30); // a short glide (~0.5–1.5 s at 60 fps), not a jump
    expect(frames).toBeLessThan(120);
    expect(turned).toBeLessThan(glideDistance(0.4));
    expect(turned).toBeGreaterThan(glideDistance(0.4) * 0.9);
    expect(glideStep(-0.2, 16).delta).toBeLessThan(0); // either direction
  });

  it('snaps to north only within 5°', () => {
    expect(settleBearing(4)).toBe(0);
    expect(settleBearing(-3.5)).toBe(0);
    expect(settleBearing(362)).toBe(360);
    expect(settleBearing(7)).toBe(7);
    expect(settleBearing(180)).toBe(180);
  });
});
