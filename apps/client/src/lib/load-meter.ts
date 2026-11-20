/**
 * The one stall rule for everything the game waits on while it loads.
 *
 * The Owner's rule: a loading screen is fine, slow is fine, a blank screen is
 * not, and giving up on a timer and showing a half-loaded screen is not. So
 * no wait here has a deadline of its own. Instead every wait is guarded by one
 * clock that measures *silence*: if nothing has arrived for `STALL_MS` -- not
 * a byte of a download, not a file of a bundle, not a step finished -- the
 * wait fails and the player is shown "couldn't load" with Try again. Anything
 * arriving restarts the clock, so a slow link that keeps delivering never
 * fails, and a dead one always does.
 *
 * One meter is shared by all the loads of a page (the manifest, the content,
 * the bundles, the menu song): bytes flowing in one are news for every wait
 * pending, because the link is evidently alive.
 */

/** How long nothing may arrive before a wait is a failure. */
export const STALL_MS = 30_000;

/** How long a load may take before the screen says it is slow (it is not failing). */
export const SLOW_MS = 8_000;

/** Time, injected so a test turns the clock by hand. */
export interface Timers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A wait that saw no progress for `STALL_MS`. */
export class LoadStalled extends Error {
  constructor() {
    super(`nothing arrived for ${STALL_MS / 1000} seconds`);
    this.name = "LoadStalled";
  }
}

type PendingWait = {
  readonly controller: AbortController;
  readonly stall: () => void;
};

export class LoadMeter {
  /** The clock this meter keeps; a screen's slow line counts on the same one. */
  readonly timers: Timers;
  private readonly stallMs: number;
  private lastProgress: number;
  private readonly waits = new Set<PendingWait>();

  constructor(options: { timers?: Timers; stallMs?: number } = {}) {
    this.timers = options.timers ?? browserTimers;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.lastProgress = this.timers.now();
  }

  /** Something arrived: bytes, a file, a step. Restarts the stall clock for every wait. */
  progress(): void {
    this.lastProgress = this.timers.now();
  }

  /** How many guarded waits are in flight. */
  get pending(): number {
    return this.waits.size;
  }

  /**
   * Runs `wait`, and fails it with `LoadStalled` if the meter sees no
   * progress for the stall window while it is pending. The signal it is given
   * is aborted then, so a fetch behind it lets go of its socket. An error from
   * `wait` passes through unchanged; finishing counts as progress.
   */
  guard<T>(wait: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // A wait that begins after a long quiet stretch (the player sat on the
    // splash) must not inherit the quiet as a stall. With others pending, the
    // clock is theirs and is left alone.
    if (this.waits.size === 0) this.progress();

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let timer: unknown;
      let over = false;

      const finish = (): void => {
        over = true;
        this.timers.clearTimeout(timer);
        this.waits.delete(entry);
      };
      const entry: PendingWait = {
        controller,
        stall: () => {
          if (over) return;
          finish();
          const stalled = new LoadStalled();
          controller.abort(stalled);
          reject(stalled);
        },
      };
      // Checks the silence when it is due, and looks again if news has come
      // since: one timer per wait, however many reports arrive.
      const check = (): void => {
        const quiet = this.timers.now() - this.lastProgress;
        if (quiet >= this.stallMs) {
          // The link is silent for everyone, not just this wait.
          for (const other of [...this.waits]) other.stall();
          return;
        }
        timer = this.timers.setTimeout(check, this.stallMs - quiet);
      };
      this.waits.add(entry);
      timer = this.timers.setTimeout(check, this.stallMs);

      wait(controller.signal).then(
        (value) => {
          if (over) return;
          finish();
          this.progress();
          resolve(value);
        },
        (error: unknown) => {
          if (over) return;
          finish();
          reject(error);
        },
      );
    });
  }
}

/**
 * Calls `onSlow` once, `SLOW_MS` from now, unless the returned stop is called
 * first. A slow load is not a failed one: this only lets a screen say so.
 */
export function watchSlow(timers: Timers, onSlow: () => void, slowMs: number = SLOW_MS): () => void {
  const timer = timers.setTimeout(onSlow, slowMs);
  return () => timers.clearTimeout(timer);
}
