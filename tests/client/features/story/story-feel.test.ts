/**
 * Sound off and reduced motion (story mode v2 criteria 18 and 19): every row
 * of the feel table has a cue a player sees, drawn by the scene's dust, the
 * story layer or the story HUD, and reduced motion takes the motion away but
 * never the cue.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { STORY_FEEL, StoryFeel, feelOf, glimRate, type FeelKind, type SeenCue } from "../../../../apps/client/src/features/story/story-feel";
import { StoryLayer } from "../../../../apps/client/src/features/story/story-layer";
import { StoryHudView } from "../../../../apps/client/src/features/story/story-hud.svelte";
import { StoryRun } from "../../../../apps/client/src/features/story/story-run";
import type { StoryEvent } from "../../../../apps/client/src/features/story/director";
import type { StoryFeelMoment } from "../../../../apps/client/src/features/race/race-scene";
import { fakeSettings } from "../../support/fakes/settings";
import { STORY, chapterNamed } from "./support/story-bot";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";

const at = { x: 300, y: 500 };
/** One event of each kind the feel table answers. */
const EVENTS: Record<FeelKind, StoryEvent> = {
  glim: { kind: "glim", index: 0, at, streak: 3 },
  lampOpen: { kind: "lampOpen", floor: 0, at },
  lampRattle: { kind: "lampRattle", floor: 0 },
  quake: { kind: "quake", strength: 1 },
  rescue: { kind: "rescue", actor: "frog", at },
  safeSpot: { kind: "safeSpot", floor: 2, at },
  gustWarning: { kind: "gustWarning", direction: 1 },
  lavaClose: { kind: "lavaClose" },
  caught: { kind: "caught" },
  done: { kind: "done" },
  placed: { kind: "placed", actor: "frog", at },
};

function feelWith() {
  const moments: StoryFeelMoment[] = [];
  const cues: { alias: string; rate?: number; delayMs?: number }[] = [];
  const feel = new StoryFeel({
    play: (moment) => moments.push(moment),
    cue: (alias, options) => cues.push({ alias, ...options }),
    player: () => ({ x: 10, y: 20 }),
    floorsOnScreen: () => [
      { x: 100, y: 0 },
      { x: 200, y: 128 },
      { x: 300, y: 257 },
    ],
  });
  return { feel, moments, cues };
}

const revisions = { contentRevision: asRevision("c".repeat(64)), rulesetRevision: asRevision("r".repeat(64)) };
const idle = { left: false, right: false, fastFall: false, reset: false };
function runOf(id: string): StoryRun {
  return new StoryRun({ chapter: chapterNamed(id), actors: STORY.actors, tuning: GENERATED_CONTENT.content.baseTuning, revisions, sample: () => idle, names: { you: "You", actor: (actor) => actor } });
}

