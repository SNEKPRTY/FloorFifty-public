// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The stage must not touch Pixi's global `Assets`.
 *
 * `Assets.load` auto-initialises the asset manager, and the later
 * `Assets.init({ manifest })` in `AssetManager` then warns and returns early
 * instead of throwing -- so the art manifest is never registered and every
 * sprite in the race silently draws as `Texture.EMPTY`, while the `Graphics`
 * and `Text` around them render normally.
 *
 * That failure passes every unit test in this suite and is easy to miss on
 * screen, because the sky and the HUD still draw. It is pinned as source
 * inspection because reproducing it needs a real renderer, a real manifest
 * fetch and a running race -- and by then the evidence is a screenshot of
 * missing sprites rather than a failing assertion.
 */
const sourceOf = (path: string): string =>
  readFileSync(resolve(process.cwd(), "apps/client/src", path), "utf8");

describe("the stage's asset boundary", () => {
  it("does not load through Pixi's global Assets", () => {
    const source = sourceOf("features/app/app.ts");
    expect(source).not.toMatch(/\bAssets\s*\.\s*(load|init|loadBundle)\b/);
  });

  it("does not import the asset manager", () => {
    // The palette lock once loaded a lookup texture here, which is how this
    // boundary was first crossed. Its swatches are uniforms now, so the stage
    // loads nothing before the manifest is registered.
    const source = sourceOf("features/app/app.ts");
    expect(source).not.toMatch(/^import \{[^}]*\bAssets\b[^}]*\} from "pixi\.js";/m);
  });
});
