/**
 * The test-only visual inspection hook.
 *
 * Two claims, and the second is the reason the first is safe to make. The hook
 * must be absent unless it was asked for, because a production build that
 * exposed a live window handle onto the renderer would be shipping a debugging
 * seam to players. And what it exposes when it is present is a *reading* --
 * a profile name, a number of seconds, an allocated size -- rather than a
 * handle onto anything. There is no setter here, no reference to the clock, and
 * no route from the return value back into the race, which is what makes
 * "cannot mutate simulation or select winners" a property of the shape rather
 * than a promise in a comment.
 */

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import {
  countDisplayObjects,
  installInputInspection,
  installJuiceInspection,
  installLeakCounters,
  installVisualInspection,
  type VisualInspection,
} from "../../../../apps/client/src/features/render/inspection";

const reading = (): VisualInspection => ({
  profile: "aquarian",
  refraction: "sky-only",
  citySampling: "nearest",
  clockSeconds: 6.75,
  target: { width: 960, height: 540, pooled: 1_048_576 },
});

describe("the visual inspection hook", () => {
  it("installs a reader where inspection is enabled", () => {
    const remove = installVisualInspection(reading, { enabled: true });

    expect(window.__ffInspect?.()).toEqual(reading());

    remove();
    expect(window.__ffInspect).toBeUndefined();
  });

  it("installs nothing, and tears down quietly, where it is not enabled", () => {
    const remove = installVisualInspection(reading, { enabled: false });

    expect(window.__ffInspect).toBeUndefined();
    // A screen's teardown runs either way, so the release has to be safe on a
    // hook that was never installed.
    expect(() => remove()).not.toThrow();
    expect(window.__ffInspect).toBeUndefined();
  });

  it("does not clear a reader a later mount installed", () => {
    // Screens are exclusive but their teardown is not necessarily ordered
    // against the next mount's. A stale release that deleted the live reader
    // would leave the hook missing exactly when a capture wanted it.
    const remove = installVisualInspection(reading, { enabled: true });
    const later = (): VisualInspection => ({ ...reading(), clockSeconds: 1 });
    window.__ffInspect = later;

    remove();

    expect(window.__ffInspect).toBe(later);
    delete window.__ffInspect;
  });

  it("is idempotent, releasing once however many times it is called", () => {
    const remove = installVisualInspection(reading, { enabled: true });

    remove();
    remove();

    expect(window.__ffInspect).toBeUndefined();
  });

  it("reports an absent target rather than inventing a size for an unbounded path", () => {
    // A renderer that could not create the bounded target draws the scenery
    // unbounded. "No target" is the honest answer there, and a zeroed box
    // would read as a real allocation of nothing.
    const unbounded: VisualInspection = {
      profile: "legacy",
      refraction: "plain",
      citySampling: null,
      clockSeconds: 0,
      target: null,
    };
    const remove = installVisualInspection(() => unbounded, { enabled: true });

    expect(window.__ffInspect?.().target).toBeNull();

    remove();
  });
});

describe("the input inspection hook", () => {
  it("publishes the race's held intent and releases it once", () => {
    const host = {} as Window;
    const release = installInputInspection(() => ({ left: true, right: false, fastFall: false }), { target: host });
    expect(host.__ffInput?.()).toEqual({ left: true, right: false, fastFall: false });
    release();
    release();
    expect(host.__ffInput).toBeUndefined();
  });

  it("exposes nothing where inspection is off", () => {
    const host = {} as Window;
    installInputInspection(() => ({ left: false, right: false, fastFall: false }), { target: host, enabled: false });
    expect(host.__ffInput).toBeUndefined();
  });
});

describe("the leak counters", () => {
  it("counts every display object under the root, however deep", () => {
    const root = new Container();
    const layer = new Container();
    layer.addChild(new Container(), new Container());
    root.addChild(layer, new Container());

    // The root itself is not counted: an empty stage reads zero.
    expect(countDisplayObjects(new Container())).toBe(0);
    expect(countDisplayObjects(root)).toBe(4);
  });

  it("installs a live reader where inspection is enabled, and nothing where it is not", () => {
    let sources = 2;
    const counts = {
      displayObjects: 7,
      worldObjects: 3,
      cues: 0,
      previewSources: 0,
      music: false,
      veilCanvases: 0,
      glContexts: 0,
      replaySimulations: 0,
      timers: 1,
      listeners: 4,
    };
    const remove = installLeakCounters(() => ({ ...counts, audioSources: sources }), { enabled: true });
    expect(window.__ffCounts?.()).toEqual({ ...counts, audioSources: 2 });
    sources = 0;
    expect(window.__ffCounts?.().audioSources).toBe(0);
    remove();
    expect(window.__ffCounts).toBeUndefined();

    installLeakCounters(() => ({ ...counts, audioSources: 0 }), { enabled: false });
    expect(window.__ffCounts).toBeUndefined();
  });
});

describe("the juice inspection hook (polish spec §10.1)", () => {
  it("publishes the live particle count and the stress switch, and releases them once", () => {
    const host = {} as Window;
    let stressed = false;
    const release = installJuiceInspection(
      () => ({ liveParticles: 12, stress: (on: boolean) => (stressed = on), liveWords: 0, setPiece: () => false, widestWord: () => 0 }),
      { target: host },
    );
    expect(host.__ffJuice?.().liveParticles).toBe(12);
    host.__ffJuice?.().stress(true);
    expect(stressed).toBe(true);
    release();
    release();
    expect(host.__ffJuice).toBeUndefined();
  });

  it("exposes nothing where inspection is off", () => {
    const host = {} as Window;
    installJuiceInspection(
      () => ({ liveParticles: 0, stress: () => {}, liveWords: 0, setPiece: () => false, widestWord: () => 0 }),
      { target: host, enabled: false },
    );
    expect(host.__ffJuice).toBeUndefined();
  });

  it("publishes the words on screen, the widest word, and the set piece switch (Wonder spec §8)", () => {
    const host = {} as Window;
    const forced: number[] = [];
    const release = installJuiceInspection(
      () => ({
        liveParticles: 0,
        stress: () => {},
        liveWords: 3,
        setPiece: (floor: number) => (forced.push(floor), floor === 45),
        widestWord: () => 412,
      }),
      { target: host },
    );
    expect(host.__ffJuice?.().liveWords).toBe(3);
    expect(host.__ffJuice?.().widestWord()).toBe(412);
    expect(host.__ffJuice?.().setPiece(45)).toBe(true);
    expect(host.__ffJuice?.().setPiece(33)).toBe(false);
    expect(forced).toEqual([45, 33]);
    release();
  });
});
