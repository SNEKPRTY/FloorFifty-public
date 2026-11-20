import { describe, expect, it } from "vitest";
import { recordTrace, replayTrace } from "../support/trace";

describe("the trace recorder", () => {
  it("records a race its own replay reproduces exactly", () => {
    const trace = recordTrace({ seed: 13, lapCount: 1, playerIds: ["p1"] });
    expect(trace.outcome.phase).toBe("finished");
    expect(trace.steps).toHaveLength(trace.tickCount);
    expect(replayTrace(trace)).toEqual(trace.outcome);
  });
});
