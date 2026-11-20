#!/usr/bin/env node
// The weekly report (release readiness §7.3): what the last week of a box's
// journal says about restarts, crashes, sockets, slow rooms and refusals.
//
// Usage:
//   journalctl -u 'floor-fifty@*' -u caddy --since -7d -o cat | report.mjs [--json]
//
// Plain JavaScript, because it runs on the box, which has Node and nothing
// else of the toolchain. It reads lines and keeps counts; no line holds an
// address, a name or a room code, and nothing here would print one.
import { createInterface } from "node:readline";
import { countLine, emptyCounts } from "./log-lines.mjs";

const counts = emptyCounts();

const lines = createInterface({ input: process.stdin });
for await (const line of lines) countLine(counts, line);

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(counts)}\n`);
} else {
  const table = (entries) =>
    Object.keys(entries).length === 0 ? "none" : Object.entries(entries).map(([key, n]) => `${key} ${n}`).join(", ");
  const gaveUp = counts.socketsOpened === 0 ? 0 : (100 * counts.socketsGaveUp) / counts.socketsOpened;
  process.stdout.write(
    [
      `restarts             ${counts.restarts}`,
      `crash-loop stops     ${counts.crashLoopStops}`,
      `fatal by class       ${table(counts.fatalByClass)}`,
      `client crashes       ${table(counts.clientFatalByClass)}`,
      `rejections by class  ${table(counts.rejectionsByClass)}`,
      `sockets given up     ${counts.socketsGaveUp} of ${counts.socketsOpened} (${gaveUp.toFixed(1)}%)`,
      `slow ticks           ${counts.slowTicks}`,
      `build skew           ${counts.buildSkew}`,
      `refused by limit     ${table(counts.refusedByLimit)}`,
      `peak live rooms      ${counts.peakRooms}`,
      "",
    ].join("\n"),
  );
}
