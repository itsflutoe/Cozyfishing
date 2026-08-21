import { describe, expect, it } from "vitest";
import { resolveCatchLedger } from "./catchResolver";
import type { CatchResult } from "./types";

const carp: CatchResult = { id: "carp", name: "Carp", rarity: "common", value: 14, xp: 8 };
const initial = { fish: [] as CatchResult[], xp: 30 };

describe("authenticated catch reward resolution", () => {
  it("leaves fish and XP unchanged when an authenticated player has no server attempt", () => {
    const result = resolveCatchLedger(initial, { authenticated: true, serverAttemptId: null, settledCatch: carp, localPreviewCatch: carp }, fish => fish);
    expect(result).toEqual(initial);
  });

  it("leaves fish and XP unchanged when authenticated settlement rejects or returns no catch", () => {
    const result = resolveCatchLedger(initial, { authenticated: true, serverAttemptId: "server-attempt", settledCatch: null, localPreviewCatch: carp }, fish => fish);
    expect(result).toEqual(initial);
  });

  it("adds rewards only from a successful server settlement for authenticated players", () => {
    const result = resolveCatchLedger(initial, { authenticated: true, serverAttemptId: "server-attempt", settledCatch: carp, localPreviewCatch: null }, fish => fish);
    expect(result).toEqual({ fish: [carp], xp: 38 });
  });
});
