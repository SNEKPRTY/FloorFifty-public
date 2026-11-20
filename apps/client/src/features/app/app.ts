/**
 * The Pixi application.
 *
 * Owns renderer creation, the two root containers every screen draws into, and
 * the letterbox that maps the fixed 960 x 540 logical world onto whatever
 * viewport the device actually has.
 */

import { startBarFade, stepBarFade, type BarFade } from "../platform/bar-fade";
import { Application, Container, Rectangle, TextureSource, type Filter, type WebGLRenderer } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { LCD_PANEL, LOGICAL_VIEWPORT } from "../../lib/constants";
import { DisposeBag } from "../../lib/dispose";
import { LetterboxFrame } from "../platform/letterbox";
import { CompositeTarget } from "../render/render-target";
import { BackdropTarget } from "../render/backdrop-target";
import { addRenderPass } from "../platform/render-order";
import { dropStaleFilterInputs } from "../render/filter-stack-guard";
import { createPaletteLockFilter } from "../render/filters/palette-lock";
import { createSceneBloomFilter, type SceneBloomFilter } from "../render/filters/scene-bloom";
import { applyPanel, pulsePanelAberration, resizePanel } from "../render/panel/panel";
import { panelOptionsFor, panelSuppressedFor } from "../render/panel/panel-options";
import { VISUAL_INSPECTION_ENABLED } from "../render/inspection";
import type { BackdropLease, StagePort, ViewportInfo } from "../render/stage-port";
import { bandForLayout, barHeightFor, bottomBarFor, writeBand, type BandMode } from "../platform/band";
import { classifyFormFactor } from "../platform/form-factor";
import { canvasResolutionFor } from "../platform/canvas-resolution";
import { isSoftwareRenderer, markRenderer, rendererName, softwareFrameCap } from "../platform/software-renderer";

export type PixiStage = StagePort & {
  readonly app: Application;
  /** Recomputes the letterbox. Called on resize and orientation change. */
  layout(): void;
  /** Turns the LCD panel on or off; the inspection suppression still wins. */
  setPanel(enabled: boolean): void;
  destroy(): void;
};

/**
 * Creates the renderer and the stage.
 *
 * Pixi 8 initialises asynchronously, so this is the one place in the client
 * that awaits a renderer; every screen is handed one that already exists.
 */
