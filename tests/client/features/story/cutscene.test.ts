/**
 * The cutscene player, the chapter card and the ending (story mode v2 criteria
 * 11's cutscene steps, 12 and 13), on fakes with an injected clock.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { CutscenePlayer, READ_MS, type CutscenePanelView } from "../../../../apps/client/src/features/story/cutscene";
import Cutscene from "../../../../apps/client/src/features/story/Cutscene.svelte";
import StoryFinale from "../../../../apps/client/src/features/story/StoryFinale.svelte";
import { after, startOf, type FlowStep } from "../../../../apps/client/src/features/story/story-flow";
import { heroLook } from "../../../../apps/client/src/features/story/story-run";
import { portraitAliasFor } from "../../../../apps/client/src/features/profile/character-art";
import { storyWithFakes } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { STORY } from "./support/story-bot";

const two = { panels: [{ lines: [{ text: "Hello there, climber." }, { text: "Up we go." }] }, { lines: [{ text: "The end." }] }] };

describe("the cutscene player's model", () => {
  it("types a line at 40 characters a second, a tick each third character, and never goes on by itself", () => {
    const player = new CutscenePlayer(two, false);
    expect(player.shown).toBe(0);
    expect(player.advance(250)).toBe(3); // 10 characters: ticks at 3, 6 and 9
    expect(player.shown).toBe(10);
    player.advance(60_000);
    expect(player.whole).toBe(true);
    expect(player.line).toBe(0);
    expect(player.panel).toBe(0);
    expect(player.done).toBe(false);
  });

  it("finishes the line on the first press and goes on with the next, then ends past the last", () => {
    const player = new CutscenePlayer(two, false);
    player.advance(100);
    player.press();
    expect(player.whole).toBe(true);
    expect(player.line).toBe(0);
    player.press();
    expect([player.panel, player.line, player.shown]).toEqual([0, 1, 0]);
    player.press();
    player.press();
    expect([player.panel, player.line]).toEqual([1, 0]);
    player.press();
    player.press();
    expect(player.done).toBe(true);
    expect(player.skipped).toBe(false);
  });

  it("ends on one skip", () => {
    const player = new CutscenePlayer(two, false);
    player.skip();
    expect(player.done).toBe(true);
    expect(player.skipped).toBe(true);
  });

  it("moves each panel over the time its lines take, and holds at the end", () => {
    const player = new CutscenePlayer(two, false);
    const span = (("Hello there, climber.".length + "Up we go.".length) / 40) * 1000 + 2 * READ_MS;
    player.advance(span / 2);
    expect(player.moveShare).toBeCloseTo(0.5);
    player.advance(span);
    expect(player.moveShare).toBe(1);
  });

  it("shows each line whole and holds the panel still under reduced motion", () => {
    const player = new CutscenePlayer(two, true);
    expect(player.whole).toBe(true);
    expect(player.advance(1000)).toBe(0);
    expect(player.moveShare).toBe(0);
    player.press();
    expect(player.line).toBe(1);
  });
});

describe("the story's order", () => {
  it("goes hub, cutscene, climb, results, the next cutscene, and after the last results the ending and the finale", () => {
    const steps: FlowStep[] = [];
    for (let step: FlowStep | undefined = { kind: "hub", focus: 0 }; step !== undefined; step = after(STORY, step)) steps.push(step);
    expect(steps.map((step) => step.kind)).toEqual(["hub", ...STORY.chapters.flatMap(() => ["cutscene", "climb", "results"]), "ending", "finale"]);
    expect(steps[1]).toEqual({ kind: "cutscene", cutscene: STORY.chapters[0]!.before, chapter: 0 });
    // "Play" on the hub opens the focused chapter's cutscene.
    expect(after(STORY, { kind: "hub", focus: 2 })).toEqual(startOf(STORY, 2));
    expect(steps.at(-2)).toEqual({ kind: "ending", cutscene: STORY.ending.cutscene });
    expect(startOf(STORY, 3)).toEqual({ kind: "cutscene", cutscene: STORY.chapters[3]!.before, chapter: 3 });
  });
});

describe("the player as the story draws them", () => {
  it("is never a friend's character or colour", () => {
    expect(heroLook({ characterId: "frog", colour: "cyan" }, STORY.actors)).toEqual({ characterId: "ninja", colour: "violet" });
    expect(heroLook({ characterId: "oni", colour: "scarlet" }, STORY.actors)).toEqual({ characterId: "ninja", colour: "violet" });
    expect(heroLook({ characterId: "knight", colour: "gold" }, STORY.actors)).toEqual({ characterId: "knight", colour: "gold" });
  });
});

/** A clock the test steps. */
function fakeClock() {
  const listeners = new Set<(ms: number) => void>();
  return {
    clock: (step: (ms: number) => void) => {
      listeners.add(step);
      return () => listeners.delete(step);
    },
    step(ms: number) {
      for (const listener of [...listeners]) listener(ms);
      flushSync();
    },
  };
}

