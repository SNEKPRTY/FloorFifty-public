/**
 * What the Gameplay screen does with a race's events (race-flow spec §5.1 and
 * §6): the announcement region says them, once, and a reset flickers its racer.
 *
 * The announcer and the flicker are tested alone. These are the connections
 * between them and the screen, which a unit test of either cannot see: a screen
 * that never fed its snapshots to the announcer would pass both.
 */

import { flushSync } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { raceEventId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const players = [playerSnapshot({ id: LOCAL_ID, name: "Kite" }), playerSnapshot({ id: REMOTE_ID, name: "Wren" })];
const racing = (tick: number, events: RaceEvent[] = []) =>
  snapshotAt(tick, { phase: "racing", lapCount: 3, players, events });

const lapped: RaceEvent = { id: raceEventId(10, "lapCompleted", REMOTE_ID, "1"), tick: 10, type: "lapCompleted", playerId: REMOTE_ID, lap: 1 };
const fell: RaceEvent = { id: raceEventId(10, "playerReset", REMOTE_ID, "fall"), tick: 10, type: "playerReset", playerId: REMOTE_ID, reason: "fall" };

/**
 * Every screen a test opens is exited afterwards. `race-scene.ts` starts
 * `remeasureViewport`'s settle timers when a race mounts; left running, they
 * fire after the environment is torn down ("win.dispatchEvent is not a
 * function", an unhandled error that fails the whole run).
 */
const opened: Array<{ screen: { exit(): void } }> = [];
const openScreen = async (...args: Parameters<typeof gameplayWithFakeNetwork>) => {
  const gameplay = await gameplayWithFakeNetwork(...args);
  opened.push(gameplay);
  return gameplay;
};

afterEach(() => {
  for (const gameplay of opened.splice(0)) gameplay.screen.exit();
  vi.restoreAllMocks();
});

describe("the race's announcements on the Gameplay screen", () => {
  it("says another racer's lap in the live region, once however often the batch arrives", async () => {
    const gameplay = await openScreen({ latestSnapshot: racing(0) });
    const region = gameplay.overlay.querySelector('[data-testid="race-announcer"]')!;
    expect(region.textContent).toBe("");

    gameplay.network.emitSnapshot(racing(10, [lapped]));
    await gameplay.settle();
    expect(region.textContent).toBe("Wren completed lap 1 of 3");

    const announce = vi.spyOn(
      (gameplay.screen as unknown as { scene: { announce(lines: readonly string[]): void } }).scene,
      "announce",
    );
    gameplay.network.emitSnapshot(racing(11, [lapped]));
    gameplay.network.emitSnapshot(racing(12, [lapped]));
    const spoken = announce.mock.calls.filter(([lines]) => lines.length > 0);
    expect(spoken, "a replayed batch announces nothing").toEqual([]);
  });

  it("says who finished first, when the race is won", async () => {
    const gameplay = await openScreen({ latestSnapshot: racing(0) });
    const region = gameplay.overlay.querySelector('[data-testid="race-announcer"]')!;
    gameplay.network.emitSnapshot(
      snapshotAt(20, {
        phase: "finished",
        lapCount: 3,
        players,
        winnerId: REMOTE_ID,
        events: [{ id: raceEventId(20, "raceFinished", REMOTE_ID, "3"), tick: 20, type: "raceFinished", winnerId: REMOTE_ID }],
      }),
    );
    expect(region.textContent).toContain("Wren finished first");
  });

  it("says nothing for sixty snapshots of a race that only moves", async () => {
    const gameplay = await openScreen({ latestSnapshot: racing(0) });
    const region = gameplay.overlay.querySelector('[data-testid="race-announcer"]')!;
    for (let tick = 1; tick <= 60; tick += 1) gameplay.network.emitSnapshot(racing(tick));
    expect(region.textContent).toBe("");
  });
});

describe("a reset on the Gameplay screen", () => {
  it("flickers the racer who fell, from the room's event", async () => {
    const dim = vi.spyOn(GameplayView.prototype, "setBodyAlpha");
    const gameplay = await openScreen({ latestSnapshot: racing(0) });
    gameplay.network.emitSnapshot(racing(10, [fell]));
    for (let tick = 11; tick < 40; tick += 1) {
      gameplay.network.emitSnapshot(racing(tick));
      gameplay.screen.draw(16);
    }
    const dimmed = dim.mock.calls.filter(([id, alpha]) => id === REMOTE_ID && alpha < 1);
    expect(dimmed.length, "the fallen racer's body dims").toBeGreaterThan(0);
    expect(dim.mock.calls.filter(([id, alpha]) => id === LOCAL_ID && alpha < 1)).toEqual([]);
  });

  it("does not flicker a racer who only lapped", async () => {
    const dim = vi.spyOn(GameplayView.prototype, "setBodyAlpha");
    const gameplay = await openScreen({ latestSnapshot: racing(0) });
    gameplay.network.emitSnapshot(racing(10, [lapped]));
    for (let tick = 11; tick < 40; tick += 1) {
      gameplay.network.emitSnapshot(racing(tick));
      gameplay.screen.draw(16);
    }
    expect(dim.mock.calls.filter(([, alpha]) => alpha < 1)).toEqual([]);
  });
});

describe("any key, any tap starts a waiting Survival racer (first-race plan Task 9)", () => {
  const TICK_MS = 1000 / 60;
  // A pad button reaches the same pulse through the InputManager, and is tested with the gamepad source.
  const endlessTuning = { ...resolveTuning(), COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
  const room = (local: Parameters<typeof playerSnapshot>[0], over: { endless?: boolean } = {}) =>
    snapshotAt(120, {
      phase: "racing",
      raceStartedAtTick: 0,
      ...(over.endless === false ? {} : { floorCount: 60, tuning: endlessTuning, modeId: "infinite" }),
      players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", ...local })],
    });
  const open = (snapshot: ReturnType<typeof room>) => openScreen({ latestSnapshot: snapshot, localPlayerId: LOCAL_ID });
  const run = (gameplay: Awaited<ReturnType<typeof open>>, frames = 6) => {
    for (let frame = 0; frame < frames; frame += 1) gameplay.screen.draw(TICK_MS);
  };
  const resets = (gameplay: Awaited<ReturnType<typeof open>>) => gameplay.network.sentInputs.filter((frame) => frame.reset);
  const key = (code: string, extra: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code === "Space" ? " " : code, ...extra }));

  it("sends one restart press for Space, a key the game does not bind, and no second for the next key", async () => {
    const gameplay = await open(room({ awaitingInput: true }));
    key("Space");
    run(gameplay);
    expect(resets(gameplay)).toHaveLength(1);
    key("Enter");
    run(gameplay);
    expect(resets(gameplay), "the fake room still says she is waiting: one pulse per race").toHaveLength(1);
  });

  it("sends one for a tap on the play surface", async () => {
    const gameplay = await open(room({ awaitingInput: true }));
    gameplay.overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    run(gameplay);
    expect(resets(gameplay)).toHaveLength(1);
  });

  it("does not take a tap on a HUD button for a start", async () => {
    const gameplay = await open(room({ awaitingInput: true }));
    const button = document.createElement("button");
    gameplay.overlay.append(button);
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    run(gameplay);
    expect(resets(gameplay)).toEqual([]);
  });

  it.each([
    ["she has already started", () => room({ awaitingInput: false }), "Space"],
    ["the race is a 20-floor climb, where a restart press restarts", () => room({ awaitingInput: true }, { endless: false }), "Space"],
    ["the key is Escape, which pauses", () => room({ awaitingInput: true }), "Escape"],
    ["she is out", () => room({ awaitingInput: true, outAtTick: 100, finishedAtTick: 100 }), "Space"],
  ])("sends nothing when %s", async (_why, snapshot, code) => {
    const gameplay = await open(snapshot());
    key(code);
    run(gameplay);
    expect(resets(gameplay)).toEqual([]);
  });

  it("sends nothing while the countdown is still running", async () => {
    const gameplay = await open({ ...room({ awaitingInput: true }), phase: "countdown" as const });
    key("Space");
    run(gameplay);
    expect(resets(gameplay)).toEqual([]);
  });
});

