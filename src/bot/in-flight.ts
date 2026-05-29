/**
 * v1.2.8 §A.12 — In-flight Chief turn tracker for graceful shutdown.
 *
 * The bot's SIGTERM handler used to call `process.exit(0)` the moment
 * a signal arrived. If a Chief turn was active — claude child process
 * spawned, a workflow stage running, a Discord reply being sent — it
 * got cut off mid-stride. Net effect on the user: bot goes silent
 * with no explanation, the turn's event-sink writes are durable so
 * data isn't lost, but the *response itself* never arrives.
 *
 * v1.2.8 wraps `handleCommand` in a counted scope and the signal
 * handler waits for the counter to drain (with a timeout) before
 * exiting. Cloud + supervise restarts are unaffected — they just
 * take a few seconds longer when the bot is mid-turn.
 *
 * Goal cycles and scheduler routines run in *different processes*
 * (`solosquad goal run`, `solosquad schedule`) so they're outside
 * the bot's drain responsibility — each has its own lifecycle.
 */

let inFlightCount = 0;
let draining = false;

/**
 * Increment the in-flight counter. Returns a `release` function that
 * decrements when called. Caller is expected to `release()` in a
 * `finally` block so an exception during the turn doesn't pin the
 * counter at non-zero forever.
 *
 * When `draining` is true, the counter still increments (the turn was
 * already in flight when the signal arrived) but new incoming work
 * should be refused upstream via `isDraining()`.
 */
export function enterTurn(): () => void {
  inFlightCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlightCount = Math.max(0, inFlightCount - 1);
  };
}

export function inFlight(): number {
  return inFlightCount;
}

export function isDraining(): boolean {
  return draining;
}

/**
 * Switch the bot into drain mode. New incoming Chief turns should be
 * refused (with a brief user-visible message) until the process exits.
 * The shutdown handler calls this before awaiting `waitForDrain`.
 *
 * Idempotent — setting drain twice is a no-op.
 */
export function startDrain(): void {
  draining = true;
}

/**
 * Wait until all in-flight turns finish or `timeoutMs` elapses,
 * whichever comes first. Polls every `pollMs` ms.
 *
 * Returns `{ drained: true }` when the counter hit 0 within budget,
 * or `{ drained: false, remaining: N }` when the timeout hit first.
 * Callers should log the remaining count before forcing exit so the
 * operator knows the bot exited with active work.
 */
export async function waitForDrain(
  timeoutMs = 120_000,
  pollMs = 200,
): Promise<{ drained: boolean; remaining: number }> {
  const deadline = Date.now() + timeoutMs;
  while (inFlightCount > 0 && Date.now() < deadline) {
    await sleep(pollMs);
  }
  return inFlightCount === 0
    ? { drained: true, remaining: 0 }
    : { drained: false, remaining: inFlightCount };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test helper. Resets all state. */
export function _resetInFlight(): void {
  inFlightCount = 0;
  draining = false;
}