describe("the feel table", () => {
  it("answers every story event that has a row, and only those", () => {
    for (const kind of Object.keys(STORY_FEEL) as FeelKind[]) expect(feelOf(EVENTS[kind])).toBe(kind);
    expect(feelOf({ kind: "say", moment: 0, lines: [] })).toBeUndefined();
    expect(feelOf({ kind: "lookAt", actor: "frog", ticks: 10 })).toBeUndefined();
  });

  it("plays each row's dust, hit-stop, kick, shake and punch through the scene, and its sounds through the mixer", () => {
    for (const kind of Object.keys(STORY_FEEL) as FeelKind[]) {
      const { feel, moments, cues } = feelWith();
      feel.play([EVENTS[kind]]);
      const row = STORY_FEEL[kind];
      expect(cues.map((cue) => cue.alias), kind).toEqual(row.cues.map((cue) => cue.alias));
      if ("dust" in row) expect(moments.some((moment) => moment.dust !== undefined), kind).toBe(true);
      if ("hitStopMs" in row) expect(moments.some((moment) => moment.hitStopMs === row.hitStopMs), kind).toBe(true);
      if ("shake" in row) expect(moments.some((moment) => (moment.shake ?? 0) > 0), kind).toBe(true);
    }
  });

  it("throws the quake's dust off every floor in sight, and a full quake stops the picture a beat", () => {
    const { feel, moments } = feelWith();
    feel.play([{ kind: "quake", strength: 1 }]);
    expect(moments.filter((moment) => moment.dust !== undefined)).toHaveLength(3);
    expect(moments.some((moment) => moment.hitStopMs === 80)).toBe(true);
    const soft = feelWith();
    soft.feel.play([{ kind: "quake", strength: 0.5 }]);
    expect(soft.moments.some((moment) => moment.hitStopMs !== undefined)).toBe(false);
    expect(soft.moments.find((moment) => moment.shake !== undefined)?.shake).toBeCloseTo(0.4);
  });

  it("raises the glim's pop for each glim in a row, up to a cap", () => {
    expect(glimRate(1)).toBe(1);
    expect(glimRate(4)).toBeCloseTo(1.18);
    expect(glimRate(40)).toBe(1.6);
    const { feel, cues } = feelWith();
    feel.play([{ kind: "glim", index: 0, at, streak: 4 }]);
    expect(cues[0]!.rate).toBeCloseTo(1.18);
  });
});