describe("the one-time hints on the Gameplay screen (first-race plan Task 11)", () => {
  const SECOND = 1000;
  const endlessTuning = { ...resolveTuning(), COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
  const room = (kind: "survival" | "climb", local: Parameters<typeof playerSnapshot>[0] = {}) =>
    snapshotAt(120, {
      phase: "racing",
      raceStartedAtTick: 0,
      ...(kind === "survival" ? { floorCount: 60, tuning: endlessTuning, modeId: "infinite" } : {}),
      players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", awaitingInput: true, ...local })],
    });
  const open = async (kind: "survival" | "climb", options: { seat?: boolean; touch?: boolean } = {}) => {
    if (options.touch === true) {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: coarse"), media: query, addEventListener() {}, removeEventListener() {} }));
    }
    const settings = new SettingsStore(memoryStorage());
    const gameplay = await openScreen({
      latestSnapshot: room(kind),
      settings,
      ...(options.seat === false ? {} : { localPlayerId: LOCAL_ID }),
    });
    const hint = () => gameplay.overlay.querySelector<HTMLElement>('[data-testid="race-hint"]');
    return {
      ...gameplay,
      settings,
      hint,
      /** The room's next snapshot says she has pressed; the screen notices on its next frame. */
      firstInput: () => {
        gameplay.network.emitSnapshot(room(kind, { awaitingInput: false }));
        gameplay.screen.draw(0);
        flushSync();
      },
      // Svelte patches the DOM on a microtask; a test reads it straight after the frame.
      advance: (ms: number) => {
        gameplay.screen.draw(ms);
        flushSync();
      },
      out: () => {
        gameplay.network.emitSnapshot(room(kind, { awaitingInput: false, outAtTick: 130, finishedAtTick: 130 }));
        gameplay.screen.draw(0);
        flushSync();
      },
    };
  };
  afterEach(() => vi.unstubAllGlobals());

  it("shows the lava line in a first Survival race and marks it seen 6 s after her first input", async () => {
    const race = await open("survival");
    expect(race.hint()?.dataset["hint"]).toBe("edge");
    race.advance(10 * SECOND);
    expect(race.settings.value.seen.edgeLine, "a race she has not started spends nothing").toBe(false);
    race.firstInput();
    race.advance(5999);
    expect(race.settings.value.seen.edgeLine).toBe(false);
    race.advance(1);
    expect(race.settings.value.seen.edgeLine).toBe(true);
    // The hint falls out first, so it is a beat before it is gone.
    await vi.waitFor(() => expect(race.hint()).toBeNull());
  });

  it("teaches floors then restart in a first 20-floor race, and spends the climb hints after both", async () => {
    const race = await open("climb");
    expect(race.hint()?.dataset["hint"]).toBe("floors");
    race.firstInput();
    race.advance(6 * SECOND);
    expect(race.hint()?.dataset["hint"]).toBe("restart");
    expect(race.settings.value.seen.climbHints).toBe(false);
    race.advance(6 * SECOND);
    expect(race.settings.value.seen.climbHints).toBe(true);
    expect(race.settings.value.seen.edgeLine).toBe(false);
  });

  it("spends nothing when she leaves before the hints have run", async () => {
    const race = await open("survival");
    race.firstInput();
    race.advance(2 * SECOND);
    race.screen.exit();
    expect(race.settings.value.seen.edgeLine).toBe(false);
  });

  it("spends nothing when she goes out before they have run, and shows nothing once out", async () => {
    const race = await open("survival");
    race.firstInput();
    race.advance(2 * SECOND);
    race.out();
    await vi.waitFor(() => expect(race.hint()).toBeNull());
    race.advance(20 * SECOND);
    expect(race.settings.value.seen.edgeLine).toBe(false);
  });

  it("shows a watcher with no seat no hint, and spends nothing", async () => {
    const race = await open("survival", { seat: false });
    expect(race.hint()).toBeNull();
    race.firstInput();
    race.advance(20 * SECOND);
    expect(race.settings.value.seen.edgeLine).toBe(false);
  });

  it("counts the Survival swipe coach as the lava line: dismissing it spends both, so she is not told twice", async () => {
    const race = await open("survival", { touch: true });
    expect(race.overlay.querySelector('[data-testid="swipe-coach"]')).not.toBeNull();
    expect(race.hint()).toBeNull();
    race.click("swipe-coach-dismiss");
    expect(race.settings.value.seen).toMatchObject({ swipeCoach: true, edgeLine: true });
  });

  it("leaves the floors and restart hints for her next climb when the swipe coach had this one", async () => {
    const race = await open("climb", { touch: true });
    race.click("swipe-coach-dismiss");
    expect(race.settings.value.seen).toMatchObject({ swipeCoach: true, edgeLine: false, climbHints: false });
  });
});
