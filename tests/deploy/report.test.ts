import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./support/stubs";

/** Runs the report over journal lines, as `journalctl -o cat | report.mjs --json` does. */
const report = (lines: string[]): Record<string, unknown> => {
  const result = spawnSync("node", [join(REPO, "deploy/bin/report.mjs"), "--json"], {
    input: lines.join("\n"),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const event = (body: Record<string, unknown>): string => JSON.stringify({ t: 1, ...body });

describe("the weekly report (release readiness §7.3)", () => {
  it("counts restarts and crash-loop stops from systemd", () => {
    expect(
      report([
        "Started floor-fifty@blue.service - Floor Fifty (blue).",
        "Started floor-fifty@green.service - Floor Fifty (green).",
        "floor-fifty@blue.service: Failed with result 'start-limit-hit'.",
      ]),
    ).toMatchObject({ restarts: 2, crashLoopStops: 1 });
  });

  // Audit S26: a posted `fatal` event shared its name with the server's own
  // crash line, and the runbook says a new fatal class means roll back, so a
  // stranger could forge the signal. The two are counted apart: the server's
  // own crash lines carry the rollback signal, and browsers' reports (marked
  // `src: "client"` by the endpoint) are a separate table.
  it("counts the server's own fatal errors by class, and the clients' apart", () => {
    expect(
      report([
        JSON.stringify({ event: "fatal", class: "TypeError", stack: "x" }),
        event({ src: "client", event: "fatal", class: "TypeError", screen: "Gameplay" }),
        event({ src: "client", event: "fatal", class: "Forged", screen: "Lobby" }),
      ]),
    ).toMatchObject({ fatalByClass: { TypeError: 1 }, clientFatalByClass: { TypeError: 1, Forged: 1 } });
  });

  it("counts a refusal line's own count, for a flood written as one line", () => {
    expect(
      report([
        JSON.stringify({ event: "refused", limit: "create" }),
        JSON.stringify({ event: "refused", limit: "create", n: 99 }),
      ]),
    ).toMatchObject({ refusedByLimit: { create: 100 } });
  });

  it("counts unhandled rejections apart from fatal errors", () => {
    expect(
      report([
        event({ event: "rejection", class: "EncodingError", screen: "Gameplay" }),
        event({ event: "rejection", class: "EncodingError", screen: "Lobby" }),
      ]),
    ).toMatchObject({ rejectionsByClass: { EncodingError: 2 }, fatalByClass: {}, clientFatalByClass: {} });
  });

  it("counts sockets opened and given up", () => {
    expect(
      report([
        event({ event: "socket", state: "open" }),
        event({ event: "socket", state: "open" }),
        event({ event: "socket", state: "gave-up" }),
      ]),
    ).toMatchObject({ socketsOpened: 2, socketsGaveUp: 1 });
  });

  it("counts slow ticks, build skew, refusals by limit, and the peak of live rooms", () => {
    expect(
      report([
        "[ff:room 3] slow tick 22.4ms",
        "[ff:room 4] slow tick 19.0ms",
        "[ff:room 3] build-skew client 202610010000-aaaaaaa server 202610020000-bbbbbbb",
        JSON.stringify({ event: "refused", limit: "create" }),
        JSON.stringify({ event: "refused", limit: "create" }),
        JSON.stringify({ event: "refused", limit: "busy" }),
        JSON.stringify({ event: "rooms", live: 4 }),
        JSON.stringify({ event: "rooms", live: 11 }),
        JSON.stringify({ event: "rooms", live: 7 }),
      ]),
    ).toMatchObject({ slowTicks: 2, buildSkew: 1, refusedByLimit: { create: 2, busy: 1 }, peakRooms: 11 });
  });

  it("ignores lines it does not know, and malformed JSON", () => {
    expect(report(["floor-fifty server listening on 3001", "{not json", ""])).toMatchObject({ restarts: 0, peakRooms: 0 });
  });

  it("prints a readable summary without --json", () => {
    const result = spawnSync("node", [join(REPO, "deploy/bin/report.mjs")], {
      input: JSON.stringify({ event: "rooms", live: 3 }),
      encoding: "utf8",
    });
    expect(result.stdout).toMatch(/peak live rooms\s+3/);
  });
});
