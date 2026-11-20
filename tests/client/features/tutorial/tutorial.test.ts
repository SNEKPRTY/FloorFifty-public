import { afterEach, describe, expect, it, vi } from "vitest";
import { floorX } from "@floor-fifty/shared/common/state";
import { CAUGHT_TICKS } from "@floor-fifty/shared/level/tutorial";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import { JuiceDirector } from "../../../../apps/client/src/features/race/juice/juice-director";
import { RaceScene } from "../../../../apps/client/src/features/race/race-scene";
import { FakeAudio } from "../../support/fakes/audio";
import { fakeContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork, tutorialWithFakes } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";

describe("the tutorial screen", () => {
  afterEach(() => {
    inputMethod.note("keyboard");
    document.body.innerHTML = "";
  });

  it("shows the first step's prompt in the player's input method", async () => {
    const tutorial = await tutorialWithFakes({ method: "keyboard" });
    expect(tutorial.query("tutorial-prompt")?.textContent).toContain("A and D");
    expect(tutorial.query("tutorial-step")?.textContent).toContain(m.tutorial_step_toast({ step: 1, total: 5 }));
    tutorial.screen.exit();
  });

  it("words the prompt for a finger on touch", async () => {
    const tutorial = await tutorialWithFakes({ method: "touch" });
    expect(tutorial.query("tutorial-prompt")?.textContent).toContain("Drag left, then right");
    tutorial.screen.exit();
  });

  it("names the controller's own control on a pad, inside the sentence", async () => {
    const tutorial = await tutorialWithFakes({ method: "gamepad" });
    expect(tutorial.query("tutorial-glyph")?.textContent).toBe("Left stick");
    expect(tutorial.query("tutorial-prompt")?.textContent?.trim()).toBe("Steer left, then right, with Left stick.");
    tutorial.screen.exit();
  });

  it("words a touch prompt for the on-screen buttons when those are on", async () => {
    const settings = fakeSettings({ input: { touchMode: "buttons" } });
    const tutorial = await tutorialWithFakes({ method: "touch", settings });
    expect(tutorial.query("tutorial-prompt")?.textContent).toContain("Hold the left arrow");
    // Switched back mid-step, the wording follows.
    settings.update({ input: { touchMode: "swipe" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tutorial.query("tutorial-prompt")?.textContent).toContain("in the lower half");
    tutorial.screen.exit();
  });

  it.each(["keyboard", "touch", "gamepad"] as const)("puts the card at the top, with its step count, on %s", async (method) => {
    const tutorial = await tutorialWithFakes({ method });
    const row = tutorial.query<HTMLElement>("tutorial-step")?.closest<HTMLElement>(".ff-tutorial");
    expect(row?.style.top).not.toBe("");
    expect(row?.style.bottom).toBe("");
    expect(tutorial.query("tutorial-step")?.textContent?.trim()).toMatch(new RegExp(`^${m.tutorial_step_toast({ step: 1, total: 5 })}`));
    tutorial.screen.exit();
  });

  it("hides the card while paused, and brings it back on Resume", async () => {
    const tutorial = await tutorialWithFakes({ method: "keyboard" });
    expect(document.querySelector("[data-tutorial-card]")).not.toBeNull();
    tutorial.escape();
    expect(tutorial.query("pause-overlay")).not.toBeNull();
    expect(document.querySelector("[data-tutorial-card]")).toBeNull();
    expect(tutorial.query("tutorial-freeze")).toBeNull();
    tutorial.click("pause-resume");
    expect(document.querySelector("[data-tutorial-card]")).not.toBeNull();
    tutorial.screen.exit();
  });

  it("opens each step frozen, and holds still until the player does what it asks", async () => {
    const tutorial = await tutorialWithFakes({ method: "keyboard" });
    expect(tutorial.query("tutorial-freeze")).not.toBeNull();
    expect(tutorial.query("tutorial-waiting")).not.toBeNull();
    tutorial.frames(60);
    expect(tutorial.screen.tick()).toBe(0);
    tutorial.key("KeyA", 100);
    expect(tutorial.query("tutorial-freeze")).toBeNull();
    expect(tutorial.screen.tick()).toBeGreaterThan(0);
    tutorial.screen.exit();
  });

  it("advances when the player really does it, after a beat that says so", async () => {
    const tutorial = await tutorialWithFakes({ method: "keyboard" });
    tutorial.frames(30);
    tutorial.key("KeyA", 200);
    tutorial.key("KeyD", 200);
    expect(tutorial.query("tutorial-cleared")?.textContent).toContain("Done.");
    expect(tutorial.query("tutorial-step")?.textContent?.trim()).toBe(m.tutorial_step_toast({ step: 1, total: 5 }));
    tutorial.frames(80);
    expect(tutorial.query("tutorial-step")?.textContent?.trim()).toMatch(new RegExp(`^${m.tutorial_step_toast({ step: 2, total: 5 })}`));
    expect(tutorial.query("tutorial-freeze")).not.toBeNull();
    tutorial.screen.exit();
  });

  it("exits from the pause menu to where it came from, without marking the tutorial seen", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "Lobby" });
    // The prompt carries Skip alone; the way out is the pause menu's.
    expect(tutorial.query("tutorial-exit")).toBeNull();
    tutorial.escape();
    tutorial.click("pause-leave");
    expect(tutorial.published()).toEqual(["ui.tutorial-closed-to-lobby"]);
    expect(tutorial.settings.value.seen.tutorial).toBe(false);
    tutorial.screen.exit();
  });

  it("skips from the pause menu, where a controller can reach it", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "MainMenu" });
    tutorial.escape();
    tutorial.click("pause-skip");
    // The overlay fades out over half a beat (polish spec §5.3).
    await vi.waitFor(() => expect(tutorial.query("pause-overlay")).toBeNull());
    expect(tutorial.settings.value.seen.tutorial).toBe(true);
    expect(tutorial.query("tutorial-done")).not.toBeNull();
    tutorial.screen.exit();
  });


  it("names its way out Leave tutorial, keeps Skip tutorial, and does not repeat Paused (ui layout spec §6.10)", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "Lobby" });
    tutorial.escape();
    expect(tutorial.query("pause-leave")?.textContent?.trim()).toBe("Leave tutorial");
    expect(tutorial.query("pause-skip")?.textContent?.trim()).toBe("Skip tutorial");
    const dialog = tutorial.query("pause-overlay")!;
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(dialog.textContent).not.toContain("Paused.");
    tutorial.screen.exit();
  });

  it("heads the done dialog with You are ready as its title", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "MainMenu" });
    tutorial.click("tutorial-skip");
    const done = tutorial.query("tutorial-done")!;
    const heading = document.getElementById(done.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent).toBe("You are ready");
    expect(heading.classList.contains("ff-dialog-heading__title")).toBe(true);
    tutorial.screen.exit();
  });
  it("draws neither the Lap chip nor the standings: one racer, one lap", async () => {
    const tutorial = await tutorialWithFakes();
    tutorial.frames(2);
    // Nothing in the tutorial asks her to fill the Floors counter, so it is not drawn (first-race spec §5).
    expect(tutorial.query("hud-floors")).toBeNull();
    expect(tutorial.query("hud-lap")).toBeNull();
    expect(tutorial.query("hud-roster")).toBeNull();
    expect(tutorial.query("hud-pips")).toBeNull();
    tutorial.screen.exit();
  });

  it("marks the tutorial seen when skipped, and goes back to the title from the done card", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "MainMenu" });
    tutorial.click("tutorial-skip");
    expect(tutorial.settings.value.seen.tutorial).toBe(true);
    expect(tutorial.query("tutorial-done")).not.toBeNull();
    expect(tutorial.query("tutorial-race-now")?.textContent).toContain("Play now");
    tutorial.click("tutorial-back-to-title");
    expect(tutorial.published()).toEqual(["ui.tutorial-closed-to-title"]);
    tutorial.screen.exit();
  });

  it("offers only Race now when opened from the lobby, which goes back to the lobby", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "Lobby" });
    tutorial.click("tutorial-skip");
    expect(tutorial.query("tutorial-back-to-title")).toBeNull();
    tutorial.click("tutorial-race-now");
    expect(tutorial.published()).toEqual(["ui.tutorial-closed-to-lobby"]);
    tutorial.screen.exit();
  });

  it("stops the run while paused", async () => {
    const tutorial = await tutorialWithFakes();
    // Let go of the first step's freeze, so the run is really moving.
    tutorial.frames(30);
    tutorial.key("KeyA", 100);
    tutorial.escape();
    expect(tutorial.query("pause-overlay")).not.toBeNull();
    const before = tutorial.screen.tick();
    tutorial.frames(10);
    expect(tutorial.screen.tick()).toBe(before);
    tutorial.screen.exit();
  });

  it("says the tutorial is paused, and leaves it without asking", async () => {
    const tutorial = await tutorialWithFakes({ previousScreen: "MainMenu" });
    tutorial.escape();
    expect(tutorial.query("pause-overlay")?.textContent).not.toContain("Race continues");
    tutorial.click("pause-leave");
    expect(tutorial.published()).toEqual(["ui.tutorial-closed-to-title"]);
    tutorial.screen.exit();
  });

  it("leaves nothing drawn behind on exit", async () => {
    const tutorial = await tutorialWithFakes();
    tutorial.frames(2);
    expect(tutorial.countDisplayObjects()).toBeGreaterThan(tutorial.displayObjectsBefore);
    tutorial.screen.exit();
    expect(tutorial.countDisplayObjects()).toBe(tutorial.displayObjectsBefore);
    expect(tutorial.ticker.size).toBe(0);
  });

  describe("its own stage", () => {
    it("draws the dawn stage, in silhouette", async () => {
      const tutorial = await tutorialWithFakes();
      expect(tutorial.screen.stagePresentation()?.layers.map((l) => l.alias)).toContain("world.dawnSky");
      expect(tutorial.screen.stagePresentation()?.silhouette).toBe(true);
      tutorial.screen.exit();
    });

    it("enters though the browser has not let sound start yet", async () => {
      // A refused resume never settles; waiting on it held the tutorial behind the loader.
      const audio = new FakeAudio();
      audio.running = false;
      const tutorial = await tutorialWithFakes({ audio });
      expect(audio.calls).toContain("unlock");
      expect(tutorial.audio.playing()).toBe("music.tutorial");
      tutorial.screen.exit();
    });

    it("plays the tutorial's own song, and stops it on exit", async () => {
      const tutorial = await tutorialWithFakes();
      expect(tutorial.audio.calls).toContain("load:song-dawn-tutorial");
      expect(tutorial.audio.playing()).toBe("music.tutorial");
      tutorial.screen.exit();
      expect(tutorial.audio.playing()).toBeUndefined();
    });

    it("falls back to the race's stage for content that carries no tutorial stage", async () => {
      const tutorial = await tutorialWithFakes({ withoutTutorialStage: true });
      expect(tutorial.screen.stagePresentation()?.layers.map((l) => l.alias)).not.toContain("world.dawnSky");
      expect(tutorial.screen.stagePresentation()?.silhouette).toBe(false);
      expect(tutorial.audio.playing()).toBe("music.chromeInTheRain");
      tutorial.screen.exit();
    });

    it("leaves a race's stage as it was (review focus 1)", async () => {
      const tutorial = await tutorialWithFakes();
      tutorial.screen.exit();
      const { GENERATED_CONTENT } = await import("../../../../apps/server/src/content/generated-content");
      const race = await gameplayWithFakeNetwork({ content: fakeContentPort(GENERATED_CONTENT) });
      expect(race.screen.stagePresentation()?.layers.map((l) => l.alias)).not.toContain("world.dawnSky");
      expect(race.screen.stagePresentation()?.silhouette).toBe(false);
      expect(race.screen.stagePresentation()?.layers.map((l) => l.alias)).toContain("world.cityNear");
      race.screen.exit();
    });
  });
});

