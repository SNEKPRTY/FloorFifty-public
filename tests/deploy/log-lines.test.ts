import { describe, expect, it } from "vitest";
import { countLine, emptyCounts } from "../../deploy/bin/log-lines.mjs";

const count = (lines: string[]) => {
  const counts = emptyCounts();
  for (const line of lines) countLine(counts, line);
  return counts;
};

describe("the shared log-line counter (report.mjs and the watch Worker)", () => {
  it("keeps the server's minute tick line", () => {
    const line = JSON.stringify({ event: "ticks", n: 3600, p50: 1.2, p90: 2.1, p99: 4.05, max: 9.3 });
    expect(count([line]).ticks).toEqual([{ n: 3600, p50: 1.2, p90: 2.1, p99: 4.05, max: 9.3 }]);
  });

  it("ignores a tick line a browser posted, or one missing a number", () => {
    expect(
      count([
        JSON.stringify({ src: "client", event: "ticks", n: 1, p50: 1, p90: 1, p99: 1, max: 1 }),
        JSON.stringify({ event: "ticks", n: 1, p50: 1, p90: "x", p99: 1, max: 1 }),
        "not json {",
        '{"event":"something-else"}',
      ]),
    ).toEqual(emptyCounts());
  });

  it("counts refusals with their flood count, and trims what Fly wraps around a line", () => {
    const counts = count(["  " + JSON.stringify({ event: "refused", limit: "join", n: 7 }), JSON.stringify({ event: "refused", limit: "join" })]);
    expect(counts.refusedByLimit).toEqual({ join: 8 });
  });
});
