import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACE_DIR, replayTrace, type RaceTrace } from "../support/trace";

const LEGACY_DIR = join(TRACE_DIR, "before-phase-3");
const files = readdirSync(LEGACY_DIR).filter((name) => name.endsWith(".json"));

describe("the traces recorded before phase 3", () => {
  it("are all here", () => expect(files).toHaveLength(10));

  // Both new rules at 0 are the reference's behaviour (race-flow spec §4.1,
  // §4.2), so the races recorded before them replay exactly.
  it.each(files)("replay %s exactly with the lap hold and the floor carry at 0", (name) => {
    const trace = JSON.parse(readFileSync(join(LEGACY_DIR, name), "utf8")) as RaceTrace;
    expect(replayTrace(trace, { LAP_HOLD_TICKS: 0, MOVING_FLOOR_CARRY: 0 })).toEqual(trace.outcome);
  });
});
