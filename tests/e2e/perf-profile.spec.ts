import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type CDPSession, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { createRoom, expectScreen, joinRoom, openClient, passSelect, pickStage, readyOnly } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * Where a race's main-thread time and allocations go, by function.
 *
 * The frame probe (`perf-probe.spec.ts`) says how much a frame costs; this
 * says who spends it. A two-racer race on rooftops is profiled for a few
 * seconds with V8's sampling CPU profiler and its sampling heap profiler, and
 * the top functions by self time and by bytes allocated are printed. The raw
 * `.cpuprofile` lands in `evidence/perf-probe/<tag>/` for DevTools.
 *
 *   FLOOR_FIFTY_E2E_REUSE=1 pnpm exec playwright test tests/e2e/perf-profile.spec.ts --project=perf-probe
 */

test.use({ reducedMotion: "no-preference" });

const TAG = process.env["FLOOR_FIFTY_PERF_TAG"] ?? "latest";
const STAGE = process.env["FLOOR_FIFTY_PERF_STAGE"] ?? "rooftops";

test.beforeAll(async () => {
  await waitForServer();
});

type ProfileNode = {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  hitCount?: number;
  children?: number[];
};
type CpuProfile = { nodes: ProfileNode[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] };
type HeapNode = {
  callFrame: ProfileNode["callFrame"];
  selfSize: number;
  children: HeapNode[];
};

const where = (frame: ProfileNode["callFrame"]): string =>
  `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;

function topSelf(profile: CpuProfile, limit: number): string[] {
  const perSample = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000;
  const totals = new Map<string, number>();
  for (const node of profile.nodes) {
    const key = where(node.callFrame);
    totals.set(key, (totals.get(key) ?? 0) + (node.hitCount ?? 0) * perSample);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, ms]) => `${ms.toFixed(1).padStart(8)}ms  ${key}`);
}

function topAllocations(head: HeapNode, limit: number, seconds: number): string[] {
  const totals = new Map<string, number>();
  const walk = (node: HeapNode, stack: string[]): void => {
    const key = where(node.callFrame);
    // Self size attributed to the frame and, for context, its caller.
    const label = `${key}  <- ${stack.at(-1) ?? ""}`;
    totals.set(label, (totals.get(label) ?? 0) + node.selfSize);
    for (const child of node.children) walk(child, [...stack, key]);
  };
  walk(head, []);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, bytes]) => `${(bytes / 1024 / seconds).toFixed(0).padStart(7)}KB/s  ${key}`);
}

async function race(page: Page, guest: Page): Promise<void> {
  const code = await createRoom(page, "Kite");
  await joinRoom(guest, code, "Ninja 2");
  await readyOnly([page, guest]);
  for (const client of [page, guest]) {
    await expect(client.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await pickStage(client, STAGE);
  }
  await passSelect([page, guest]);
  await expectScreen(page, "gameplay");
}

test(`a race on ${STAGE}: main-thread time and allocations by function`, async ({ browser }) => {
  test.setTimeout(240_000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1280, height: 720 } })));
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await openClient(host!);
    await openClient(guest!);
    await race(host!, guest!);
    await host!.waitForTimeout(4000);
    await host!.bringToFront();

    const cdp: CDPSession = await host!.context().newCDPSession(host!);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.startSampling", { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await cdp.send("Profiler.start");
    const seconds = 5;
    await host!.waitForTimeout(seconds * 1000);
    const { profile } = (await cdp.send("Profiler.stop")) as unknown as { profile: CpuProfile };
    const { profile: heap } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: { head: HeapNode } };

    const dir = resolve(evidenceDir("perf-probe"), TAG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `race-${STAGE}.cpuprofile`), JSON.stringify(profile));
    writeFileSync(resolve(dir, `race-${STAGE}.heapprofile`), JSON.stringify(heap));

    console.log(`self time over ${seconds}s:\n  ${topSelf(profile, 40).join("\n  ")}`);
    console.log(`allocations:\n  ${topAllocations(heap.head, 40, seconds).join("\n  ")}`);
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
  }
});
