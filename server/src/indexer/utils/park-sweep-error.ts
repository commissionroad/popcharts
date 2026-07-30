/**
 * Base class for handler errors that mean "this log cannot be applied yet",
 * as distinct from "the indexer is broken". The watcher catches these at its
 * per-log boundary and parks the log's contract below that block — that one
 * address stops advancing and is held back from its own later logs, so
 * nothing is checkpointed past an unapplied event, while every other contract
 * in the sweep carries on.
 *
 * That is the same treatment a log from an unknown address already gets (see
 * the loss-proofing invariant in
 * `src/indexer/watchers/dynamic-address-watcher.ts`). Before this class the
 * two cases diverged for no reason anyone wrote down: an unknown address
 * parked, while a handler that threw took the whole pass with it, including
 * contract groups it had not reached yet.
 *
 * Throwing is still what rolls the handler's transaction back. Parking is a
 * statement about the sweep, not about the write — a handler that wants its
 * row to commit must not throw at all.
 *
 * Deliberately a base class rather than a per-watcher predicate: whether a
 * failure is recoverable-by-retry is a property of the error, not of whichever
 * watcher happens to be running, and a predicate wired per watcher is one more
 * thing to forget. Anything that does not extend this still propagates and
 * abandons the sweep, which stays the right default for a failure nobody
 * anticipated.
 */
export class ParkSweepError extends Error {
  constructor(message: string) {
    super(message);
    // The watcher logs `name` when it parks, and subclassing Error otherwise
    // leaves it reading "Error" for every subclass that forgets to set it.
    this.name = new.target.name;
  }
}
