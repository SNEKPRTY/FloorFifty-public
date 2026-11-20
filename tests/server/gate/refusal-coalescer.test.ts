import { describe, expect, it } from "vitest";
import { createRefusalCoalescer } from "../../../apps/server/src/gate/refusal-coalescer";

/**
 * Audit S26: `logRefused` wrote one line per refused request with no limit, so
 * a loop of refused requests buried the lines that matter (a crash, a slow
 * tick). The first refusal of a kind in a second is written at once, exactly as
 * before; the rest are counted and written as one line with their number.
 */

const refused = (limit: string): string => JSON.stringify({ event: "refused", limit });

const setup = () => {
  const written: string[] = [];
  const clock = { now: 0 };
  const coalescer = createRefusalCoalescer((line) => void written.push(line), { now: () => clock.now, windowMs: 1_000 });
  return { written, clock, coalescer };
};

describe("refusal lines (audit S26)", () => {
  it("writes the first refusal of a kind at once, as it always was", () => {
    const { written, coalescer } = setup();
    coalescer.log(refused("create"));
    expect(written).toEqual([refused("create")]);
  });

  it("counts a flood inside the window instead of writing it, and writes the count once", () => {
    const { written, clock, coalescer } = setup();
    for (let index = 0; index < 100; index += 1) coalescer.log(refused("create"));
    expect(written).toEqual([refused("create")]);
    clock.now = 1_000;
    coalescer.flush();
    expect(written).toEqual([refused("create"), JSON.stringify({ event: "refused", limit: "create", n: 99 })]);
    coalescer.flush();
    expect(written).toHaveLength(2);
  });

  it("keeps each limit's count apart", () => {
    const { written, clock, coalescer } = setup();
    coalescer.log(refused("create"));
    coalescer.log(refused("origin"));
    coalescer.log(refused("origin"));
    clock.now = 1_000;
    coalescer.flush();
    expect(written).toEqual([
      refused("create"),
      refused("origin"),
      JSON.stringify({ event: "refused", limit: "origin", n: 1 }),
    ]);
  });

  it("writes the next refusal at once once the window has passed, carrying what was counted", () => {
    const { written, clock, coalescer } = setup();
    coalescer.log(refused("busy"));
    coalescer.log(refused("busy"));
    clock.now = 2_000;
    coalescer.log(refused("busy"));
    expect(written).toEqual([refused("busy"), JSON.stringify({ event: "refused", limit: "busy", n: 2 })]);
  });

  it("passes every other line through untouched, and in order", () => {
    const { written, coalescer } = setup();
    coalescer.log('{"event":"rooms","live":3}');
    coalescer.log("[ff:room 3] slow tick 22.4ms");
    expect(written).toEqual(['{"event":"rooms","live":3}', "[ff:room 3] slow tick 22.4ms"]);
  });
});
