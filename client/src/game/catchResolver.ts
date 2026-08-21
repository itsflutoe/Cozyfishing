import type { CatchResult } from "./types";

export type CatchLedger<TFish = CatchResult> = {
  fish: TFish[];
  xp: number;
};

export type CatchResolutionInput = {
  authenticated: boolean;
  serverAttemptId: string | null;
  settledCatch: CatchResult | null;
  localPreviewCatch: CatchResult | null;
};

/**
 * Resolves reward state at the trust boundary. Authenticated outcomes must carry
 * both a server-issued attempt and a server-settled catch. A rejected settlement
 * passes `settledCatch: null`, leaving the ledger untouched.
 */
export function resolveCatchLedger<TFish extends CatchResult>(
  current: CatchLedger<TFish>,
  input: CatchResolutionInput,
  createFish: (result: CatchResult) => TFish,
): CatchLedger<TFish> {
  const catchResult = input.authenticated
    ? input.serverAttemptId && input.settledCatch ? input.settledCatch : null
    : input.localPreviewCatch;

  if (!catchResult) return current;
  return { fish: [...current.fish, createFish(catchResult)], xp: current.xp + catchResult.xp };
}
