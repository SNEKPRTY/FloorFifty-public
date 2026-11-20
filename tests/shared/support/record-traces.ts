/**
 * Re-records the trace fixtures against the current simulation.
 *
 * Run only when the simulation has deliberately changed, and say so in the
 * commit that carries the new fixtures: a trace is the contract every later
 * physics change is judged against, and overwriting it is how a regression
 * would hide.
 *
 *   pnpm traces:record
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { TRACE_DIR, TRACE_SEEDS, recordTrace, traceFile } from "./trace";

mkdirSync(TRACE_DIR, { recursive: true });

for (const seed of TRACE_SEEDS) {
  for (const playerCount of [1, 4]) {
    const playerIds = Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);
    const trace = recordTrace({ seed, lapCount: 1, playerIds });
    if (trace.outcome.phase !== "finished") {
      throw new Error(`seed ${seed} x${playerCount} did not finish in ${trace.tickCount} ticks`);
    }
    writeFileSync(traceFile(seed, playerCount), `${JSON.stringify(trace)}\n`);
    process.stdout.write(`${seed} x${playerCount}: ${trace.tickCount} ticks\n`);
  }
}
