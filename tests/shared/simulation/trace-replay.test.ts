import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACE_DIR, TRACE_SEEDS, replayTrace, type RaceTrace } from "../support/trace";

const files = readdirSync(TRACE_DIR).filter((name) => name.endsWith(".json"));

describe("recorded traces", () => {
  it("covers every declared seed at both player counts", () => {
    expect(files).toHaveLength(TRACE_SEEDS.length * 2);
  });

  it.each(files)("replays %s to its recorded outcome", (name) => {
    const trace = JSON.parse(readFileSync(join(TRACE_DIR, name), "utf8")) as RaceTrace;

    // Recorded by the solver that replays them, in the runtime that replays
    // them, so the whole outcome is exact -- transforms included. A difference
    // is a change to the simulation, and the answer to one is a deliberate
    // re-record (`pnpm traces:record`) whose commit says why, never a
    // tolerance.
    expect(replayTrace(trace)).toEqual(trace.outcome);
  });
});
