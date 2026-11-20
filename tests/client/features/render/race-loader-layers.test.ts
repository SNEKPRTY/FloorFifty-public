/**
 * The loader between screens, over the wipe (Ruken loading plan, Task 7).
 *
 * A liquid move (Tutorial, Replay, the race) raises the veil, an opaque blue
 * at z 70, and only then enters the new screen, whose bundles load. The
 * loader and a failure's Try again used to be drawn at z 45 and z 30, under
 * the veil: a cold Tutorial from the title showed a blue wipe with no
 * progress, and a failed one showed it for ever with its panel hidden.
 */

import { describe, expect, it, vi } from "vitest";
import { LOADER_Z, VEIL_Z } from "../../../../apps/client/src/features/render/veil";
import { LoadMeter, SLOW_MS } from "../../../../apps/client/src/lib/load-meter";
import { loadRaceAssets } from "../../../../apps/client/src/features/race/race-scene";
import { FakeAssets } from "../../support/fakes/assets";
import { fakeContext } from "../../support/fakes/screens";
import { ManualTimers } from "../../support/manual-timers";

const loaderOf = (context: ReturnType<typeof fakeContext>): HTMLElement | null =>
  context.stage.overlay.querySelector<HTMLElement>('[data-testid="loader-overlay"]');

describe("the race loader and the liquid veil", () => {
  it("is drawn above the veil, so a covered move shows progress and not a bare wipe", async () => {
    expect(LOADER_Z).toBeGreaterThan(VEIL_Z);
    const assets = new FakeAssets();
    let release!: () => void;
    assets.gate = (name) => (name === "gameplay" ? new Promise<void>((resolve) => (release = resolve)) : undefined);
    const context = fakeContext({ assets });
    const loading = loadRaceAssets(context, "Loading the tutorial…");

    await vi.waitFor(() => expect(loaderOf(context)).not.toBeNull());
    expect(Number(loaderOf(context)!.style.zIndex)).toBeGreaterThan(VEIL_Z);
    expect(loaderOf(context)!.querySelector('[data-testid="loader-progress"]')?.getAttribute("role")).toBe("progressbar");
    release();
    await loading;
    expect(loaderOf(context)).toBeNull();
  });

  it("stays up until the veil has fully cleared, so the wipe is never bare", async () => {
    // Mac run, 2026-10-11: the loader went with its last load while the veil
    // was still fully up, and a frame of flat blue showed before the reveal.
    let clear!: () => void;
    const veilCleared = vi.fn(() => new Promise<void>((resolve) => (clear = resolve)));
    const context = fakeContext({ veilCleared });
    await loadRaceAssets(context, "Loading the tutorial…");

    expect(loaderOf(context), "loaded, but the veil is still up").not.toBeNull();
    clear();
    await vi.waitFor(() => expect(loaderOf(context)).toBeNull());
  });

  it("draws the failure's Try again above the veil too, so a failed move is never a blue screen with the panel under it", async () => {
    const assets = new FakeAssets();
    assets.failOnce = "gameplay";
    const context = fakeContext({ assets });
    const loading = loadRaceAssets(context, "Loading the tutorial…");

    await vi.waitFor(() => expect(context.stage.overlay.querySelector('[data-testid="error-retry"]')).not.toBeNull());
    // The panel's own layer is inside the host; the host is what meets the veil.
    const view = context.stage.overlay.querySelector<HTMLElement>('[data-testid="error-view"]')!;
    let layer: HTMLElement | null = view;
    while (layer !== null && layer.style.zIndex === "") layer = layer.parentElement;
    expect(Number(layer?.style.zIndex)).toBeGreaterThan(VEIL_Z);

    context.stage.overlay.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click();
    await loading;
  });

  it("says it is slow after 8 s on the stall rule's own clock, and takes the line down with the loader", async () => {
    const timers = new ManualTimers();
    const assets = new FakeAssets();
    let release!: () => void;
    assets.gate = (name) => (name === "gameplay" ? new Promise<void>((resolve) => (release = resolve)) : undefined);
    const context = fakeContext({ assets, loads: new LoadMeter({ timers }) });
    const loading = loadRaceAssets(context, "Loading the tutorial…");
    await vi.waitFor(() => expect(loaderOf(context)).not.toBeNull());
    const slow = (): string => loaderOf(context)?.querySelector('[data-testid="loader-slow"]')?.textContent?.trim() ?? "";

    await timers.advance(SLOW_MS - 1);
    expect(slow()).toBe("");
    await timers.advance(1);
    expect(slow()).toMatch(/Still loading/);

    release();
    await loading;
    expect(loaderOf(context)).toBeNull();
    expect(timers.waiting).toBe(0);
  });
});