describe("with the sound off (criterion 18)", () => {
  let hud: StoryHudView | undefined;
  afterEach(() => {
    hud?.destroy();
    hud = undefined;
    document.body.innerHTML = "";
  });

  /** Mounts the story HUD on its own. */
  function mountHud(): HTMLElement {
    const target = document.createElement("div");
    document.body.append(target);
    hud = new StoryHudView(target, { prompts: STORY.prompts, settings: fakeSettings() });
    return target;
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** What a player sees for each cue, checked on the piece that draws it. */
  const SEEN: Record<SeenCue, (reduced: boolean) => Promise<void> | void> = {
    glimFlies: async (reduced) => {
      const target = mountHud();
      hud!.flyGlim({ left: 10, top: 10 }, reduced);
      await flush();
      // The flight lands at once where nothing animates, and the counter takes the glim.
      expect(hud!.current().glimPops).toBe(1);
      expect(target.querySelector('[data-testid="story-glims"]')).not.toBeNull();
    },
    lampBursts: (reduced) => expect(layerAfter({ kind: "lampOpen", floor: 0, at }, reduced).liveRings).toBe(1),
    lampBlinks: (reduced) => {
      const run = runOf("city");
      const root = new Container();
      const layer = new StoryLayer(root, chapterNamed("city"));
      layer.frame({ state: run.state, director: run.director, events: [], deltaMs: 16, reduced });
      const lamp = root.children.find((child) => child.label === "story-lamp")!;
      const restX = lamp.position.x;
      const floor = chapterNamed("city").lamps![0]!;
      let moved = false;
      let blinked = false;
      for (let frame = 0; frame < 20; frame += 1) {
        layer.frame({ state: run.state, director: run.director, events: frame === 0 ? [{ kind: "lampRattle", floor }] : [], deltaMs: 16, reduced });
        if (lamp.position.x !== restX) moved = true;
        if ((lamp.children[1] as Graphics).alpha < 1) blinked = true;
      }
      expect(reduced ? blinked : moved).toBe(true);
      expect(reduced ? moved : false).toBe(false);
      layer.destroy();
    },
    floorsDust: () => {
      const { feel, moments } = feelWith();
      feel.play([{ kind: "quake", strength: 1 }]);
      expect(moments.filter((moment) => moment.dust !== undefined).length).toBeGreaterThan(0);
    },
    rescueBurst: (reduced) => expect(layerAfter({ kind: "rescue", actor: "frog", at }, reduced).liveRings).toBe(1),
    safeRing: async (reduced) => {
      expect(layerAfter({ kind: "safeSpot", floor: 2, at }, reduced).liveRings).toBe(1);
      const target = mountHud();
      hud!.safeSpot();
      await flush();
      expect(target.querySelector('[data-testid="story-safe-spot"]')?.textContent).toBe("Safe spot");
    },
    windChip: async () => {
      const target = mountHud();
      hud!.setWind({ direction: -1, blowing: false });
      await flush();
      expect(target.querySelector('[data-testid="story-wind"]')?.textContent).toContain("←");
      hud!.setWind({ direction: -1, blowing: true });
      await flush();
      expect(target.querySelector('[data-testid="story-streaks"]')).not.toBeNull();
    },
    lavaGlow: async () => {
      const target = mountHud();
      hud!.lavaClose();
      await flush();
      expect(target.querySelector('[data-testid="story-lava-glow"]')).not.toBeNull();
    },
    // The race's own "OUT!" banner, which the screen shows from the run's `out` (story.test.ts plays a catch).
    outBanner: () => expect(STORY_FEEL.caught.seen).toBe("outBanner"),
    finishBurst: () => {
      const { feel, moments } = feelWith();
      feel.play([{ kind: "done" }]);
      expect(moments[0]!.dust?.count).toBeGreaterThan(0);
    },
    spawnBurst: () => {
      const { feel, moments } = feelWith();
      feel.play([{ kind: "placed", actor: "frog", at }]);
      expect(moments[0]!.dust?.count).toBeGreaterThan(0);
    },
  };

  function layerAfter(event: StoryEvent, reduced: boolean): StoryLayer {
    const run = runOf("deep");
    const layer = new StoryLayer(new Container(), chapterNamed("deep"));
    layer.frame({ state: run.state, director: run.director, events: [event], deltaMs: 16, reduced });
    return layer;
  }

  for (const kind of Object.keys(STORY_FEEL) as FeelKind[]) {
    const seen = STORY_FEEL[kind].seen;
    it(`shows ${kind} as ${seen}`, async () => {
      await SEEN[seen](false);
    });
    it(`still shows ${kind} as ${seen} under reduced motion (criterion 19)`, async () => {
      await SEEN[seen](true);
    });
  }

  it("points the way down when the friend is below: the dive's direction is drawn, not heard", async () => {
    const target = mountHud();
    hud!.setPointer({ direction: "down", floors: 3, left: 100 });
    await flush();
    const pointer = target.querySelector<HTMLElement>('[data-testid="story-pointer"]')!;
    expect(pointer.dataset["direction"]).toBe("down");
    expect(pointer.textContent).toContain("3 floors");
  });
});

describe("reduced motion (criterion 19)", () => {
  it("keeps the glims and the help mark still", () => {
    const run = runOf("deep");
    const root = new Container();
    const layer = new StoryLayer(root, chapterNamed("deep"));
    const glim = root.children.find((child) => child.label === "story-glim")!;
    const ys = new Set<number>();
    for (let frame = 0; frame < 60; frame += 1) {
      layer.frame({ state: run.state, director: run.director, events: [], deltaMs: 50, reduced: true });
      ys.add(glim.position.y);
    }
    expect(ys.size).toBe(1);
    const moving = new Set<number>();
    for (let frame = 0; frame < 60; frame += 1) {
      layer.frame({ state: run.state, director: run.director, events: [], deltaMs: 50, reduced: false });
      moving.add(glim.position.y);
    }
    expect(moving.size).toBeGreaterThan(1);
    layer.destroy();
  });

  it("stops the HUD's slides, streaks and springs in its stylesheet, and keeps every word", () => {
    const source = readFileSync(resolve(__dirname, "../../../../apps/client/src/features/story/StoryHud.svelte"), "utf8");
    const reduced = source.slice(source.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".ff-story-hud__streaks span");
    expect(reduced).toContain("animation: none");
    expect(reduced).not.toMatch(/display:\s*none/);
  });
});
