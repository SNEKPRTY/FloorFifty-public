/**
 * Does a networked race play as if it were local?
 *
 * Runs only under `pnpm netlab` (`FLOOR_FIFTY_NETLAB=1`): each profile is a
 * real race in real time, so the whole lab takes about a minute and a half,
 * which is a tool rather than a unit test. The default suite carries the
 * deterministic model of the same question in `tests/client/features/net/netcode-model.test.ts`.
 *
 * `FLOOR_FIFTY_NETLAB_PROFILES=lan,cable` narrows the run. Each report is
 * printed and written to `test-results/netlab/<profile>.json`.
 *
 * The budgets are the spec's (`2026-09-23-netcode-telemetry-and-input-alignment-design.md`,
 * **Budgets**). They are asserted after the report is written, so a failing
 * run still leaves its numbers behind.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { LinkProfile } from "./support/latency-proxy";
import { formatLabReport, runNetLab, type LabReport } from "./support/netlab";

const PROFILES: readonly (LinkProfile & { strict: boolean })[] = [
  { name: "lan", upMs: 1, downMs: 1, jitterMs: 0, strict: true },
  { name: "wifi", upMs: 20, downMs: 20, jitterMs: 5, strict: true },
  { name: "cable", upMs: 50, downMs: 50, jitterMs: 10, strict: true },
  {
    name: "mobile",
    upMs: 80,
    downMs: 80,
    jitterMs: 25,
    stallEveryMs: 5_000,
    stallMs: 150,
    strict: false,
  },
];

const selected = (process.env["FLOOR_FIFTY_NETLAB_PROFILES"] ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const enabled = process.env["FLOOR_FIFTY_NETLAB"] === "1";

const reports = new Map<string, LabReport>();

async function record(report: LabReport): Promise<void> {
  const directory = resolve(__dirname, "../../test-results/netlab");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${report.profile.name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`\n${formatLabReport(report)}\n`);
}

describe.runIf(enabled)("the netcode lab", () => {
  for (const profile of PROFILES) {
    if (selected.length > 0 && !selected.includes(profile.name)) continue;

    it(`plays as if local on ${profile.name}`, { timeout: 90_000 }, async () => {
      const report = await runNetLab({ profile, raceSeconds: 12 });
      reports.set(profile.name, report);
      await record(report);

      const late = report.server.inputs.late;
      const total = late + report.server.inputs.accepted;
      const lateShare = total === 0 ? 0 : late / total;
      const lan = reports.get("lan");

      // The room kept time. This holds on every profile: the link is the
      // client's problem, the clock is the server's. The tick's *cost* is
      // budgeted in the room stress test, alone on its process; here the room
      // shares its event loop and its garbage collector with four clients, so
      // it is held only to never costing half a tick.
      expect(report.server.tickRateHz, "server tick rate").toBeGreaterThan(59.8);
      expect(report.server.tickRateHz, "server tick rate").toBeLessThan(60.2);
      expect(report.server.tickMs.p99, "server tick cost p99").toBeLessThan(8.3);

      for (const racer of report.racers) {
        const underruns = racer.client.buffer.underruns / Math.max(1, racer.client.buffer.frames);
        expect(racer.responseFrames.p99, `${racer.name} responds by the next frame`).toBeLessThanOrEqual(1);
        if (profile.strict) {
          expect(racer.misprediction.p99, `${racer.name} misprediction p99`).toBeLessThanOrEqual(1);
          expect(racer.drawnOffset.p99, `${racer.name} drawn offset p99`).toBeLessThanOrEqual(1);
          expect(underruns, `${racer.name} underruns`).toBeLessThanOrEqual(0.01);
        } else {
          // A stall is a real divergence: every frame sent during it arrives
          // after its tick, and no lead short of the stall itself could hide
          // that. What a bad link is held to is that it stays exact the rest
          // of the time, and recovers rather than drifts.
          expect(racer.misprediction.p90, `${racer.name} misprediction p90`).toBeLessThanOrEqual(1);
          expect(racer.drawnOffset.p90, `${racer.name} drawn offset p90`).toBeLessThanOrEqual(1);
        }
      }
      // Floors reached, by the median racer against the median on lan. Not per
      // racer: the reference controller steers from the picture every frame,
      // and a one-frame difference in when it sees a floor can send one racer
      // into a dead end its twelve-second stall reset cannot clear inside the
      // window -- with a misprediction of zero, which is the netcode's part.
      if (lan !== undefined) {
        const median = (reportOf: LabReport): number => {
          const floors = reportOf.racers.map((racer) => racer.floorsReached).sort((a, b) => a - b);
          return floors[Math.floor(floors.length / 2)] ?? 0;
        };
        expect(median(report), "median floors against lan").toBeGreaterThanOrEqual(
          median(lan) - (profile.strict ? 1 : 2),
        );
      }
      expect(lateShare, "late input share").toBeLessThanOrEqual(profile.strict ? 0.01 : 0.05);
    });
  }
});
