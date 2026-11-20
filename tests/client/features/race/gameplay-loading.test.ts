/**
 * Loading into a race (launch polish §3.1.5, "Loader"): a real bar while the
 * race's bundles load, and a real retry when one fails.
 */

import { describe, expect, it } from "vitest";
import { preloadRaceAssets } from "../../../../apps/client/src/features/race/race-scene";
import { FakeAudio } from "../../support/fakes/audio";
import { fakeContentPort, shippedContentPort } from "../../support/fakes/content";
import { fakeContext, gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";
import { snapshotAt } from "../../support/snapshots";

describe("loading into a race", () => {
  it("shows the loader while the race's bundles load, then removes it", async () => {
    let seenLoader = false;
    const stage = fakeStage();
    const gameplay = await gameplayWithFakeNetwork({
      stage,
      whileLoading: () => {
        seenLoader = stage.overlay.querySelector('[data-testid="loader-overlay"]') !== null;
      },
    });
    expect(seenLoader).toBe(true);
    expect(gameplay.overlay.querySelector('[data-testid="loader-overlay"]')).toBeNull();
    gameplay.screen.exit();
  });

  it("maps the race song's own group before decoding it", async () => {
    const { GENERATED_CONTENT } = await import("../../../../apps/server/src/content/generated-content");
    const gameplay = await gameplayWithFakeNetwork({ content: fakeContentPort(GENERATED_CONTENT) });
    const calls = gameplay.audio.calls;
    expect(calls).toContain("load:song-chrome-in-the-rain");
    expect(calls.indexOf("load:song-chrome-in-the-rain")).toBeLessThan(calls.indexOf("preload:music.chromeInTheRain"));
    gameplay.screen.exit();
  });

  it("loads and decodes the room's song, read from the snapshot", async () => {
    const content = shippedContentPort();
    const movingOn = content.current()!.content.songs.find((song) => song.id === "moving-on")!;
    const gameplay = await gameplayWithFakeNetwork({ content, latestSnapshot: snapshotAt(0, { songId: "moving-on" }) });
    expect(gameplay.audio.calls).toContain("load:song-moving-on");
    expect(gameplay.audio.calls).toContain(`preload:${movingOn.audioAlias}`);
    gameplay.screen.exit();
  });

  it("offers a real retry when a bundle fails, and enters the race after it", async () => {
    const gameplay = await gameplayWithFakeNetwork({ failOnce: "gameplay", retryAutomatically: true });
    expect(gameplay.errorShown()).toBe("ASSET_LOAD_FAILED");
    expect(gameplay.screen.isMounted()).toBe(true);
    expect(gameplay.overlay.querySelector('[data-testid="error-view"]')).toBeNull();
    gameplay.screen.exit();
  });

  it("takes the loader down while the failure is shown, so Try again is not under it", async () => {
    // The loader covers the screen at z 45; a failure panel mounted beside it
    // was drawn beneath it, dimmed and unclickable.
    const stage = fakeStage();
    let loaderWithError: boolean | undefined;
    new MutationObserver(() => {
      if (loaderWithError !== undefined) return;
      if (stage.overlay.querySelector('[data-testid="error-view"]') === null) return;
      loaderWithError = stage.overlay.querySelector('[data-testid="loader-overlay"]') !== null;
    }).observe(stage.overlay, { childList: true, subtree: true });

    const gameplay = await gameplayWithFakeNetwork({ stage, failOnce: "gameplay", retryAutomatically: true });

    expect(loaderWithError).toBe(false);
    gameplay.screen.exit();
  });

  it("enters the race though the browser has not let sound start yet", async () => {
    // A refused resume never settles; waiting on it held the race behind the loader.
    const audio = new FakeAudio();
    audio.running = false;
    const gameplay = await gameplayWithFakeNetwork({ audio });
    expect(audio.calls).toContain("unlock");
    expect(gameplay.screen.isMounted()).toBe(true);
    gameplay.screen.exit();
  });

  // A whole race song decodes in about 20 s on an iPad mini (WebKit), and the
  // race used to wait up to 8 s of that behind the loader: the blue screen hung
  // after the count. The song now plays when its decode lands; entry waits on art.
  const neverDecodes = (): Promise<void> => new Promise<void>(() => undefined);

  it("enters the race without waiting on a song still decoding", { timeout: 15_000 }, async () => {
    const audio = new FakeAudio();
    audio.preloadGate = neverDecodes;
    const started = performance.now();
    const gameplay = await gameplayWithFakeNetwork({ audio, content: shippedContentPort(), latestSnapshot: snapshotAt(0, { songId: "moving-on" }) });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(audio.calls.some((call) => call.startsWith("preload:"))).toBe(true);
    expect(gameplay.overlay.querySelector('[data-testid="loader-overlay"]')).toBeNull();
    gameplay.screen.exit();
  });

  it("finishes the quiet preload behind the reveal without waiting on the song's decode", { timeout: 15_000 }, async () => {
    const audio = new FakeAudio();
    audio.preloadGate = neverDecodes;
    const started = performance.now();
    await preloadRaceAssets(fakeContext({ audio, content: shippedContentPort() }), undefined, "moving-on");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(audio.calls.some((call) => call.startsWith("preload:"))).toBe(true);
  });
});
