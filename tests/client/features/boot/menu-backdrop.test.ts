import { describe, expect, it, vi } from "vitest";
import { claimMenuBackdrop } from "../../../../apps/client/src/features/boot/menu-backdrop";
import { MENU_MUSIC } from "../../../../apps/client/src/features/boot/menu-music";
import { MENU_BLOOM } from "../../../../apps/client/src/features/render/filters/scene-bloom";
import { fakeContext } from "../../support/fakes/screens";
import { FakeTicker, fakeStage } from "../../support/fakes/stage";

describe("the menu backdrop", () => {
  it("holds the menu's bloom look while a screen holds it, and hands the scene look back after", () => {
    const setBloomLook = vi.fn();
    const stage = Object.assign(fakeStage(), { setBloomLook });
    const context = fakeContext({ stage });

    const release = claimMenuBackdrop(context);
    expect(setBloomLook).toHaveBeenLastCalledWith(MENU_BLOOM);

    release();
    expect(setBloomLook).toHaveBeenLastCalledWith(undefined);
  });

  it("hears the song through the backdrop it claims", () => {
    const ticker = new FakeTicker();
    const context = fakeContext({ stage: fakeStage({ ticker }) });
    const musicSpectrum = vi.fn(() => undefined);
    Object.assign(context.audio, { musicSpectrum });

    const release = claimMenuBackdrop(context, { beatZoom: true });
    ticker.tick(16);
    expect(musicSpectrum).toHaveBeenCalled();
    release();
  });

  it("keeps time to the menu song where it plays", () => {
    const ticker = new FakeTicker();
    const context = fakeContext({ stage: fakeStage({ ticker }) });
    const nowPlaying = vi.fn(() => ({ alias: MENU_MUSIC, ms: 1_000 }));
    Object.assign(context.audio, { nowPlaying });

    const release = claimMenuBackdrop(context, { beatZoom: true });
    ticker.tick(16);
    expect(nowPlaying).toHaveBeenCalled();
    release();
  });

  it("says through the inspection hook whether a backdrop is drawn, and stops when the last claim goes", () => {
    const first = claimMenuBackdrop(fakeContext());
    const second = claimMenuBackdrop(fakeContext());
    expect(window.__ffBackdrop?.()).toEqual({ drawn: true });
    first();
    expect(window.__ffBackdrop?.()).toEqual({ drawn: true });
    second();
    expect(window.__ffBackdrop?.().drawn).not.toBe(true);
  });
});
