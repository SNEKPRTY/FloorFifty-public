import { afterEach, describe, expect, it, vi } from "vitest";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import { JuiceDirector } from "../../../../apps/client/src/features/race/juice/juice-director";
import { RaceScene } from "../../../../apps/client/src/features/race/race-scene";
import { FakeAudio } from "../../support/fakes/audio";
import { fakeContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork, storyWithFakes } from "../../support/fakes/screens";
import type { SettingsPatch } from "../../../../apps/client/src/features/profile/settings";
import { fakeSettings } from "../../support/fakes/settings";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { storyBot, type BotOptions } from "./support/story-bot";
import { AFTER_DONE_TICKS } from "../../../../apps/client/src/features/story/story";
import type { StoryHudModel } from "../../../../apps/client/src/features/story/story-hud.svelte";

const story = GENERATED_CONTENT.content.story;
/** Settings that start the story from nothing: the fake store shares the page's localStorage, so a test names what it needs. */
const fresh = (patch: SettingsPatch = {}) =>
  fakeSettings({ ...patch, story: { chaptersDone: 0, ...patch.story }, seen: { tutorial: false, ...patch.seen } });
type Story = Awaited<ReturnType<typeof storyWithFakes>>;

/** Hands the chapter on screen to the bot, and plays until it ends (or `each` says stop), calling `each` every frame. */
function playChapter(screen: Story, each?: (model: StoryHudModel) => boolean | void, options?: BotOptions): void {
  const at = screen.screen.chapterIndex()!;
  screen.screen.steerWith(storyBot(story.chapters[at]!, options));
  for (let frame = 0; frame < 60 * 60 * 4 && screen.screen.chapterIndex() === at; frame += 1) {
    screen.frames(1);
    const model = screen.screen.hudModel();
    if (model !== undefined && each?.(model) === true) return;
    if (screen.published().length > 0) return;
    // A finished chapter stands frozen under its results.
    if (screen.query("story-results") !== null) return;
  }
}

/** Opens the story and goes past the chapter's cutscene into its climb. */
async function open(options: Parameters<typeof storyWithFakes>[0] = {}): Promise<Story> {
  const screen = await storyWithFakes(options);
  await intoClimb(screen);
  return screen;
}

/** Skips the cutscene on screen and waits for the climb after it. */
async function intoClimb(screen: Story): Promise<void> {
  if (screen.query("story-cutscene") === null) return;
  screen.click("story-cutscene-skip");
  await vi.waitFor(() => expect(screen.screen.chapterIndex()).not.toBeUndefined());
  screen.frames(1);
}

/** Every visible text on the overlay. */
const shownText = (): string => document.body.textContent ?? "";

