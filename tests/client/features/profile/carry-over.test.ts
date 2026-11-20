// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CarryOver } from "../../../../apps/client/src/features/profile/carry-over";

const counted = () => {
  const log = { built: 0, destroyed: 0 };
  const build = () => {
    log.built += 1;
    return { destroy: () => void (log.destroyed += 1) };
  };
  return { log, build };
};

describe("the carry-over", () => {
  it("destroys a released value at once outside a transition", () => {
    const carry = new CarryOver();
    const { log, build } = counted();
    const lease = carry.claim("sky", build);
    lease.release();
    lease.release();
    expect(log).toEqual({ built: 1, destroyed: 1 });
  });

  it("hands a released value to the next claim made during a transition", () => {
    const carry = new CarryOver();
    const { log, build } = counted();
    const first = carry.claim("sky", build);
    carry.hold();
    first.release();
    const second = carry.claim("sky", build);
    carry.settle();
    expect(second.value).toBe(first.value);
    expect(log).toEqual({ built: 1, destroyed: 0 });
    second.release();
    expect(log.destroyed).toBe(1);
  });

  it("destroys what the incoming screen did not claim once it has entered", () => {
    const carry = new CarryOver();
    const { log, build } = counted();
    const lease = carry.claim("sky", build);
    carry.hold();
    lease.release();
    expect(log.destroyed).toBe(0);
    carry.settle();
    expect(log.destroyed).toBe(1);
  });

  it("refuses a second claim on a key still held", () => {
    const carry = new CarryOver();
    const { build } = counted();
    carry.claim("sky", build);
    expect(() => carry.claim("sky", build)).toThrow(/already claimed/);
  });
});
