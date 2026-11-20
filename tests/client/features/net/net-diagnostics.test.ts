import { describe, expect, it } from "vitest";
import { ANOMALY, NetDiagnostics } from "../../../../apps/client/src/features/net/net-diagnostics";
import {
  NetStatsOverlay,
  formatNetSummary,
  installNetReader,
  netStatsRequested,
} from "../../../../apps/client/src/features/net/net-stats-overlay";

function driven() {
  let now = 0;
  const lines: string[] = [];
  const diagnostics = new NetDiagnostics({ now: () => now });
  return {
    diagnostics,
    lines,
    attach() {
      diagnostics.setLog((line) => lines.push(line));
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("net diagnostics", () => {
  it("separates republished and reordered snapshots from new ones", () => {
    const { diagnostics, advance } = driven();
    diagnostics.snapshot(30);
    advance(50);
    diagnostics.snapshot(33);
    diagnostics.snapshot(33);
    diagnostics.snapshot(31);
    advance(50);
    diagnostics.snapshot(36);

    const { snapshots } = diagnostics.summary();
    expect(snapshots.count).toBe(5);
    expect(snapshots.duplicates).toBe(1);
    expect(snapshots.reordered).toBe(1);
    expect(snapshots.tickStep.p50).toBe(3);
    expect(snapshots.intervalMs.p50).toBe(50);
  });

  it("counts a frame that sampled past the newest snapshot as an underrun", () => {
    const { diagnostics } = driven();
    diagnostics.buffer(3);
    diagnostics.buffer(0);
    diagnostics.buffer(-1);
    expect(diagnostics.summary().buffer).toMatchObject({ frames: 3, underruns: 2 });
  });

  it("keeps misprediction apart from the smoothing that hides it", () => {
    const { diagnostics } = driven();
    diagnostics.reconcile({
      tick: 100,
      replayTicks: 6,
      misprediction: 12,
      adopted: false,
      rebuildMs: 0.4,
      replayMs: 0.3,
    });
    diagnostics.offset(12);
    diagnostics.offset(0.5);

    const { prediction } = diagnostics.summary();
    expect(prediction.misprediction.max).toBe(12);
    expect(prediction.replayTicks.max).toBe(6);
    expect(prediction.offset.min).toBe(0.5);
  });

  it("logs anomalies only while someone is listening, and once a second per kind", () => {
    const probe = driven();
    const big = ANOMALY.mispredictionUnits + 1;
    const report = {
      tick: 1,
      replayTicks: 1,
      misprediction: big,
      adopted: false,
      rebuildMs: 0,
      replayMs: 0,
    };

    probe.diagnostics.reconcile(report);
    expect(probe.lines).toEqual([]);

    probe.attach();
    probe.diagnostics.reconcile(report);
    probe.diagnostics.reconcile(report);
    expect(probe.lines).toHaveLength(1);
    expect(probe.lines[0]).toMatch(/^\[ff:net\] misprediction/);

    probe.advance(1_001);
    probe.diagnostics.frame(ANOMALY.longFrameMs + 5, 1);
    probe.diagnostics.reconcile(report);
    expect(probe.lines).toHaveLength(3);
  });

  it("does not report an adopted respawn as a misprediction worth a log line", () => {
    const probe = driven();
    probe.attach();
    probe.diagnostics.reconcile({
      tick: 1,
      replayTicks: 1,
      misprediction: 400,
      adopted: true,
      rebuildMs: 0,
      replayMs: 0,
    });
    expect(probe.lines).toEqual([]);
    expect(probe.diagnostics.summary().prediction.adopts).toBe(1);
  });

  it("turns a byte count into a rate", () => {
    const { diagnostics, advance } = driven();
    diagnostics.wire(0);
    advance(1_000);
    diagnostics.wire(2_048);
    expect(diagnostics.summary().wire.bytesPerSecond).toBe(2_048);
  });
});

describe("the net stats overlay", () => {
  it("is asked for by the address, in a dev or inspection build", () => {
    expect(netStatsRequested("?netstats", true)).toBe(true);
    expect(netStatsRequested("?lcd=grid:0", true)).toBe(false);
  });

  // Release readiness D-G8: the flag is inert in a production bundle.
  it("ignores the address in a production build", () => {
    expect(netStatsRequested("?netstats", false)).toBe(false);
  });

  it("shows the summary and attaches the console sink only while visible", () => {
    const host = document.createElement("div");
    const lines: string[] = [];
    const diagnostics = new NetDiagnostics();
    const overlay = new NetStatsOverlay(host, diagnostics, (line) => lines.push(line));

    diagnostics.frame(ANOMALY.longFrameMs + 1, 1);
    expect(lines).toEqual([]);

    overlay.setVisible(true);
    overlay.update(1_000);
    const element = host.querySelector<HTMLElement>("[data-testid=net-stats]")!;
    expect(element.style.display).toBe("block");
    expect(element.textContent).toContain("mispredict");

    diagnostics.frame(ANOMALY.longFrameMs + 1, 1);
    expect(lines).toHaveLength(1);

    overlay.destroy();
    expect(host.querySelector("[data-testid=net-stats]")).toBeNull();
  });

  it("formats an empty race without throwing", () => {
    expect(formatNetSummary(new NetDiagnostics().summary())).toContain("rtt 0ms");
  });

  it("publishes a read-only reader and releases only its own", () => {
    const target = {} as Window;
    const diagnostics = new NetDiagnostics();
    const release = installNetReader(() => diagnostics.summary(), target);
    expect(target.__ffNet?.().snapshots.count).toBe(0);

    const next = installNetReader(() => diagnostics.summary(), target);
    release();
    expect(target.__ffNet).toBeDefined();
    next();
    expect(target.__ffNet).toBeUndefined();
  });
});
