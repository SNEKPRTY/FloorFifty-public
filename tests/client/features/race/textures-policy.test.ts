/**
 * Asking for a texture nobody loaded (Ruken loading plan, Task 8).
 *
 * `loadedTextures` used to hand back an empty texture without a word, so a
 * screen built before its bundle arrived drew nothing and nobody knew. In
 * development that is now an error, in the inspection build it is recorded
 * for the browser specs, and a release build behaves as it always did.
 */

import { Assets, Texture } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadedTextures,
  setUnloadedTexturePolicy,
  unloadedTextureAliases,
  type UnloadedTexturePolicy,
} from "../../../../apps/client/src/features/render/textures";
import { SplashArt } from "../../../../apps/client/src/features/render/splash-art";
import { fakeStage } from "../../support/fakes/stage";

let restore: UnloadedTexturePolicy = "empty";
afterEach(() => {
  setUnloadedTexturePolicy(restore);
  delete (window as unknown as { __ffUnloadedTextures?: unknown }).__ffUnloadedTextures;
  vi.restoreAllMocks();
});

const withPolicy = (policy: UnloadedTexturePolicy): void => {
  restore = setUnloadedTexturePolicy(policy);
};

describe("a texture asked for before its bundle is loaded", () => {
  it("is an error in development, naming the alias", () => {
    withPolicy("throw");
    expect(() => loadedTextures("menu.backdrop")).toThrow(/menu\.backdrop.*before its bundle was loaded/);
  });

  it("is recorded, not thrown, in the inspection build, so a browser spec can fail on it", () => {
    withPolicy("record");
    expect(loadedTextures("menu.backdrop")).toBe(Texture.EMPTY);
    expect(loadedTextures("menu.ledge")).toBe(Texture.EMPTY);
    expect(unloadedTextureAliases()).toEqual(["menu.backdrop", "menu.ledge"]);
  });

  it("is an empty texture in a release build, as it always was", () => {
    withPolicy("empty");
    expect(loadedTextures("menu.backdrop")).toBe(Texture.EMPTY);
    expect(unloadedTextureAliases()).toEqual([]);
  });

  it("is the loaded texture, under every policy, once the bundle has loaded", () => {
    vi.spyOn(Assets, "get").mockImplementation(((alias: string) => (alias === "menu.backdrop" ? Texture.WHITE : undefined)) as typeof Assets.get);
    for (const policy of ["throw", "record", "empty"] as const) {
      withPolicy(policy);
      expect(loadedTextures("menu.backdrop")).toBe(Texture.WHITE);
    }
    expect(unloadedTextureAliases()).toEqual([]);
  });

  it("catches the splash built before its own bundle, and lets it draw once the bundle is in", () => {
    withPolicy("throw");
    expect(() => new SplashArt(fakeStage())).toThrow(/splash\.art/);

    vi.spyOn(Assets, "get").mockImplementation((() => Texture.WHITE) as typeof Assets.get);
    const art = new SplashArt(fakeStage());
    expect(art.drawn).toBe(true);
    art.dispose();
  });
});
