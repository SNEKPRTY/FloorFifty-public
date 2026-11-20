/**
 * Reading the client's test-only inspection hook.
 *
 * The gameplay screen installs `window.__ffInspect` only where visual
 * inspection is enabled, which is how the e2e client is built
 * (`VITE_VISUAL_INSPECTION=1` in the root `e2e:client` script). It answers the
 * three questions a capture cannot ask the DOM: which presentation profile the
 * scenery resolved to, what the ambient clock says, and how large the bounded
 * target came out.
 *
 * Nothing here writes. The hook returns primitives, so there is no route from a
 * reading back into the race -- see `features/render/inspection.ts`.
 */

import { expect, type Page } from "@playwright/test";

export type Inspection = Readonly<{
  profile: "legacy" | "aquarian";
  refraction: "menu" | "sky-only" | "sky+city" | "plain";
  citySampling: "nearest" | "linear" | null;
  clockSeconds: number;
  target: Readonly<{ width: number; height: number; pooled: number }> | null;
}>;

/**
 * One reading, or a failure if the hook is not there.
 *
 * The absence is asserted rather than returned as null, because "no hook" and
 * "a hook reporting nothing" are different problems: the first means the client
 * was built without inspection, and every assertion below it would pass
 * vacuously against a skipped check.
 */
export async function readInspection(page: Page): Promise<Inspection> {
  const value = await page.evaluate((): unknown => {
    const hook = (window as unknown as { __ffInspect?: () => unknown }).__ffInspect;
    return hook === undefined ? null : hook();
  });

  expect(value, "the visual inspection hook is not installed").not.toBeNull();
  return value as Inspection;
}

/** The app-level leak counters (`window.__ffCounts`), asserted present. */
export type LeakCounters = Readonly<{
  displayObjects: number;
  /** The world container's objects, the race's particle pool among them. */
  worldObjects: number;
  audioSources: number;
  /** Cues sounding, which end by themselves. */
  cues: number;
  previewSources: number;
  music: boolean;
  veilCanvases: number;
  glContexts: number;
  replaySimulations: number;
  /** Live timeouts and intervals (release readiness §9.3). */
  timers: number;
  /** Listeners on window and document (release readiness §9.3). */
  listeners: number;
}>;

export async function readCounters(page: Page): Promise<LeakCounters> {
  const value = await page.evaluate((): unknown => {
    const hook = (window as unknown as { __ffCounts?: () => unknown }).__ffCounts;
    return hook === undefined ? null : hook();
  });

  expect(value, "the leak counters are not installed").not.toBeNull();
  return value as LeakCounters;
}

/** The race's juice (`window.__ffJuice`): its live particles, and a switch that slams every racer. */
/** Samples the live particle count every frame until `during` settles; returns the highest seen. */
export async function peakParticlesDuring(page: Page, during: () => Promise<unknown>): Promise<number> {
  await page.evaluate(() => {
    const hook = (window as unknown as { __ffJuice?: () => { liveParticles: number } }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    const watch = window as unknown as { __ffPeakParticles: number; __ffPeakWatch: boolean };
    watch.__ffPeakParticles = 0;
    watch.__ffPeakWatch = true;
    const sample = (): void => {
      if (!watch.__ffPeakWatch) return;
      watch.__ffPeakParticles = Math.max(watch.__ffPeakParticles, hook().liveParticles);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await during();
  return page.evaluate(() => {
    const watch = window as unknown as { __ffPeakParticles: number; __ffPeakWatch: boolean };
    watch.__ffPeakWatch = false;
    return watch.__ffPeakParticles;
  });
}

/** Turns the juice's stress on or off: every racer slams every 100 ms, silently, holding the pool at its limit. */
export async function stressJuice(page: Page, on: boolean): Promise<void> {
  await page.evaluate((value: boolean) => {
    const hook = (window as unknown as { __ffJuice?: () => { stress: (on: boolean) => void } }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    hook().stress(value);
  }, on);
}

type WonderHook = () => { liveWords: number; setPiece: (floor: number) => boolean; widestWord: () => number };

/** Starts the stage's set piece at `floor` now (Wonder spec §6.4); false if the stage has none there. */
export async function forceSetPiece(page: Page, floor: number): Promise<boolean> {
  return page.evaluate((at: number) => {
    const hook = (window as unknown as { __ffJuice?: WonderHook }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    return hook().setPiece(at);
  }, floor);
}

/** The juice's particles on screen now. */
export async function liveParticles(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __ffJuice?: () => { liveParticles: number } }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    return hook().liveParticles;
  });
}

/** Pop-up words on screen now (Wonder spec §5). */
export async function liveWords(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __ffJuice?: WonderHook }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    return hook().liveWords;
  });
}

/** Every word at its largest in the page's language, at the beat size: the widest, in logical units (Wonder spec §8). */
export async function widestWord(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __ffJuice?: WonderHook }).__ffJuice;
    if (hook === undefined) throw new Error("the juice hook is not installed");
    return hook().widestWord();
  });
}
