import { afterEach, describe, expect, it } from "vitest";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { spawnPosition, floorX } from "@floor-fifty/shared/common/state";
import { CAUGHT_TICKS, CLEARED_TICKS, MIN_FREEZE_TICKS } from "@floor-fifty/shared/level/tutorial";
import { TutorialRun, raceToSnapshot } from "../../../../apps/client/src/features/tutorial/tutorial-run";
// Imported here, not in the test below: a cold import inside a test body eats its 5 s budget when the file runs alone.
import { tutorialWithFakes } from "../../support/fakes/screens";
import { memoryStorage } from "../../support/fakes/settings";
import { applyLocale, installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

const prompt = { keyboard: "k", gamepad: "g", touch: "t" };
type Step = { kind: "move" | "survive"; prompt: typeof prompt };
const tutorial = { seed: 7, targetFloor: 8 };
const revisions = { contentRevision: asRevision("c".repeat(64)), rulesetRevision: asRevision("r".repeat(64)) };
const idle = () => ({ left: false, right: false, fastFall: false, reset: false });
type Run = TutorialRun;
const internalsOf = (run: Run) => run as unknown as { state: RaceState };
const courseOf = (run: Run) => internalsOf(run).state.course;
const localOf = (snapshot: ReturnType<Run["advance"]>) => snapshot.players[0]!;

/** A run whose held input the test sets, as a player's hands would. */
function controlled(steps: Step[] = [{ kind: "move", prompt }]) {
  const held = idle();
  const run = new TutorialRun({
    tutorial: { ...tutorial, steps },
    tuning: resolveTuning(),
    revisions,
    sample: () => ({ ...held }),
  });
  /** Steps `ticks` ticks, five a frame at most, as the render clock would. */
  const play = (ticks: number) => {
    let snapshot = run.advance(0);
    for (let left = ticks; left > 0; left -= 5) snapshot = run.advance(TICK_MS * Math.min(5, left));
    return snapshot;
  };
  /** Waits out the least freeze, then presses left for one tick. */
  const unfreeze = () => {
    Object.assign(held, idle());
    play(MIN_FREEZE_TICKS);
    held.left = true;
    const snapshot = play(1);
    held.left = false;
    return snapshot;
  };
  return { run, held, play, unfreeze };
}

let undoLocale: Array<() => void> = [];
afterEach(() => {
  undoLocale.forEach((undo) => undo());
  undoLocale = [];
});

describe("the local tutorial run", () => {
  it("names the racer in the active language, as the ready room's own-seat tag does", async () => {
    undoLocale.push(installLocaleStrategy(new SettingsStore(memoryStorage()), () => ["en-US"]));
    await applyLocale("ja");
    const run = new TutorialRun({
      tutorial: { ...tutorial, steps: [{ kind: "move" as const, prompt }] },
      tuning: resolveTuning(),
      revisions,
      sample: idle,
    });
    expect(run.advance(0).players[0]!.name).toBe("あなた");
    run.dispose();
  });

  it("draws the player in their remembered colour, and scarlet when none is given", () => {
    const options = { tutorial: { ...tutorial, steps: [{ kind: "move" as const, prompt }] }, tuning: resolveTuning(), revisions, sample: idle };
    const plain = new TutorialRun(options);
    const recoloured = new TutorialRun({ ...options, colour: "violet" });
    expect(plain.advance(0).players[0]!.colour).toBe("scarlet");
    expect(recoloured.advance(0).players[0]!.colour).toBe("violet");
    plain.dispose();
    recoloured.dispose();
  });

  it("draws the remembered character, and the ninja when none is given", () => {
    const options = { tutorial: { ...tutorial, steps: [{ kind: "move" as const, prompt }] }, tuning: resolveTuning(), revisions, sample: idle };
    const plain = new TutorialRun(options);
    const dressed = new TutorialRun({ ...options, characterId: "frog" });
    expect(plain.advance(0).players[0]!.characterId).toBe("ninja");
    expect(dressed.advance(0).players[0]!.characterId).toBe("frog");
    plain.dispose();
    dressed.dispose();
  });

  it("opens frozen: the run stands still until the step's control is pressed", () => {
    const { run, play } = controlled();
    expect(run.script.phase).toBe("frozen");
    expect(play(MIN_FREEZE_TICKS * 3).tick).toBe(0);
    run.dispose();
  });

  it("steps the shared simulation on fixed ticks once let go, starting with the press itself", () => {
    const { run, unfreeze } = controlled();
    expect(unfreeze().tick).toBe(1);
    expect(run.script.phase).toBe("active");
    expect(run.advance(TICK_MS * 3 + 1).tick).toBe(4);
    run.dispose();
  });

  it("caps catch-up after a long frame", () => {
    const { run, unfreeze } = controlled();
    unfreeze();
    expect(run.advance(5_000).tick).toBe(6);
    run.dispose();
  });

  it("freezes while paused", () => {
    const { run, unfreeze } = controlled();
    unfreeze();
    run.setPaused(true);
    expect(run.advance(TICK_MS * 4).tick).toBe(1);
    run.dispose();
  });

  it("completes a step from the player's real input, then holds a pause before it is done", () => {
    const { run, held, play, unfreeze } = controlled();
    unfreeze();
    held.left = true;
    play(2);
    held.left = false;
    held.right = true;
    play(2);
    expect(run.script.phase).toBe("cleared");
    expect(run.script.done).toBe(false);
    play(CLEARED_TICKS);
    expect(run.script.done).toBe(true);
    run.dispose();
  });

  it("projects a race state into the snapshot shape the view already draws", () => {
    const { run } = controlled();
    const snapshot = run.advance(TICK_MS);
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]!.id).toBe(run.playerId);
    expect(snapshot.platforms).toHaveLength(snapshot.floorCount);
    // The snapshot is the race's own: nothing in the tutorial counts toward a floor goal.
    expect(snapshot.floorCount).toBe(courseOf(run).floorCount);
    expect(snapshot.players[0]!.progress).toBe(1 / snapshot.floorCount); // the start floor counts as landed
    expect(snapshot.contentRevision).toBe(revisions.contentRevision);
    expect(raceToSnapshot).toBeTypeOf("function");
    run.dispose();
  });

  it("reports each tick's events once, on the frame that stepped them", () => {
    const { run, held, unfreeze } = controlled();
    unfreeze();
    held.reset = true;
    expect(run.advance(TICK_MS).events.some((event) => event.type === "playerReset")).toBe(true);
    expect(run.advance(0).events).toEqual([]);
    run.dispose();
  });

  it("sends a player who climbs the whole course back to the start rather than finishing", () => {
    const { run, unfreeze } = controlled();
    unfreeze();
    // Every floor credited, as the top floor's landing leaves it: the next
    // tick is the one that would finish the race.
    const internals = run as unknown as { state: RaceState };
    const player = internals.state.players[run.playerId]!;
    player.visitedFloorIds = internals.state.course.floors.map((floor) => floor.id);

    const events: RaceEvent[] = [];
    for (let frame = 0; frame < 10; frame += 1) events.push(...run.advance(TICK_MS).events);
    const snapshot = run.advance(0);

    expect(events.some((event) => event.type === "raceFinished")).toBe(false);
    expect(events.filter((event) => event.type === "lapCompleted")).toHaveLength(1);
    expect(snapshot.phase).toBe("racing");
    expect(snapshot.players[0]!.finishedAtTick).toBeUndefined();
    expect(snapshot.players[0]!.lap).toBe(1);
    expect(snapshot.standings).toEqual([]);
    expect(snapshot.players[0]!.progress).toBe(1 / snapshot.floorCount);
    // Still simulated: the run keeps stepping.
    expect(run.advance(TICK_MS).tick).toBe(snapshot.tick + 1);
    run.dispose();
  });
});

