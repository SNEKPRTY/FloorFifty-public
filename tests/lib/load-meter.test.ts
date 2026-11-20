// @vitest-environment node
/**
 * The one stall rule (Ruken loading plan, Task 1). A wait fails when nothing
 * has arrived for 30 s, or when it errors; anything arriving resets the
 * clock, so a slow link never fails, and a link that is truly dead does.
 */

import { describe, expect, it } from "vitest";
import { LoadMeter, LoadStalled, SLOW_MS, STALL_MS, watchSlow } from "../../apps/client/src/lib/load-meter";
import { ManualTimers } from "../client/support/manual-timers";

const never = (): Promise<never> => new Promise<never>(() => undefined);

/** The outcome of a promise as it stands, without waiting for it. */
const settle = <T>(promise: Promise<T>): { state: "pending" | "resolved" | "rejected"; error?: unknown; value?: T } => {
  const outcome: { state: "pending" | "resolved" | "rejected"; error?: unknown; value?: T } = { state: "pending" };
  promise.then(
    (value) => Object.assign(outcome, { state: "resolved", value }),
    (error: unknown) => Object.assign(outcome, { state: "rejected", error }),
  );
  return outcome;
};

describe("the stall rule", () => {
  it("is 30 s without progress, and the slow line comes at 8 s", () => {
    expect(STALL_MS).toBe(30_000);
    expect(SLOW_MS).toBe(8_000);
  });

  it("fails a wait that sees no progress for 30 s, and not a moment before", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    let signal: AbortSignal | undefined;
    const outcome = settle(meter.guard((given) => ((signal = given), never())));

    await timers.advance(STALL_MS - 1);
    expect(outcome.state).toBe("pending");
    expect(signal?.aborted).toBe(false);

    await timers.advance(1);
    expect(outcome.state).toBe("rejected");
    expect(outcome.error).toBeInstanceOf(LoadStalled);
    // The fetch behind it is told to stop, so a dead socket is not held.
    expect(signal?.aborted).toBe(true);
  });

  it("restarts the clock on every progress report, so a slow link never fails", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    let finish!: (value: string) => void;
    const outcome = settle(meter.guard(() => new Promise<string>((resolve) => (finish = resolve))));

    // Five minutes, a report every 10 s: ten times the stall, and no failure.
    for (let seconds = 0; seconds < 300; seconds += 10) {
      await timers.advance(10_000);
      meter.progress();
    }
    expect(outcome.state).toBe("pending");

    finish("done");
    await timers.advance(0);
    expect(outcome).toMatchObject({ state: "resolved", value: "done" });
  });

  it("counts from the last report, not from the start", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    const outcome = settle(meter.guard(never));

    await timers.advance(20_000);
    meter.progress();
    await timers.advance(29_999);
    expect(outcome.state).toBe("pending");
    await timers.advance(1);
    expect(outcome.state).toBe("rejected");
  });

  it("lets an error through as it is, and leaves no timer running", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    const boom = new Error("404");
    const outcome = settle(meter.guard(() => Promise.reject(boom)));
    await timers.advance(0);
    expect(outcome.state).toBe("rejected");
    expect(outcome.error).toBe(boom);
    expect(timers.waiting).toBe(0);
    expect(meter.pending).toBe(0);
  });

  it("takes a finished wait as progress, and leaves no timer behind", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    let finish!: () => void;
    const first = settle(meter.guard(() => new Promise<void>((resolve) => (finish = resolve))));
    const second = settle(meter.guard(never));

    await timers.advance(25_000);
    finish();
    await timers.advance(0);
    expect(first.state).toBe("resolved");
    // The first one finishing was news: the second has 30 s from then.
    await timers.advance(29_999);
    expect(second.state).toBe("pending");
    await timers.advance(1);
    expect(second.state).toBe("rejected");
    expect(timers.waiting).toBe(0);
  });

  it("does not inherit a stale clock when a wait begins after a long idle stretch", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    // The player sits on the splash for two minutes before touching anything.
    await timers.advance(120_000);
    const outcome = settle(meter.guard(never));
    await timers.advance(STALL_MS - 1);
    expect(outcome.state).toBe("pending");
  });

  it("does not let a second wait starting later put off the first one's stall", async () => {
    const timers = new ManualTimers();
    const meter = new LoadMeter({ timers });
    const first = settle(meter.guard(never));
    await timers.advance(25_000);
    const second = settle(meter.guard(never));
    await timers.advance(5_000);
    expect(first.state).toBe("rejected");
    // The same silence is the second's: every wait pending hears of a stall.
    expect(second.state).toBe("rejected");
  });
});

describe("the slow line", () => {
  it("says so at 8 s of waiting, and only if the wait is still going", async () => {
    const timers = new ManualTimers();
    const said: string[] = [];
    const stop = watchSlow(timers, () => said.push("slow"));
    await timers.advance(SLOW_MS - 1);
    expect(said).toEqual([]);
    await timers.advance(1);
    expect(said).toEqual(["slow"]);
    stop();
  });

  it("stays quiet for a wait that ended first", async () => {
    const timers = new ManualTimers();
    const said: string[] = [];
    const stop = watchSlow(timers, () => said.push("slow"));
    await timers.advance(3_000);
    stop();
    await timers.advance(60_000);
    expect(said).toEqual([]);
    expect(timers.waiting).toBe(0);
  });
});