const panels: CutscenePanelView[] = [
  {
    src: "/assets/story.one",
    move: { kind: "push", from: 1, to: 1.08 },
    glims: false,
    lines: [
      { text: "A long time ago, a tower stood." },
      { speaker: "Frog", colour: "cyan", portrait: "/assets/portrait.frog.win", text: "Look up!" },
    ],
  },
  { src: "/assets/story.two", move: { kind: "pan", from: 0, to: 1 }, glims: true, lines: [{ text: "The glims rose." }] },
];

describe("the cutscene on screen", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app !== undefined) void unmount(app);
    app = undefined;
    document.body.innerHTML = "";
  });

  function show(options: { reduced?: boolean; glims?: number; list?: CutscenePanelView[] } = {}) {
    const target = document.createElement("div");
    document.body.append(target);
    const time = fakeClock();
    const onDone = vi.fn();
    const onTick = vi.fn();
    app = mount(Cutscene, { target, props: { panels: options.list ?? panels, glims: options.glims ?? 0, clock: time.clock, reduced: options.reduced ?? false, onTick, onDone } });
    flushSync();
    const q = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const typed = () => q("story-cutscene-line")!.firstElementChild!.textContent;
    const click = (id: string) => {
      q(id)!.click();
      flushSync();
    };
    return { target, time, onDone, onTick, q, typed, click };
  }

  it("types the narrator's line with no name and no portrait, and a press finishes it, the next goes on", () => {
    const view = show();
    expect(view.q("story-cutscene")).not.toBeNull();
    view.time.step(100);
    expect(view.typed()).toBe("A lo");
    expect(view.q("story-cutscene-speaker")).toBeNull();
    expect(view.q("story-cutscene-portrait")).toBeNull();
    expect(view.q("story-cutscene-more")).toBeNull();
    view.click("story-cutscene-advance");
    expect(view.typed()).toBe("A long time ago, a tower stood.");
    expect(view.q("story-cutscene-more")).not.toBeNull();
    view.click("story-cutscene-advance");
    expect(view.q("story-cutscene-speaker")?.textContent).toBe("Frog");
    expect(view.q("story-cutscene-portrait")?.getAttribute("src")).toBe("/assets/portrait.frog.win");
    expect(view.onTick).toHaveBeenCalled();
  });

  it("never goes on by itself", () => {
    const view = show();
    for (let frame = 0; frame < 600; frame += 1) view.time.step(16);
    expect(view.typed()).toBe("A long time ago, a tower stood.");
    expect(view.q("story-cutscene-speaker")).toBeNull();
    expect(view.onDone).not.toHaveBeenCalled();
  });

  it("ends at once on Skip, and on Escape", () => {
    const view = show();
    view.click("story-cutscene-skip");
    expect(view.onDone).toHaveBeenCalledWith(true);
    void unmount(app!);
    const again = show();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    flushSync();
    expect(again.onDone).toHaveBeenCalledWith(true);
  });

  it("ends when its last line is read", () => {
    const view = show();
    for (let press = 0; press < 6; press += 1) view.click("story-cutscene-advance");
    expect(view.onDone).toHaveBeenCalledWith(false);
  });

  it("keeps the words when a panel's picture fails", () => {
    const view = show();
    const art = view.target.querySelector("img.ff-cutscene__art")!;
    art.dispatchEvent(new Event("error"));
    flushSync();
    expect(view.target.querySelector("img.ff-cutscene__art")).toBeNull();
    view.time.step(2000);
    expect(view.typed()).toBe("A long time ago, a tower stood.");
  });

  it("under reduced motion: the line shows whole, nothing pans or pushes", () => {
    const view = show({ reduced: true });
    expect(view.typed()).toBe("A long time ago, a tower stood.");
    expect(view.q("story-cutscene")!.classList.contains("ff-cutscene--still")).toBe(true);
    view.time.step(5000);
    expect(view.target.querySelector<HTMLElement>("img.ff-cutscene__art")!.style.transform).toBe("scale(1.0000)");
  });

  // Criterion 13: exactly as many rising glims as the save holds, 0 and 30 included.
  for (const count of [0, 1, 30]) {
    it(`raises ${count} glims over the glims' panel, and says so`, () => {
      const view = show({ glims: count, list: [panels[1]!] });
      expect(view.target.querySelectorAll('[data-testid="story-rising-glim"]')).toHaveLength(count);
      expect(view.q("story-glims-lit")?.textContent?.trim()).toBe(count === 1 ? "1 glim lit the morning" : `${count} glims lit the morning`);
    });
  }
});