export async function createStage(host: HTMLElement, options: { lcdPanel?: boolean } = {}): Promise<PixiStage> {
  // Pixel art must never be filtered. Setting the default before any texture is
  // created is what keeps a sprite from being smoothed by whichever loader
  // happened to reach it first.
  TextureSource.defaultOptions.scaleMode = "nearest";

  const app = new Application();
  await app.init({
    // The page backdrop, not the sky. Anything outside the letterbox is a bar,
    // and a bar painted the colour of the sky does not read as one. The sky
    // itself is painted inside the frame, by `LetterboxFrame`. Resurrect 64's
    // black, as every black in the game is.
    background: roleTint("outline"),
    resizeTo: host,
    antialias: false,
    // WebGL rather than WebGPU: broad mobile support matters more here than
    // the newer backend. A browser with no WebGL makes this `init` throw, and
    // `boot()` then shows the boot failure panel ("cannot start", with Try
    // again) in place of the loader -- never a blank canvas.
    preference: "webgl",
    // Sharp on high-density displays without rendering at a fractional scale;
    // a tablet held upright draws at 1x to hold the frame budget. See
    // `canvas-resolution.ts`, and `layout()`, which keeps it current.
    resolution: canvasResolutionFor(
      classifyFormFactor(host.clientWidth, host.clientHeight),
      window.devicePixelRatio,
    ),
    autoDensity: true,
    // Tune GC via Application init options (ms) per PixiJS v8 best practices.
    gcActive: true,
    gcMaxUnusedTime: 60_000,
    gcFrequency: 30_000,
    // Floor Fifty handles accessibility and screen readers in Svelte 5 DOM overlays;
    // disable Pixi's default Tab interception to avoid competing shadow DOM focus overlays.
    accessibilityOptions: {
      activateOnTab: false,
    },
  });

  // A browser with no usable GPU draws WebGL on the CPU, where a frame costs
  // hundreds of milliseconds: it draws fewer, at half density (`software-renderer.ts`).
  // Known only once the context exists, so the resolution is corrected here.
  const software = isSoftwareRenderer(rendererName((app.renderer as WebGLRenderer).gl));
  markRenderer(document.documentElement, software);
  const cap = softwareFrameCap(software);
  if (cap !== null) {
    app.ticker.minFPS = cap.minFPS;
    app.ticker.maxFPS = cap.maxFPS;
    app.renderer.resize(app.renderer.width, app.renderer.height, canvasResolutionFor("desktop", 1, true));
  }

  // All UI and interactive controls are HTML/DOM overlays; disable Pixi's
  // EventSystem pointer hit-testing and tree traversals over the canvas.
  app.stage.eventMode = "none";
  app.stage.interactiveChildren = false;

  host.appendChild(app.canvas);

  const bag = new DisposeBag();

  // Owns the scaled, centred, clipped frame and the two containers screens
  // draw into. The mask is a sibling of the frame rather than a child, so the
  // frame's own transform never moves the clip out from under it.
  const frame = new LetterboxFrame();
  // Bars last, and outside the clipped frame: they are drawn in canvas pixels
  // so they can reach the screen edge on a viewport that is not 16:9.
  //
  // One layer for the panel to hang from, and the bars outside it. The mask
  // moved inside `scene` with the layers it clips.
  //
  // `glow` is the scene's own parent, for the bloom to hang from. The bloom
  // was on `app.stage`, which put the bars under it: they are opaque, but a
  // glow is added over whatever is beneath it, and the light off the sky's
  // edge spread onto them. With the bars drawn after the bloomed layer, the
  // glow that spills past the frame is covered by the bars rather than
  // painted on them.
  const glow = new Container();
  glow.label = "glow";
  glow.addChild(frame.scene);
  // `front` after the bars: the flash and the lava reach every edge of the screen.
  app.stage.addChild(glow, frame.bars, frame.front);
  bag.add(() => frame.destroy());

  // The world and the HUD draw into a fixed 960 x 540 target at resolution 1,
  // and the letterbox shows that target's sprite rather than the layers
  // themselves. The backdrop stays where it is: it is deliberately unclipped,
  // and a 960 x 540 target would bound it to the rectangle it exists to escape.
  const composite = new CompositeTarget();
  composite.adopt(frame);
  bag.add(() => composite.destroy());

  // The composite pass runs ahead of the application's own render, which runs
  // at UPDATE_PRIORITY.LOW, so the sprite is never a frame behind (see
  // `render-order.ts`). `composite.stage` is not a child of `app.stage`, so it
  // is rendered here and nowhere else.
  bag.add(
    addRenderPass(app.ticker, "composite", () => {
      app.renderer.render({ container: composite.stage, target: composite.sprite.texture });
    }),
  );

  /**
   * Bounded scenery targets a screen is currently borrowing.
   *
   * At most one is expected -- a screen shows one backdrop -- but the set is
   * kept as a set rather than a single slot so a screen that mounts twice by
   * mistake renders twice rather than silently orphaning the first target.
   */
  const backdropLeases = new Set<{ render(): void; target: BackdropTarget }>();

  // After the screen has updated its scenery and before the world composite
  // (see `render-order.ts`), so the frame the app renders afterwards already
  // contains this pass. A second ticker would race the gameplay clock; a
  // priority is the same effect without a second clock.
  bag.add(
    addRenderPass(app.ticker, "backdrop", () => {
      for (const lease of backdropLeases) lease.render();
    }),
  );

  // Two instances, not one shared filter: a Pixi filter carries per-target
  // render state, and the two layers are different targets.
  //
  // The backdrop needs its own because it is not in the composite -- see
  // `CompositeTarget.adopt` -- so the composite's chain never sees it.
  // Without a second instance the scenery would reach the canvas
  // unquantized, and the palette guarantee would hold over the racers and not
  // over two thirds of the picture. Each lock searches all 64 swatches per
  // pixel, which makes it one of the dearer passes per pixel, not the
  // cheapest; paying for it twice is still what makes the claim true.
  // (Gameplay's crisp city takes a third, through `createPaletteLock`, because
  // it is drawn outside the sky's target.) The swatches are uniforms built from
  // the asset contract, so there is no lookup to load first, and nothing here
  // reaches Pixi's `Assets` (see `stage-assets.test.ts`).
  composite.setFilters([createPaletteLockFilter()]);
  frame.backdrop.filters = [createPaletteLockFilter()];

  // Bloom over the whole canvas but the bars, on every screen, and last: after the palette
  // locks, so the glow is light off the palette rather than folded onto it,
  // and after the LCD panel, so the panel's cells glow as a lit screen does.
  // On `glow` rather than `scene` because the panel owns `scene`'s chain, and
  // rather than `app.stage` so the bars stay out of it (see `glow`).
  // A program that will not build costs the glow and nothing else.
  let bloom: SceneBloomFilter | undefined;
  try {
    bloom = createSceneBloomFilter();
    glow.filters = [bloom];
  } catch {
    bloom = undefined;
  }
  bag.add(() => {
    glow.filters = [];
    bloom?.destroy();
  });

  // The bars' black, 1 true and 0 the palette's, and where it is headed.
  // Faded on the ticker rather than in CSS: the bars are canvas.
  let bandMode: BandMode = "menu";
  let barBlack = 0;
  let barFade: BarFade | undefined;
  // Said on the canvas while a fade runs, so a screenshot can wait for the
  // bars to settle instead of catching them half way.
  const markBarFade = (running: boolean): void => {
    if (running) app.canvas.dataset["barsFade"] = "running";
    else delete app.canvas.dataset["barsFade"];
  };
  const fadeBars = (): void => {
    if (barFade === undefined) return;
    const step = stepBarFade(barFade, app.ticker.deltaMS);
    barBlack = step.value;
    frame.setBarBlack(barBlack);
    barFade = step.done ? undefined : step.fade;
    if (step.done) markBarFade(false);
  };
  app.ticker.add(fadeBars);
  bag.add(() => app.ticker.remove(fadeBars));

  /** HTML controls that sit above the canvas: menus, touch buttons, errors. */
  const overlay = document.createElement("div");
  overlay.className = "ff-overlay";
  overlay.dataset["testid"] = "overlay";
  host.appendChild(overlay);
  bag.add(() => overlay.remove());

  /** CSS pixels per logical unit. Re-derived on every layout. */
  let cellSize = 1;

  /**
   * The layout, published rather than left for each screen to recompute.
   *
   * Seeded from the canvas as it stands so a screen that reads it before the
   * first layout gets the real shape of the display rather than zeroes.
   */
  let viewport: ViewportInfo = {
    canvasCss: { x: 0, y: 0, width: app.renderer.width, height: app.renderer.height },
    gameplayCss: { x: 0, y: 0, width: app.renderer.width, height: app.renderer.height },
    sceneryLogical: {
      x: 0,
      y: 0,
      width: LOGICAL_VIEWPORT.width,
      height: LOGICAL_VIEWPORT.height,
    },
    portrait: app.renderer.height > app.renderer.width,
    formFactor: classifyFormFactor(app.renderer.width, app.renderer.height),
    fieldLogical: { width: LOGICAL_VIEWPORT.width, height: LOGICAL_VIEWPORT.height },
    pixelRatio: app.renderer.resolution,
  };

  const viewportListeners = new Set<(value: ViewportInfo) => void>();

  // The visual-inspection suppression wins over the player's panel setting,
  // so evidence captures stay comparable whatever a device has stored.
  const panelSuppressed = panelSuppressedFor(window.location.search, VISUAL_INSPECTION_ENABLED);
  const panelOptions = panelOptionsFor(window.location.search, import.meta.env.DEV);
  // The first application runs before the first layout, which primes its
  // pitch; every later one re-lays out to prime the new filter.
  let panelPrimed = false;

  const stage: PixiStage = {
    app,
    webgl: (app.renderer as WebGLRenderer).gl,
    scene: frame.scene,
    get cellSize() {
      return cellSize;
    },
    get pixelRatio() {
      return app.renderer.resolution;
    },
    get viewport() {
      return viewport;
    },
    onViewportChange(listener) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
    setBloomBand(band) {
      bloom?.setBand(band);
    },
    setBloomLook(look) {
      bloom?.setLook(look);
    },
    setBloomPulse(pulse) {
      bloom?.setPulse(pulse);
    },
    setSkirtLine(line) {
      frame.setSkirtLine(line);
    },
    setBandMode(mode) {
      if (mode === bandMode) return;
      bandMode = mode;
      stage.layout();
      // The viewport tracker tiers the height by the mode, and re-reads on a resize.
      window.dispatchEvent(new Event("resize"));
    },
    setBarsBlack(black, fadeMs = 0) {
      const to = black ? 1 : 0;
      if (fadeMs <= 0) {
        barFade = undefined;
        markBarFade(false);
        barBlack = to;
        frame.setBarBlack(to);
        return;
      }
      barFade = startBarFade(barBlack, to, fadeMs);
      markBarFade(true);
    },
    canvas() {
      return app.canvas;
    },
    createPaletteLock() {
      return createPaletteLockFilter();
    },
    mountBackdrop(source: Container): BackdropLease {
      const target = new BackdropTarget(app.renderer, source, viewport.sceneryLogical);

      // Recorded rather than assumed: the field is always in here, and a screen
      // that replaced the backdrop's filters must not leave them behind for the
      // next screen's scenery. Copied, because Pixi hands back a readonly array
      // and the restore has to assign one.
      const borrowed = frame.backdrop.filters;
      const previousFilters: Filter[] | null | undefined =
        borrowed === null || borrowed === undefined ? borrowed : [...borrowed];
      frame.backdrop.addChild(target.output);

      const entry = { render: (): void => target.render(), target };
      backdropLeases.add(entry);

      let released = false;
      return {
        filterRoot: target.filterRoot,
        get logicalRect() {
          return target.logicalRect;
        },
        get targetSize() {
          return target.targetSize;
        },
        get pooledCapacity() {
          return target.pooledCapacity;
        },
        // Idempotent, and it puts the backdrop back the way it found it: the
        // output sprite is removed by the target's own destroy, and the filters
        // are restored here because the screen borrowed them, not the target.
        destroy() {
          if (released) return;
          released = true;
          backdropLeases.delete(entry);
          target.destroy();
          frame.backdrop.filters = previousFilters;
        },
      };
    },
    field: frame.field,
    backdrop: frame.backdrop,
    world: frame.world,
    ui: frame.ui,
    effects: frame.effects,
    front: frame.front,
    overlay,
    get screenWidth() {
      return LOGICAL_VIEWPORT.width;
    },
    /** The play field's height: taller on the portrait form factors (D-R1). */
    get screenHeight() {
      return viewport.fieldLogical.height;
    },
    layout() {
      // A rotation can move the canvas between form factors that draw at
      // different resolutions (a tablet held upright draws at 1x). Resized in
      // place, at the same CSS size, before anything reads the resolution.
      const resolution = canvasResolutionFor(
        classifyFormFactor(app.renderer.width, app.renderer.height),
        window.devicePixelRatio,
        software,
      );
      if (app.renderer.resolution !== resolution) {
        app.renderer.resize(app.renderer.width, app.renderer.height, resolution);
      }

      frame.setCutLine(bandMode === "field");
      const box = frame.layout(app.renderer.width, app.renderer.height);
      // The composite is the field's size, before anyone is told the layout.
      composite.resize(box.fieldHeight);

      cellSize = box.scale;

      // Pins the pass to the canvas. Without this the filter is sized to the
      // scene's bounds, which change every time a player moves, and the mesh
      // would crawl across the screen with them.
      frame.scene.filterArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);
      // The bloom is pinned to the canvas for the same reason, and its radius
      // is authored in logical units, so it is told what one is in pixels.
      glow.filterArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);
      bloom?.setPixelsPerUnit(cellSize * app.renderer.resolution);
      bloom?.setLetterbox({
        x: box.x,
        y: box.y,
        scale: box.scale,
        canvasWidth: app.renderer.width,
        canvasHeight: app.renderer.height,
      });

      // The backdrop's chain needs the same pin, and for a sharper reason: the
      // sky pass paints every pixel the backdrop has not drawn on, and a
      // filter's default area is the container's own bounds. Left unpinned,
      // the sky would only reach the rectangle the parallax sprites happen to
      // occupy and would slide around as they scrolled.
      //
      // In the backdrop's OWN coordinates, not the canvas's. `scene` carries no
      // transform so the two agree there; the backdrop is scaled and offset by
      // the letterbox, so a canvas-sized rectangle here is a canvas-sized
      // rectangle *scaled again*. At desktop's 1.33 that over-covers and looks
      // correct; at portrait's 0.53 it covered half the screen and left the
      // rest black. This is the same rectangle `field` is drawn with, for the
      // same reason.
      frame.backdrop.filterArea = new Rectangle(
        -box.x / box.scale,
        -box.y / box.scale,
        app.renderer.width / box.scale,
        app.renderer.height / box.scale,
      );

      // `box.scale` is CSS pixels per logical unit, which is the size of the
      // cell the mesh is anchored to; the renderer's resolution is how many
      // device pixels that cell is actually drawn with. The pass needs both.
      resizePanel(stage, cellSize, app.renderer.resolution);

      // The overlay tracks the same geometry, so HTML controls line up with
      // drawn ones at every viewport.
      overlay.style.width = `${box.width}px`;
      overlay.style.height = `${box.height}px`;
      overlay.style.left = `${box.x}px`;
      overlay.style.top = `${box.y}px`;

      // Published so DOM UI scales with the canvas instead of drifting at
      // viewports where the two would otherwise diverge.
      overlay.style.setProperty("--ff-scale", String(box.scale));

      // The bottom letterbox bar, in viewport pixels, for DOM that sits in it
      // (the menu's tagline). Taken from the same numbers that draw the bar,
      // so the text cannot drift off it at an odd aspect ratio.
      //
      // `roomy` only where the bar can comfortably hold a line of text. Portrait draws
      // no bars, and a canvas wider than 16:9 crops the field so far that the
      // bar is a sliver; DOM that would sit in it goes elsewhere there.
      const barTop = box.gameplay.y + box.gameplay.height;
      const barHeight = barHeightFor(bandMode, box.portrait, app.renderer.height, barTop);
      overlay.style.setProperty("--ff-bar-top", `${barTop}px`);
      overlay.style.setProperty("--ff-bar-height", `${barHeight}px`);
      const phoneLandscape = classifyFormFactor(app.renderer.width, app.renderer.height) === "phone-landscape";
      overlay.dataset["bottomBar"] = bottomBarFor(bandMode, barHeight, phoneLandscape);

      // The band between the bars, for everything laid over the game (UI
      // layout system spec §4.1). On <html> rather than the overlay: the
      // screens and the modal are fixed layers that are not all inside it.
      writeBand(document.documentElement, bandForLayout(box, app.renderer.height, bandMode), bandMode);

      // Published last, and only once every derived value is final: a listener
      // that reads `stage.cellSize` or `stage.pixelRatio` in response must see
      // this layout's numbers rather than the previous one's.
      viewport = {
        canvasCss: { x: 0, y: 0, width: app.renderer.width, height: app.renderer.height },
        gameplayCss: box.gameplay,
        sceneryLogical: box.scenery,
        portrait: box.portrait,
        formFactor: classifyFormFactor(app.renderer.width, app.renderer.height),
        fieldLogical: { width: LOGICAL_VIEWPORT.width, height: box.fieldHeight },
        pixelRatio: app.renderer.resolution,
      };

      // An active scenery target is re-fitted before anyone is told about the
      // new layout, so a listener that reads `lease.targetSize` sees the size
      // that matches the viewport it was just handed.
      for (const lease of backdropLeases) lease.target.resize(box.scenery);

      for (const listener of viewportListeners) listener(viewport);

      // Last, after anything above that resized the renderer: the resize has
      // just destroyed textures a Pixi filter slot may still point at, and the
      // plugin renders synchronously once this returns. See the guard.
      dropStaleFilterInputs(app.renderer);
    },
    setPanel(enabled: boolean) {
      applyPanel(stage, enabled && !panelSuppressed, panelOptions);
      if (panelPrimed) stage.layout();
    },
    setPanelAberration(extra: number) {
      pulsePanelAberration(stage, extra);
    },
    destroy() {
      // Release any scenery target still mounted. A screen that failed to exit
      // would otherwise leave a screen-sized texture alive through the app's
      // own teardown, which is the leak the ownership rule exists to prevent.
      for (const lease of [...backdropLeases]) lease.target.destroy();
      backdropLeases.clear();
      bag.dispose();
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    },
  };

  // The LCD panel covers the whole game -- menus, race and results -- so it is
  // the app's, applied once for the life of the tab rather than by a screen.
  // Before the first layout, so that layout primes its pitch.
  // The player's setting decides it (launch polish §3.1.2), and `setPanel`
  // switches it live.
  stage.setPanel(options.lcdPanel ?? LCD_PANEL.enabled);
  panelPrimed = true;
  bag.add(() => applyPanel(stage, false));

  stage.layout();
  app.renderer.on("resize", () => stage.layout());
  bag.add(() => app.renderer.off("resize"));

  // `resizeTo` listens to `window.resize` and nothing else, and a browser's
  // bar or keyboard can change the host's size without one: measured on
  // Android, the canvas stayed at the keyboard-open height (490 of a 802 px
  // page) after the keyboard closed. The host's own size is the thing the
  // canvas has to match, so it is watched directly. `queueResize` batches to
  // a frame and re-reads the host, so a spurious call costs one layout.
  const queueResize = (): void => app.queueResize();
  const hostSize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(queueResize);
  hostSize?.observe(host);
  window.visualViewport?.addEventListener("resize", queueResize);
  bag.add(() => {
    hostSize?.disconnect();
    window.visualViewport?.removeEventListener("resize", queueResize);
  });

  return stage;
}
