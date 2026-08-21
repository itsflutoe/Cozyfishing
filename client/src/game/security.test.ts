import { describe, expect, it } from "vitest";
import { mayUseLocalCatch } from "./security";

describe("authenticated catch settlement gate", () => {
  it("allows a local simulated catch only in the unauthenticated preview", () => {
    expect(mayUseLocalCatch(false, null)).toBe(true);
  });

  it("rejects a signed-in catch that has no server-issued fishing attempt", () => {
    expect(mayUseLocalCatch(true, null)).toBe(false);
  });

  it("permits a signed-in catch to proceed to server settlement when an attempt exists", () => {
    expect(mayUseLocalCatch(true, "f07f90fa-bec3-44f9-86c1-1cc36f4a7f11")).toBe(true);
  });
});