describe("the finale", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app !== undefined) void unmount(app);
    app = undefined;
    document.body.innerHTML = "";
  });

  it("holds the thesis until a press, rolls the credits (a press speeds them), then Frog's last line and the way on", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const time = fakeClock();
    const onLast = vi.fn();
    const onPrimary = vi.fn();
    const onChapters = vi.fn();
    app = mount(StoryFinale, {
      target,
      props: {
        thesis: ["The best climbers look down.", "That is how they see who needs a hand."],
        songs: ["We Outside", "Moving On"],
        last: { speaker: "Frog", portrait: "/assets/frog", text: "Now let's race!" },
        art: "/assets/story.last",
        primaryLabel: "Race now",
        clock: time.clock,
        reduced: false,
        onLast,
        onPrimary,
        onChapters,
      },
    });
    flushSync();
    const q = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(q("story-thesis")?.textContent).toContain("The best climbers look down.");
    time.step(60_000);
    expect(q("story-thesis")).not.toBeNull();
    q("story-finale-advance")!.click();
    flushSync();
    const credits = q("story-credits")!;
    expect(credits.textContent).toContain("A game by SNEKPRTY");
    expect(credits.textContent).toContain("We Outside");
    expect(credits.textContent).toContain("Thank you for climbing.");
    time.step(4000);
    expect(q("story-credits")).not.toBeNull();
    // A press: four times as fast, so the rest of the 20 s takes 4 s.
    q("story-finale-advance")!.click();
    time.step(4100);
    expect(q("story-credits")).toBeNull();
    expect(onLast).toHaveBeenCalledTimes(1);
    expect(q("story-last")?.textContent).toContain("Now let's race!");
    q("story-race-now")!.click();
    q("story-chapters")!.click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onChapters).toHaveBeenCalledTimes(1);
  });
});