describe("the tutorial's resets", () => {
  it("hand every frame's events to the respawn flicker, as a race does (race-flow spec §5.1)", async () => {
    const noteResets = vi.spyOn(RaceScene.prototype, "noteResets");
    try {
      const tutorial = await tutorialWithFakes({ method: "keyboard" });
      tutorial.frames(2);
      expect(noteResets).toHaveBeenCalled();
      expect(Array.isArray(noteResets.mock.calls[0]![0])).toBe(true);
    } finally {
      noteResets.mockRestore();
    }
  });

  it("hand the run's resets to the juice before it draws, so a respawn is never read as a landing", async () => {
    const predicted = vi.spyOn(JuiceDirector.prototype, "notePredictedResets");
    try {
      const tutorial = await tutorialWithFakes({ method: "keyboard" });
      tutorial.frames(2);
      expect(predicted).toHaveBeenCalled();
    } finally {
      predicted.mockRestore();
    }
  });

  it("hand every frame's events to the juice, which answers them as the room's (polish spec §4.1)", async () => {
    const noteRoomEvents = vi.spyOn(RaceScene.prototype, "noteRoomEvents");
    try {
      const tutorial = await tutorialWithFakes({ method: "keyboard" });
      tutorial.frames(2);
      expect(noteRoomEvents).toHaveBeenCalled();
      expect(Array.isArray(noteRoomEvents.mock.calls[0]![0])).toBe(true);
    } finally {
      noteRoomEvents.mockRestore();
    }
  });
});