it("carries a real tutorial wall collision through its draw path without injected observations", async () => {
  const tutorial = await tutorialWithFakes({ method: "keyboard" });
  try {
    tutorial.frames(MIN_FREEZE_TICKS);
    tutorial.key("KeyA", 100);
    const run = tutorial.screen["run"]!;
    const state = run["state"];
    const floor = state.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
    Object.assign(state.players[run.playerId]!, { x: floor.x - (state.tuning.FLOOR_WIDTH + state.tuning.PLAYER_WIDTH) / 2 + 1, y: floor.y, vx: 0, vy: 0 });
    run["simulation"].restore(state);
    tutorial.audio.calls.length = 0;
    tutorial.key("KeyD", 16);
    expect(tutorial.audio.calls.some((call) => call.startsWith("cue:sfx.wallScuff:"))).toBe(true);
    expect(tutorial.screen["scene"]!["juice"].liveParticles).toBeGreaterThan(0);
    expect(run.drainSideContacts()).toEqual([]);
  } finally { tutorial.screen.exit(); }
});

describe("the tutorial's last step on the run", () => {
  /**
   * A run whose last step has just begun, frozen: the first step cleared with a
   * left and a right, then hands off through the pause until she lands.
   * `before` runs during the pause, for the tests that need her somewhere odd.
   */
  function runAtSurvive(before?: (run: Run) => void) {
    const controls = controlled([
      { kind: "move", prompt },
      { kind: "survive", prompt },
    ]);
    const { run, held, play, unfreeze } = controls;
    unfreeze();
    held.right = true;
    play(2);
    held.right = false;
    expect(run.script.phase).toBe("cleared");
    before?.(run);
    for (let ticks = 0; ticks < 900 && run.script.current !== "survive"; ticks += 1) play(1);
    expect(run.script.current).toBe("survive");
    return controls;
  }

  /** Where the step began, as the view sees her. */
  const positionOf = (run: Run) => {
    const { x, y, vy } = localOf(run.advance(0));
    return { x, y, vy };
  };
  /** Lets the step go with one steer, then hands off until the edge catches her. */
  function idleUntilCaught(controls: ReturnType<typeof runAtSurvive>): void {
    controls.unfreeze();
    for (let ticks = 0; ticks < 2400 && !controls.run.out; ticks += 1) controls.play(1);
    expect(controls.run.out).toBe(true);
  }

  it("puts her back where the step began when the lava catches her, and the tutorial goes on", () => {
    const controls = runAtSurvive();
    const { run, play } = controls;
    const began = positionOf(run);
    idleUntilCaught(controls);
    play(CAUGHT_TICKS);
    expect(run.out).toBe(false);
    expect(positionOf(run)).toEqual(began);
    expect(run.script.done).toBe(false);
    expect(run.script.phase).toBe("frozen");
    expect(run.script.current).toBe("survive");
    run.dispose();
  });

  it("does not catch her at once after a restart: she has the step's whole room again", () => {
    const controls = runAtSurvive();
    idleUntilCaught(controls);
    controls.play(CAUGHT_TICKS);
    controls.unfreeze(); // one steer, then idle
    controls.play(300); // 5 s: an idle player has about 11
    expect(controls.run.out).toBe(false);
    controls.run.dispose();
  });

  it("starts the step under her when she had been credited floors well above where she is", () => {
    const controls = runAtSurvive((run) => {
      const state = internalsOf(run).state;
      state.players[run.playerId]!.visitedFloorIds = state.course.floors.slice(0, 7).map((floor) => floor.id);
    });
    const { run, unfreeze, play } = controls;
    expect(run.edge!.y).toBeLessThan(localOf(run.advance(0)).y);
    unfreeze();
    play(60);
    expect(run.out).toBe(false);
    run.dispose();
  });

  it("stops showing OUT! when she skips the tutorial, and leaves her where she was", () => {
    const controls = runAtSurvive();
    const { run, play } = controls;
    idleUntilCaught(controls);
    const caughtAt = positionOf(run);
    run.script.skip();
    // The end card is up now: "OUT!" must not stay behind it, and the
    // racer must not jump back to where the step began.
    expect(run.out).toBe(false);
    play(CAUGHT_TICKS);
    expect(run.out).toBe(false);
    expect(positionOf(run)).toEqual(caughtAt);
    run.dispose();
  });

  it("holds the picture still while OUT! shows", () => {
    const controls = runAtSurvive();
    idleUntilCaught(controls);
    const { run } = controls;
    const tick = run.advance(0).tick;
    expect(run.advance(TICK_MS * 3).tick).toBe(tick);
    run.dispose();
  });

  it("carries the edge in the snapshot on the last step only", () => {
    const { run: early } = controlled();
    expect(early.edge).toBeUndefined();
    early.dispose();
    const controls = runAtSurvive();
    const { run } = controls;
    expect(run.edge).toEqual({ y: expect.any(Number), rise: 0 });
    expect(localOf(run.advance(0)).floorEdgeY).toBe(run.edge!.y);
    controls.unfreeze();
    controls.play(10);
    expect(run.edge!.rise).toBe(resolveTuning().TUTORIAL_EDGE_RISE);
    run.dispose();
  });

  it("starts the last step from the bottom when she climbed too high before it", () => {
    const controls = runAtSurvive((run) => {
      const state = internalsOf(run).state;
      // A floor that holds still, so the landing is where she is put.
      const floor = state.course.floors.find((candidate) => candidate.index >= 17 && candidate.kind === "stationary")!;
      expect(floor).toBeDefined();
      Object.assign(state.players[run.playerId]!, {
        x: floorX(state, floor),
        y: floor.y + state.tuning.FLOOR_HEIGHT / 2 + state.tuning.PLAYER_HEIGHT / 2 + 40,
        vx: 0,
        vy: -300,
      });
      run["simulation"].restore(state);
    });
    const { run } = controls;
    const spawn = spawnPosition(courseOf(run), resolveTuning());
    expect(localOf(run.advance(0)).y).toBe(spawn.y);
    expect(run.edge!.y).toBeCloseTo(courseOf(run).floors[0]!.y - resolveTuning().TUTORIAL_EDGE_START_BELOW, 6);
    expect(run.script.needsStart).toBe(false);
    run.dispose();
  });

  it("can be caught and restarted twice", () => {
    const controls = runAtSurvive();
    for (const _ of [1, 2]) {
      idleUntilCaught(controls);
      controls.play(CAUGHT_TICKS);
    }
    expect(controls.run.script.phase).toBe("frozen");
    controls.run.dispose();
  });

  it("counts the tutorial's floors as the course does, toward no goal of its own", () => {
    const { run } = controlled();
    expect(run.advance(0).floorCount).toBe(courseOf(run).floorCount);
    run.dispose();
  });
});