describe("the story screen's cutscenes", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on the chapter's cutscene, with its bed, before the climb", async () => {
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: 0, chapters: {} } }) });
    const cutscene = STORY.cutscenes.find((each) => each.id === STORY.chapters[0]!.before)!;
    expect(screen.query("story-cutscene")).not.toBeNull();
    expect(screen.screen.chapterIndex()).toBeUndefined();
    expect(screen.audio.calls).toContain(`bed:${cutscene.bed}`);
    screen.frames(30);
    expect(screen.query("story-cutscene-line")?.textContent).toContain(cutscene.panels[0]!.lines[0]!.text.slice(0, 5));
    screen.screen.exit();
  });

  it("shows the player's own portrait for You, drawn clear of Frog and Oni", async () => {
    const chapter = STORY.chapters.findIndex((each) =>
      STORY.cutscenes.find((cutscene) => cutscene.id === each.before)!.panels.some((panel) => panel.lines.some((line) => line.speaker === "you")),
    );
    const cutscene = STORY.cutscenes.find((each) => each.id === STORY.chapters[chapter]!.before)!;
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: chapter, chapters: {} }, profile: { lastCharacter: "oni", lastColour: "cyan" } }) });
    let mood: string | undefined;
    for (let press = 0; press < 40 && mood === undefined; press += 1) {
      if (screen.query("story-cutscene-speaker")?.textContent === "You") {
        screen.click("story-cutscene-advance");
        const text = screen.query("story-cutscene-line")!.textContent!.trim();
        const line = cutscene.panels.flatMap((panel) => panel.lines).find((each) => each.speaker === "you" && each.text === text)!;
        mood = line.mood ?? "neutral";
        break;
      }
      screen.click("story-cutscene-advance");
    }
    expect(mood).toBeDefined();
    const want = `/assets/${portraitAliasFor(GENERATED_CONTENT.content, "ninja", "violet", mood as "neutral")}`;
    expect(screen.query("story-cutscene-portrait")?.getAttribute("src")).toBe(want);
    screen.screen.exit();
  });

  it("stops the cutscene's clock while the pause is open", async () => {
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: 0, chapters: {} } }) });
    screen.frames(5);
    screen.screen.openMenu();
    screen.frames(1);
    expect(screen.query("pause-overlay")).not.toBeNull();
    const before = screen.query("story-cutscene-line")!.firstElementChild!.textContent;
    screen.frames(60);
    expect(screen.query("story-cutscene-line")!.firstElementChild!.textContent).toBe(before);
    screen.screen.exit();
  });

  it("puts the chapter card over the climb for 2.2 s, and a press ends it sooner", async () => {
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: 1, chapters: {} } }) });
    screen.click("story-cutscene-skip");
    // Never over a blank screen: the card and the HUD wait for the stage's first frames.
    await vi.waitFor(() => expect(screen.query("hud-floors")).not.toBeNull());
    expect(screen.query("story-card")).toBeNull();
    await vi.waitFor(() => {
      screen.frames(1);
      expect(screen.query("story-card")).not.toBeNull();
    });
    expect(screen.query("story-card")?.textContent).toContain("Chapter 2");
    expect(screen.query("story-card-title")?.textContent).toBe(STORY.chapters[1]!.title);
    expect(screen.audio.calls.some((call) => call.startsWith("cue:ui.title"))).toBe(true);
    screen.frames(60);
    expect(screen.query("story-card")).not.toBeNull();
    screen.frames(80);
    expect(screen.query("story-card")).toBeNull();
    screen.screen.exit();
  });

  it("ends the card on a press", async () => {
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: 0, chapters: {} } }) });
    screen.click("story-cutscene-skip");
    await vi.waitFor(() => {
      screen.frames(1);
      expect(screen.query("story-card")).not.toBeNull();
    });
    screen.key("ArrowRight", 32);
    expect(screen.query("story-card")).toBeNull();
    screen.screen.exit();
  });

  it("draws the hero clear of the friends in the climb too", async () => {
    const screen = await storyWithFakes({ settings: fakeSettings({ story: { chaptersDone: 0, chapters: {} }, profile: { lastCharacter: "frog", lastColour: "scarlet" } }) });
    screen.click("story-cutscene-skip");
    await vi.waitFor(() => expect(screen.screen.chapterIndex()).toBe(0));
    const run = screen.screen.run()!;
    expect(run.state.players[run.playerId]!.characterId).toBe("ninja");
    expect(run.state.players[run.playerId]!.colour).toBe("violet");
    screen.screen.exit();
  });
});