describe("the tutorial's last step on screen (first-race spec §1)", () => {
  /**
   * The tutorial cut to its first and last steps, with the last just begun and
   * frozen: the first cleared with a left and a right, then hands off through
   * the pause until the racer lands and the last step opens.
   */
  async function tutorialAtSurvive() {
    const tutorial = await tutorialWithFakes({ method: "keyboard", onlySteps: ["move", "survive"] });
    tutorial.frames(30);
    tutorial.key("KeyA", 200);
    tutorial.key("KeyD", 200);
    const second = m.tutorial_step_toast({ step: 2, total: 2 });
    for (let frame = 0; frame < 400 && !tutorial.query("tutorial-step")?.textContent?.includes(second); frame += 5) tutorial.frames(5);
    expect(tutorial.query("tutorial-step")?.textContent).toContain(second);
    return tutorial;
  }
  const promptOf = (tutorial: Awaited<ReturnType<typeof tutorialAtSurvive>>) => tutorial.query("tutorial-prompt")?.textContent;

  /** One steer lets the step go; then hands off until "OUT!" shows. */
  function idleUntilCaught(tutorial: Awaited<ReturnType<typeof tutorialAtSurvive>>): void {
    tutorial.frames(30);
    tutorial.key("ArrowRight", 50);
    for (let frame = 0; frame < 2400 && tutorial.query("out-banner") === null; frame += 10) tutorial.frames(10);
    expect(tutorial.query("out-banner")).not.toBeNull();
  }

  it("says the lava caught her and to try again, shows OUT!, and keeps the tutorial open", async () => {
    const tutorial = await tutorialAtSurvive();
    expect(promptOf(tutorial)).toContain(m.content_tutorial_survive_keyboard());
    idleUntilCaught(tutorial);
    expect(tutorial.query("out-banner")!.textContent).toBe(m.race_out());
    expect(promptOf(tutorial)).toContain(m.tutorial_caught());
    // OUT! is not veiled: it reads as it does in a race.
    expect(tutorial.query("tutorial-freeze")).toBeNull();
    tutorial.frames(CAUGHT_TICKS + 4);
    expect(tutorial.query("out-banner")).toBeNull();
    expect(tutorial.query("tutorial-done")).toBeNull();
    expect(tutorial.query("tutorial-freeze")).not.toBeNull();
    expect(promptOf(tutorial)).toContain(m.tutorial_caught());
    // The restarted step holds still for its least freeze, then lets go on a fresh press.
    tutorial.frames(30);
    tutorial.key("ArrowRight", 50);
    expect(promptOf(tutorial)).toContain(m.content_tutorial_survive_keyboard());
    tutorial.screen.exit();
  });

  it("ends on the end card once she has climbed three floors above where the step began", async () => {
    const tutorial = await tutorialAtSurvive();
    tutorial.frames(30);
    tutorial.key("ArrowRight", 50);
    const run = tutorial.screen["run"]!;
    const state = run["state"];
    const goal = state.course.floors[run.script.surviveGoalFloor!]!;
    // Dropped onto the goal floor, as a climb would end.
    Object.assign(state.players[run.playerId]!, {
      x: floorX(state, goal),
      y: goal.y + (state.tuning.FLOOR_HEIGHT + state.tuning.PLAYER_HEIGHT) / 2 + 6,
      vx: 0,
      vy: -200,
    });
    run["simulation"].restore(state);
    tutorial.frames(160);
    expect(tutorial.query("tutorial-done")).not.toBeNull();
    tutorial.screen.exit();
  });
});
