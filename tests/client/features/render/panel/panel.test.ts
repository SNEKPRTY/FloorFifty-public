import { describe, expect, it, vi } from "vitest";
import type { Filter } from "pixi.js";
import { LCD_PANEL } from "../../../../../apps/client/src/lib/constants";
import { LetterboxFrame } from "../../../../../apps/client/src/features/platform/letterbox";
import { applyPanel, pulsePanelAberration, resizePanel } from "../../../../../apps/client/src/features/render/panel/panel";
// Static: the previous test empties the module registry, so a dynamic import
// here would reload the gameplay screen and every fake from cold inside this
// test's own budget (about a second on a quiet machine, several on a busy
// runner). The registry reset is the point of that test, not of this one.
import { gameplayWithFakeNetwork } from "../../../support/fakes/screens";
import { fakeStage } from "../../../support/fakes/stage";

/** The applied filter, widened to just the fields these assertions read. */
type AppliedPanel = {
  resources: {
    lcdUniforms: {
      uniforms: { uCellSize: number; uCells: number; uCyclesPerPixel: number; uFade: number };
    };
  };
  padding: number;
  resolution: number | "inherit";
  /** Pixi emits this from `Shader.destroy`, and exposes no `destroyed` getter. */
  on(event: "destroy", listener: () => void): unknown;
};

/**
 * The panel hanging off the scene, or a clear failure.
 *
 * `Filter["resources"]` is deliberately opaque, so reading a uniform back means
 * widening. Asserting the filter is there first keeps that cast honest and
 * keeps every failure below pointing at the assertion that failed rather than
 * at an undefined dereference.
 */
function appliedPanel(scene: { filters?: unknown }): AppliedPanel {
  const [filter] = (scene.filters ?? []) as (AppliedPanel | undefined)[];
  if (filter === undefined) throw new Error("no panel filter is applied");
  return filter;
}

