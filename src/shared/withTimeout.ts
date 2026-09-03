/**
 * Bounds a promise that has no bound of its own.
 *
 * supabase-js issues its requests through `fetch`, which on React Native
 * has no default timeout — a rejected request fails fast, but a *stalled*
 * one (captive portal, half-open socket, a network that went away without
 * closing the connection) simply never settles. Any spinner waiting on
 * one is therefore permanent, and "permanent spinner" is not a state the
 * user can get out of without force-quitting.
 *
 * The underlying work is not cancelled — there is no abort signal to
 * thread through — so every caller must be safe to retry. That is true of
 * the invitation path by construction: `accept_invitation` re-entered by
 * the same caller falls through to returning their household again
 * (20260806090000_invitation_acceptance_fencing.sql), and the loads are
 * reads.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not respond within ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  // finally rather than then/catch: the timer has to be cleared whichever
  // way the race settles, or a pending timeout keeps the JS timer queue
  // (and in tests, fake timers) alive well past the work completing.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
