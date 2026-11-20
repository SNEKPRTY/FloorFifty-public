import { describe, expect, it } from "vitest";
import { TokenBuckets } from "../../../apps/server/src/gate/token-buckets";

describe("token buckets (release readiness §6.1)", () => {
  it("allow the burst, then one per refill", () => {
    let t = 0;
    const buckets = new TokenBuckets({ burst: 3, refillMs: 20_000, maxKeys: 10, now: () => t });
    expect([1, 2, 3, 4].map(() => buckets.take("a"))).toEqual([true, true, true, false]);
    t = 19_999;
    expect(buckets.take("a")).toBe(false);
    t = 20_000;
    expect(buckets.take("a")).toBe(true);
    expect(buckets.take("a")).toBe(false);
  });

  it("never refill past the burst, however long a key waits", () => {
    let t = 0;
    const buckets = new TokenBuckets({ burst: 2, refillMs: 1_000, maxKeys: 10, now: () => t });
    buckets.take("a");
    t = 1_000_000;
    expect([1, 2, 3].map(() => buckets.take("a"))).toEqual([true, true, false]);
  });

  it("keep each key apart", () => {
    const buckets = new TokenBuckets({ burst: 1, refillMs: 1_000, maxKeys: 10, now: () => 0 });
    expect(buckets.take("a")).toBe(true);
    expect(buckets.take("a")).toBe(false);
    expect(buckets.take("b")).toBe(true);
  });

  it("never hold more than maxKeys under a spray of addresses", () => {
    const buckets = new TokenBuckets({ burst: 1, refillMs: 1_000, maxKeys: 10_000, now: () => 0 });
    for (let index = 0; index < 50_000; index += 1) buckets.take(`10.${index >> 16}.${(index >> 8) & 255}.${index & 255}`);
    expect(buckets.size).toBeLessThanOrEqual(10_000);
  });

  it("evict the least recently used key first, so an active address keeps its debt", () => {
    const buckets = new TokenBuckets({ burst: 1, refillMs: 1_000, maxKeys: 2, now: () => 0 });
    buckets.take("busy");
    buckets.take("quiet");
    buckets.take("busy");
    buckets.take("new");
    // "quiet" was evicted, not "busy": busy is still out of tokens.
    expect(buckets.take("busy")).toBe(false);
  });

  it("forget a full bucket on sweep", () => {
    let t = 0;
    const buckets = new TokenBuckets({ burst: 2, refillMs: 1_000, maxKeys: 10, now: () => t });
    buckets.take("a");
    t = 10_000;
    buckets.sweep();
    expect(buckets.size).toBe(0);
  });

  it("keep a bucket that is still in debt on sweep", () => {
    const buckets = new TokenBuckets({ burst: 2, refillMs: 1_000, maxKeys: 10, now: () => 0 });
    buckets.take("a");
    buckets.sweep();
    expect(buckets.size).toBe(1);
  });
});