describe("the story screen", () => {
  afterEach(() => {
    inputMethod.note("keyboard");
    document.body.innerHTML = "";
  });

  it("opens at the first chapter on its stage with its song, with the HUD up and the first words told", async () => {
    const screen = await open({ method: "keyboard", settings: fresh() });
    const first = story.chapters[0]!;
    expect(screen.screen.chapterIndex()).toBe(0);
    expect(screen.audio.calls).toContain(`load:song-${first.song.id}`);
    screen.frames(3);
    expect(screen.query("story-hud")).not.toBeNull();
    expect(screen.query("story-glims")?.textContent).toContain(`0`);
    expect(screen.query("story-line")?.textContent).toContain(first.moments[0]!.lines![0]!.text);
    screen.screen.exit();
  });

  it("opens where the player left off: the chapter after the ones finished", async () => {
    const screen = await open({ settings: fresh({ story: { chaptersDone: 2 } }) });
    expect(screen.screen.chapterIndex()).toBe(2);
    expect(screen.audio.calls).toContain(`load:song-${story.chapters[2]!.song.id}`);
    screen.screen.exit();
  });

  it("starts again from the first chapter when all five were told", async () => {
    const screen = await open({ settings: fresh({ story: { chaptersDone: 5 } }) });
    expect(screen.screen.chapterIndex()).toBe(0);
    screen.screen.exit();
  });

  describe("the chip that names a control", () => {
    it("is worded for the keyboard, and goes the moment the player moves", async () => {
      const screen = await open({ method: "keyboard", settings: fresh() });
      screen.frames(2);
      expect(screen.query("story-chip")?.textContent).toContain(story.prompts.move.keyboard);
      screen.key("ArrowRight", 100);
      screen.frames(2);
      expect(screen.query("story-chip")).toBeNull();
      screen.screen.exit();
    });

    it("is worded for a finger on touch, and for the buttons when those are on, following a switch", async () => {
      const settings = fresh({ input: { touchMode: "buttons" } });
      const screen = await open({ method: "touch", settings });
      screen.frames(2);
      expect(screen.query("story-chip")?.textContent).toContain(story.prompts.move.buttons);
      settings.update({ input: { touchMode: "swipe" } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.query("story-chip")?.textContent).toContain(story.prompts.move.touch);
      screen.screen.exit();
    });

    it("names the pad's own control on a gamepad", async () => {
      const screen = await open({ method: "gamepad", settings: fresh() });
      screen.frames(2);
      const chip = screen.query("story-chip")!;
      expect(chip.querySelector("kbd")?.textContent).toBe("Left stick");
      expect(chip.textContent).not.toContain("{glyph}");
      screen.screen.exit();
    });

    it("teaches the fast fall in chapter 2 when the first lamp comes into sight", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 1 } }) });
      let chip: StoryHudModel["chip"];
      playChapter(screen, (model) => {
        if (model.chip === "fastFall") chip = model.chip;
        return chip !== undefined;
      });
      expect(chip).toBe("fastFall");
      expect(screen.query("story-chip")?.textContent).toContain(story.prompts.fastFall.keyboard);
      screen.screen.exit();
    });
  });

  it("never holds the run still: it climbs from the first frame, with no prompt card over it", async () => {
    const screen = await open({ settings: fresh() });
    screen.frames(30);
    expect(screen.screen.tick()).toBeGreaterThan(0);
    expect(screen.query("tutorial-prompt")).toBeNull();
    screen.screen.exit();
  });

  it("hides its HUD while paused and stops the run, and brings both back on Resume", async () => {
    const screen = await open({ method: "keyboard", settings: fresh() });
    screen.frames(20);
    expect(screen.query("story-hud")).not.toBeNull();
    screen.escape();
    expect(screen.query("pause-overlay")).not.toBeNull();
    expect(screen.query("story-hud")).toBeNull();
    const before = screen.screen.tick();
    screen.frames(10);
    expect(screen.screen.tick()).toBe(before);
    screen.click("pause-resume");
    screen.frames(2);
    expect(screen.query("story-hud")).not.toBeNull();
    expect(screen.screen.tick()).toBeGreaterThan(before);
    screen.screen.exit();
  });

  it("leaves from the pause menu to the hub, saving nothing; the hub's Back goes to where it came from", async () => {
    const screen = await open({ previousScreen: "Lobby", settings: fresh() });
    screen.escape();
    expect(screen.query("pause-leave")?.textContent?.trim()).toBe("Leave story");
    screen.click("pause-leave");
    expect(screen.query("story-hub")).not.toBeNull();
    expect(screen.screen.chapterIndex()).toBeUndefined();
    expect(screen.published()).toEqual([]);
    expect(screen.settings.value.seen.tutorial).toBe(false);
    expect(screen.settings.value.story.chaptersDone).toBe(0);
    screen.click("story-hub-back");
    expect(screen.published()).toEqual(["ui.story-closed-to-lobby"]);
    screen.screen.exit();
  });

  it("draws neither the Lap chip nor the standings: one climber's floors only", async () => {
    const screen = await open({ settings: fresh() });
    screen.frames(2);
    expect(screen.query("hud-story-floor")).not.toBeNull();
    expect(screen.query("hud-lap")).toBeNull();
    expect(screen.query("hud-roster")).toBeNull();
    expect(screen.query("hud-pips")).toBeNull();
    screen.screen.exit();
  });

  it("leaves nothing drawn behind on exit", async () => {
    const screen = await open({ settings: fresh() });
    screen.frames(2);
    expect(screen.countDisplayObjects()).toBeGreaterThan(screen.displayObjectsBefore);
    screen.screen.exit();
    expect(screen.countDisplayObjects()).toBe(screen.displayObjectsBefore);
    expect(screen.ticker.size).toBe(0);
    expect(document.querySelector('[data-testid="story-hud"]')).toBeNull();
  });

  it("backs out to where it was opened when the content carries no story", async () => {
    const screen = await storyWithFakes({ withoutStory: true, previousScreen: "Lobby", settings: fresh() });
    expect(screen.published()).toEqual(["ui.story-closed-to-lobby"]);
    screen.screen.exit();
  });

  it("enters though the browser has not let sound start yet", async () => {
    const audio = new FakeAudio();
    audio.running = false;
    const screen = await open({ audio, settings: fresh() });
    expect(audio.calls).toContain("unlock");
    screen.screen.exit();
  });

  describe("the chapters", () => {
    it("saves a finished chapter's stars, glims and time, marks the story seen, and opens the next", async () => {
      const screen = await open({ settings: fresh() });
      playChapter(screen);
      const saved = screen.settings.value.story;
      expect(saved.chaptersDone).toBe(1);
      const record = saved.chapters[story.chapters[0]!.id]!;
      expect(record.stars[0]).toBe(true);
      expect(record.glims).toBe((story.chapters[0]!.glims ?? []).length);
      expect(record.bestMs).toBeGreaterThan(0);
      expect(screen.settings.value.seen.tutorial).toBe(true);
      // The results, then "Next": the next chapter's cutscene, then its climb.
      await vi.waitFor(() => expect(screen.query("story-results")).not.toBeNull());
      screen.click("story-next");
      expect(screen.query("story-cutscene")).not.toBeNull();
      await intoClimb(screen);
      expect(screen.screen.chapterIndex()).toBe(1);
      expect(screen.published()).toEqual([]);
      screen.screen.exit();
    });

    it("plays the ending after the last chapter: the thesis, the credits, Frog's last line and Play now", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 4 } }), previousScreen: "MainMenu" });
      playChapter(screen);
      for (let frame = 0; frame < 2000 && screen.query("story-results") === null; frame += 30) screen.frames(30);
      expect(screen.settings.value.story.chaptersDone).toBe(5);
      screen.click("story-next");
      // The ending's cutscene, the thesis held until a press, the credits, and the last line.
      screen.click("story-cutscene-skip");
      expect(screen.query("story-thesis")).not.toBeNull();
      screen.frames(600);
      expect(screen.query("story-thesis")).not.toBeNull();
      screen.click("story-finale-advance");
      expect(screen.query("story-credits")).not.toBeNull();
      screen.click("story-credits-skip");
      expect(screen.query("story-last")).not.toBeNull();
      expect(screen.query("story-race-now")?.textContent).toContain("Play now");
      screen.click("story-race-now");
      expect(screen.published()).toEqual(["ui.story-closed-to-lobby"]);
      screen.screen.exit();
    });
  });

  // Criterion 14: the floor counter, the objective chip and the pointer.
  describe("the HUD", () => {
    it("reads the chapter's own floors: chapter 5's goal landing reads 50", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 4 } }) });
      screen.frames(2);
      const first = screen.query("hud-story-floor")?.textContent ?? "";
      const [floor, goal] = first.match(/\d+/g)!.map(Number);
      expect(floor).toBeGreaterThanOrEqual(35);
      expect(goal).toBe(50);
      let last = "";
      playChapter(screen, () => {
        last = screen.query("hud-story-floor")?.textContent ?? last;
        return screen.screen.run()?.director.done === true;
      });
      expect(last.replace(/\s+/g, " ")).toMatch(/50\D+50/);
      screen.screen.exit();
    });

    it.each([0, 2, 3, 4])("keeps a chasing lava's edge on screen in chapter %i, the racer below the HUD (re-check 3, R1 and R2)", async (done) => {
    const screen = await open({ settings: fresh({ story: { chaptersDone: done } }) });
    let shown = 0;
    let samples = 0;
    const missed: number[] = [];
    playChapter(screen, () => {
      const inspect = window.__ffStory?.();
      if (inspect?.lava?.under !== "player" || inspect.lava.phaseTicks < 30 || inspect.tick % 30 !== 0) return;
      samples += 1;
      if (inspect.lava.onScreen) shown += 1;
      else missed.push(inspect.tick);
    });
    expect(samples).toBeGreaterThanOrEqual(3);
    expect(shown / samples, `${shown} of ${samples}, missed at ${missed.join(", ")}`).toBeGreaterThanOrEqual(0.9);
    screen.screen.exit();
  });

  it("ends at the top: chapter 5's results come within a breath of the goal, with no dead stand (review 2, R2)", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 4 } }) });
      playChapter(screen, () => screen.screen.run()?.director.done === true);
      expect(screen.screen.run()?.director.done).toBe(true);
      let frames = 0;
      while (screen.query("story-results") === null && frames < 600) {
        screen.frames(1);
        frames += 1;
      }
      expect(frames).toBeLessThanOrEqual(AFTER_DONE_TICKS + 2);
      screen.screen.exit();
    });

    it("follows the phase: up to a floor, down to Frog, back up; with the pointer only while Frog is off screen", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 2 } }) });
      const objectives: string[] = [];
      let pointerShown = false;
      let pointerHiddenInRescue = false;
      let wrongPointer: string | undefined;
      playChapter(screen, (model) => {
        const run = screen.screen.run()!;
        if (model.objective !== undefined && objectives.at(-1) !== model.objective) objectives.push(model.objective);
        const goal = run.director.objective;
        if (goal.kind === "rescue") {
          if (model.pointer !== undefined) {
            pointerShown = true;
            const racer = run.state.players[run.director.actors.list.find((actor) => actor.id === goal.actor)!.playerId]!;
            const want = racer.y < run.state.players[run.playerId]!.y ? "down" : "up";
            if (model.pointer.direction !== want) wrongPointer = `${model.pointer.direction} at tick ${run.state.tick}`;
          } else pointerHiddenInRescue = true;
        }
        return run.director.done;
      });
      expect(objectives[0]).toMatch(/^Reach floor \d+$/);
      expect(objectives.includes("Go down to Frog")).toBe(true);
      expect(objectives.some((text) => /^Climb! Floor \d+$/.test(text))).toBe(true);
      expect(pointerShown).toBe(true);
      expect(pointerHiddenInRescue).toBe(true);
      expect(wrongPointer).toBeUndefined();
      screen.screen.exit();
    });

    it("shows the race's OUT! when the lava catches the player, with the sound off", async () => {
      const showOut = vi.spyOn(RaceScene.prototype, "showOut");
      try {
        const audio = new FakeAudio();
        const screen = await open({ audio, settings: fresh({ story: { chaptersDone: 3 } }) });
        playChapter(screen, () => screen.screen.run()?.out === true, { stopsInLava: true });
        screen.frames(2);
        expect(showOut).toHaveBeenCalledWith(true);
        screen.screen.exit();
      } finally {
        showOut.mockRestore();
      }
    });

    it("shows the pointer's floors in plain words", async () => {
      const screen = await open({ settings: fresh({ story: { chaptersDone: 2 } }) });
      let words: string | undefined;
      playChapter(screen, () => {
        words = screen.query("story-pointer")?.textContent?.trim() ?? undefined;
        return words !== undefined;
      });
      expect(words).toMatch(/^[▲▼]\s*(1 floor|\d+ floors)$/);
      screen.screen.exit();
    });

    it("never counts steps on any story screen", async () => {
      const screen = await open({ settings: fresh() });
      const steps = /step \d|\d+\s*of\s*\d+ steps/i;
      let seen: string | undefined;
      playChapter(screen, () => {
        if (steps.test(shownText())) seen = shownText();
      });
      expect(seen).toBeUndefined();
      screen.screen.exit();
    });

    it("sits its chips under the race HUD's band, at the floor counter's left", async () => {
      const screen = await open({ settings: fresh() });
      const floors = screen.query<HTMLElement>("hud-floors")!;
      const band = document.querySelector<HTMLElement>("[data-hud-metrics]")!;
      vi.spyOn(floors, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 10, 80, 40));
      vi.spyOn(band, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 64));
      screen.frames(30);
      expect(screen.screen.hudModel()?.top).toBe(72);
      expect(screen.screen.hudModel()?.left).toBe(30);
      expect(screen.query<HTMLElement>("story-hud")?.style.getPropertyValue("--story-top")).toBe("72px");
      screen.screen.exit();
    });
  });

  it("leaves a race's stage as it was", async () => {
    const screen = await open({ settings: fresh() });
    screen.screen.exit();
    const race = await gameplayWithFakeNetwork({ content: fakeContentPort(GENERATED_CONTENT) });
    expect(race.screen.stagePresentation()?.layers.map((l) => l.alias)).toContain("world.cityNear");
    race.screen.exit();
  });
});

describe("the story's resets", () => {
  it("hand every frame's events to the respawn flicker and the juice, as a race does", async () => {
    const noteResets = vi.spyOn(RaceScene.prototype, "noteResets");
    const noteRoomEvents = vi.spyOn(RaceScene.prototype, "noteRoomEvents");
    const predicted = vi.spyOn(JuiceDirector.prototype, "notePredictedResets");
    try {
      const screen = await open({ method: "keyboard", settings: fresh() });
      screen.frames(2);
      expect(noteResets).toHaveBeenCalled();
      expect(noteRoomEvents).toHaveBeenCalled();
      expect(predicted).toHaveBeenCalled();
      screen.screen.exit();
    } finally {
      noteResets.mockRestore();
      noteRoomEvents.mockRestore();
      predicted.mockRestore();
    }
  });
});
