import { describe, expect, it } from "vitest";
import { normalizeMovement } from "./movement";

describe("touch and keyboard movement normalization", () => {
  it("keeps a cardinal movement at full speed", () => {
    expect(normalizeMovement(0, -1)).toEqual({ x: 0, y: -1 });
  });

  it("prevents diagonal touch movement from exceeding cardinal speed", () => {
    const diagonal = normalizeMovement(1, 1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2);
  });

  it("stops when the touch control is released", () => {
    expect(normalizeMovement(0, 0)).toEqual({ x: 0, y: 0 });
  });
});
