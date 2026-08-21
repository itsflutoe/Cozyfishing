/**
 * Local preview may award simulated catches. Authenticated sessions must receive
 * a catch only after the server created an attempt and settled it successfully.
 */
export function mayUseLocalCatch(sessionActive: boolean, attemptId: string | null) {
  return !sessionActive || Boolean(attemptId);
}