describe("the LCD panel", () => {
  it("filters the scene when it is enabled", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, true);
    expect(frame.scene.filters).toHaveLength(1);
  });

  it("leaves the scene unfiltered when it is disabled", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, false);
    expect(frame.scene.filters).toEqual([]);
  });

  it("filters the scene rather than the layers bloom already filters", () => {
    // The panel is the screen the scene is displayed on, so it wraps bloom
    // rather than sitting beside it. Applying it to `world` would put the mesh
    // inside the camera transform and slide it as the player moves.
    const frame = new LetterboxFrame();
    applyPanel(frame, true);
    expect(frame.world.filters ?? []).toEqual([]);
    expect(frame.backdrop.filters ?? []).toEqual([]);
  });

  it("holds the scene's own children, so the bars stay outside the pass", () => {
    const frame = new LetterboxFrame();
    expect(frame.scene.children).toContain(frame.backdrop);
    expect(frame.scene.children).toContain(frame.root);
    expect(frame.scene.children).not.toContain(frame.bars);
  });

  it("re-derives the pitch for a new viewport", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, true);

    resizePanel(frame, 2.0, 1);
    const panel = appliedPanel(frame.scene);
    expect(panel.resources.lcdUniforms.uniforms.uCellSize).toBe(2.0);
    expect(panel.resources.lcdUniforms.uniforms.uCells).toBe(2);

    resizePanel(frame, 1.2, 1);
    expect(panel.resources.lcdUniforms.uniforms.uCells).toBe(3);
  });

  it("renders the pass at the renderer's own resolution", () => {
    // Pixi's default is a flat 1, which would draw the whole filtered subtree
    // -- the HUD with it -- into a texture at one texel per CSS pixel and
    // upscale it. Nothing here may rasterise more coarsely than the renderer.
    const frame = new LetterboxFrame();
    applyPanel(frame, true);
    expect(appliedPanel(frame.scene).resolution).toBe("inherit");
  });

  it("band-limits against device pixels rather than CSS ones", () => {
    // The fragment program runs once per device pixel. A 2x display draws the
    // same mesh with twice the samples, so the frequency the box filter and
    // the Nyquist fade see must halve -- while the mesh's size, `uCells` and
    // `uCellSize`, does not move at all.
    const frame = new LetterboxFrame();
    applyPanel(frame, true);

    resizePanel(frame, 1.333, 1);
    const panel = appliedPanel(frame.scene);
    const atOne = panel.resources.lcdUniforms.uniforms.uCyclesPerPixel;
    const cellsAtOne = panel.resources.lcdUniforms.uniforms.uCells;

    resizePanel(frame, 1.333, 2);
    expect(panel.resources.lcdUniforms.uniforms.uCyclesPerPixel).toBeCloseTo(atOne / 2, 6);
    expect(panel.resources.lcdUniforms.uniforms.uCells).toBe(cellsAtOne);
    expect(panel.resources.lcdUniforms.uniforms.uCellSize).toBe(1.333);
  });

  it("carries the Nyquist fade as a uniform rather than recomputing it in GLSL", () => {
    // It is constant across the frame, so the shader would only be keeping a
    // second copy of `derivePitch` to disagree with.
    const frame = new LetterboxFrame();
    applyPanel(frame, true);

    resizePanel(frame, 1.333, 1);
    expect(appliedPanel(frame.scene).resources.lcdUniforms.uniforms.uFade).toBe(1);

    // `minPitch` at the bottom of its range, on a display that cannot resolve
    // it: the mesh is removed rather than left to fold into a coarser pattern.
    applyPanel(frame, true, { ...LCD_PANEL, minPitch: 2.0 });
    resizePanel(frame, 2.0, 1);
    expect(appliedPanel(frame.scene).resources.lcdUniforms.uniforms.uFade).toBe(0);
  });

  it("releases the filter it replaces", () => {
    // `applyPanel` runs on every entry to gameplay, and the dispose bag calls
    // it again on the way out. A filter dropped without being destroyed leaves
    // its uniform buffers behind once per race.
    const frame = new LetterboxFrame();
    applyPanel(frame, true);

    const first = appliedPanel(frame.scene);
    let firstReleased = false;
    first.on("destroy", () => {
      firstReleased = true;
    });

    applyPanel(frame, true);
    expect(firstReleased).toBe(true);
    expect(appliedPanel(frame.scene)).not.toBe(first);

    const second = appliedPanel(frame.scene);
    let secondReleased = false;
    second.on("destroy", () => {
      secondReleased = true;
    });

    applyPanel(frame, false);
    expect(secondReleased).toBe(true);
    expect(frame.scene.filters).toEqual([]);
  });

  it("pads the pass by the widest tap, so the glow does not clip at the edge", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, true);
    resizePanel(frame, 2.0, 1);

    // glowRadius 1.5 logical units beats aberration 0.3, at 2 CSS px each.
    // CSS pixels, because that is the space a filter's bounds are measured in.
    expect(appliedPanel(frame.scene).padding).toBe(Math.ceil(LCD_PANEL.glowRadius * 2.0));
  });

  it("does nothing on resize when no panel is applied", () => {
    // The menus are never filtered, and a renderer that took the degrade path
    // has no filter either. Layout still runs in both cases.
    const frame = new LetterboxFrame();
    expect(() => resizePanel(frame, 2.0, 1)).not.toThrow();
    expect(frame.scene.filters ?? []).toEqual([]);
  });

  it("degrades to no panel rather than throwing when the shader cannot be built", async () => {
    // A full-screen filter is the most likely thing to cost frames on a low-end
    // phone, and a renderer that cannot compile one must still draw the game.
    //
    // The constructor is replaced through the module registry rather than
    // spied on: an ES module namespace is not configurable, so `vi.spyOn`
    // cannot redefine an export.
    vi.resetModules();
    const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
    vi.doMock("pixi.js", () => ({
      ...actual,
      GlProgram: class {
        constructor() {
          throw new Error("no webgl");
        }
      },
    }));

    const { applyPanel: applyFailingPanel } = await import(
      "../../../../../apps/client/src/features/render/panel/panel"
    );
    const { LetterboxFrame: Frame } = await import("../../../../../apps/client/src/features/platform/letterbox");

    const frame = new Frame();
    expect(() => applyFailingPanel(frame, true)).not.toThrow();
    expect(frame.scene.filters).toEqual([]);

    vi.doUnmock("pixi.js");
    vi.resetModules();
  });
});

describe("the panel's owner", () => {
  it("is the app, so a race neither replaces it nor takes it away", async () => {
    // Breaks if the race screen goes back to applying the panel itself: it
    // would swap in its own on entry and strip it on exit, which is exactly
    // how the menus and results came to be drawn without it.
    const stage = fakeStage();
    applyPanel(stage, true);
    const panel = (stage.scene.filters as readonly Filter[])[0];
    expect(panel).toBeDefined();

    const { screen } = await gameplayWithFakeNetwork({ stage });
    expect((stage.scene.filters as readonly Filter[])[0]).toBe(panel);

    await screen.exit();
    expect((stage.scene.filters as readonly Filter[])[0]).toBe(panel);
  });
});

describe("the panel's aberration pulse (A/V polish plan, G6)", () => {
  const aberration = (scene: { filters?: unknown }) =>
    (appliedPanel(scene).resources.lcdUniforms.uniforms as unknown as { uAberration: number }).uAberration;

  it("adds the pulse to the panel's own aberration, and settles back to it", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, true);
    pulsePanelAberration(frame, 1.2);
    expect(aberration(frame.scene)).toBeCloseTo(LCD_PANEL.aberration + 1.2, 9);
    pulsePanelAberration(frame, 0);
    expect(aberration(frame.scene)).toBeCloseTo(LCD_PANEL.aberration, 9);
  });

  it("does nothing with the panel off", () => {
    const frame = new LetterboxFrame();
    applyPanel(frame, false);
    expect(() => pulsePanelAberration(frame, 1)).not.toThrow();
    expect(frame.scene.filters ?? []).toHaveLength(0);
  });
});
