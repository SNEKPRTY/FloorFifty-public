/**
 * The room's metronome.
 *
 * Why not `setInterval(step, 16.67)` with an accumulator: Node truncates a
 * timer's delay to whole milliseconds and fires it late rather than early, so
 * that interval really fires every 17 ms, and the accumulator makes up the
 * difference with a burst of two ticks roughly once a second. When a callback
 * runs long, the catch-up cap throws away the fraction of a tick it had banked
 * as well as the ticks it skipped. Measured under four racers, that design
 * ticked at 59.73 Hz with a 99th-percentile gap of 34 ms.
 * A client steering its clock by snapshot arrivals sees every one of those
 * bursts as jitter.
 *
 * This schedules each tick at its own deadline, `start + n * TICK_MS`, and
 * sleeps until exactly then. A tick therefore fires at most a millisecond or
 * so after it is due and there is no burst in the steady state. When the host
 * genuinely stalls, it catches up by at most `maxCatchUp` ticks and moves the
 * schedule forward by whole ticks for the rest, which it reports -- a stall
 * worth dropping is a stall worth knowing about. The room asks for half a
 * second of catch-up, because dropped time moves the timeline every client
 * steers by.
 */

export type TickSchedulerOptions = {
  tickMs: number;
  /** Runs one tick. */
  onTick: () => void;
  /** After each callback: how many ticks ran and how much time was given up. */
  onCallback?: (ticks: number, droppedMs: number) => void;
  maxCatchUp?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type TickScheduler = {
  /** Stops for good. Idempotent. */
  stop(): void;
};

export function startTickScheduler(options: TickSchedulerOptions): TickScheduler {
  const now = options.now ?? (() => performance.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const maxCatchUp = options.maxCatchUp ?? 5;
  const { tickMs } = options;

  let origin = now();
  let fired = 0;
  let stopped = false;
  let handle: unknown;

  const schedule = (): void => {
    if (stopped) return;
    const due = origin + (fired + 1) * tickMs;
    // Rounded up: a timer rounded down wakes a fraction of a millisecond early,
    // finds nothing due, and has to sleep again.
    handle = setTimer(run, Math.max(0, Math.ceil(due - now())));
  };

  const run = (): void => {
    if (stopped) return;
    let owed = Math.floor((now() - origin) / tickMs) - fired;
    let droppedMs = 0;
    if (owed > maxCatchUp) {
      const skipped = owed - maxCatchUp;
      droppedMs = skipped * tickMs;
      // Moving the origin by whole ticks keeps the phase: the next deadline is
      // still on the same grid, just further along it.
      origin += droppedMs;
      owed = maxCatchUp;
    }
    for (let index = 0; index < owed && !stopped; index += 1) {
      fired += 1;
      options.onTick();
    }
    options.onCallback?.(owed, droppedMs);
    schedule();
  };

  schedule();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer(handle);
    },
  };
}
