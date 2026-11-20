import { describe, expect, it } from "vitest";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { cloneRaceState, createRaceState, floorX, type RaceState } from "@floor-fifty/shared/common/state";
import { endlessRaceState, placeAtFloor } from "../../shared/support/race";
import { TUNABLES, resolveTuning } from "@floor-fifty/shared/common/tuning";
import {
  ABSENT_ID,
  ABSENT_TICK,
  RaceRoomState,
} from "../../../apps/server/src/rooms/race-room-state";
import { projectRace } from "../../../apps/server/src/rooms/race-projection";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { TEST_REVISIONS } from "../support/colyseus-harness";

const tuning = resolveTuning();
const PLAYER = asPlayerId("p1");

function racing(overrides: Partial<RaceState> = {}): RaceState {
  const base = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [{ id: PLAYER, name: asPlayerName("Kite") }],
  });
  return { ...base, phase: "racing", raceStartedAtTick: 0, ...overrides };
}

describe("the race room schema", () => {
  it("carries whether a seat is a CPU", () => {
    const race = createRaceState({
      seed: 7,
      lapCount: 1,
      tuning,
      players: [
        { id: asPlayerId("r-p1"), name: asPlayerName("Kite") },
        { id: asPlayerId("r-p2"), name: asPlayerName("Koi") },
      ],
    });
    race.players[asPlayerId("r-p2")]!.cpu = true;
    const state = new RaceRoomState();
    projectRace(state, race, TEST_REVISIONS);
    expect(state.players.get("r-p1")!.cpu).toBe(false);
    expect(state.players.get("r-p2")!.cpu).toBe(true);
  });

  it("carries every tunable the client predicts with", () => {
    const state = new RaceRoomState();
    projectRace(state, racing(), TEST_REVISIONS);
    for (const name of Object.keys(TUNABLES)) {
      expect(state.tuning[name as keyof typeof TUNABLES]).toBe(tuning[name as never]);
    }
  });

  it("carries how long a seat's edge waited, and zero for one that never did", () => {
    const source = createRaceState({
      seed: 7,
      lapCount: 1,
      tuning,
      players: [
        { id: asPlayerId("r-p1"), name: asPlayerName("Kite") },
        { id: asPlayerId("r-p2"), name: asPlayerName("Koi") },
      ],
    });
    source.players[asPlayerId("r-p1")]!.edgeWaitTicks = 300;
    const state = new RaceRoomState();
    projectRace(state, { ...source, phase: "racing", raceStartedAtTick: 0 }, TEST_REVISIONS);
    expect(state.players.get("r-p1")!.edgeWaitTicks).toBe(300);
    expect(state.players.get("r-p2")!.edgeWaitTicks).toBe(0);
  });

  it("projects players, platforms and standings", () => {
    const source = racing();
    const state = new RaceRoomState();
    projectRace(state, source, TEST_REVISIONS);

    expect(state.players.size).toBe(1);
    expect(state.platforms.size).toBe(source.course.floorCount);

    const player = state.players.get(PLAYER)!;
    expect(player.name).toBe("Kite");
    expect(player.x).toBe(source.players[PLAYER]!.x);
    expect(player.progress).toBeCloseTo(1 / source.course.floorCount, 9);
    expect(player.lastAckedSequence).toBe(0);

    const floor = state.platforms.get("floor-0")!;
    expect(floor.x).toBe(floorX(source, source.course.floors[0]!));
    expect([...floor.collectedBy]).toEqual([PLAYER]);
  });

  it("uses documented sentinels rather than an ambiguous default", () => {
    const source = racing();
    delete source.raceStartedAtTick;
    const state = new RaceRoomState();
    projectRace(state, source, TEST_REVISIONS);
    expect(state.countdownEndsAtTick).toBe(ABSENT_TICK);
    expect(state.raceStartedAtTick).toBe(ABSENT_TICK);
    expect(state.winnerId).toBe(ABSENT_ID);
    expect(state.players.get(PLAYER)!.finishedAtTick).toBe(ABSENT_TICK);
    expect(Number.isNaN(state.players.get(PLAYER)!.finishedAtTick)).toBe(false);
  });

  it("projects a lapping racer's hold, and clears it once the hold is over", () => {
    // The client holds the racer on the same tick the room does only if the
    // hold reaches the wire (race-flow spec §4.1).
    const source = racing();
    source.players[PLAYER]!.holdUntilTick = 312;
    const state = new RaceRoomState();
    projectRace(state, source, TEST_REVISIONS);
    expect(state.players.get(PLAYER)!.holdUntilTick).toBe(312);

    delete source.players[PLAYER]!.holdUntilTick;
    projectRace(state, source, TEST_REVISIONS);
    expect(state.players.get(PLAYER)!.holdUntilTick).toBe(ABSENT_TICK);
    expect(Number.isNaN(state.players.get(PLAYER)!.holdUntilTick)).toBe(false);
  });

  it("collects nothing for a player who has not started climbing", () => {
    const source = racing();
    const idle = createRaceState({
      seed: source.seed,
      lapCount: source.lapCount,
      tuning: source.tuning,
      players: [{ id: PLAYER, name: asPlayerName("Kite") }],
    });
    idle.players[PLAYER]!.visitedFloorIds = [];
    const state = new RaceRoomState();
    projectRace(state, { ...idle, phase: "racing", raceStartedAtTick: 0 }, TEST_REVISIONS);

    expect([...state.platforms.get("floor-0")!.collectedBy]).toEqual([]);
    expect(state.players.get(PLAYER)!.progress).toBe(0);
  });

  it("projects a moving floor's travel direction, which its position cannot imply", () => {
    const source = racing();
    const floor = source.course.floors[1]!;
    const moving: RaceState = {
      ...source,
      movingFloors: {
        ...source.movingFloors,
        [floor.id]: { ...source.movingFloors[floor.id]!, direction: -1 },
      },
    };
    const state = new RaceRoomState();
    projectRace(state, moving, TEST_REVISIONS);

    // The floor that never moves keeps the direction it was generated with.
    expect(state.platforms.get(floor.id)!.direction).toBe(-1);
    expect(state.platforms.get(source.course.floors[0]!.id)!.direction).toBe(
      source.course.floors[0]!.direction,
    );
  });

  it("mutates in place rather than replacing the root or its children", () => {
    const state = new RaceRoomState();
    projectRace(state, racing(), TEST_REVISIONS);
    const playersBefore = state.players;
    const playerBefore = state.players.get(PLAYER)!;
    const platformsBefore = state.platforms;

    projectRace(state, racing({ tick: 7 }), TEST_REVISIONS);

    expect(state.players).toBe(playersBefore);
    expect(state.players.get(PLAYER)).toBe(playerBefore);
    expect(state.platforms).toBe(platformsBefore);
    expect(state.tick).toBe(7);
  });

  it("follows a floor's collectors as racers land on it, in player order", () => {
    const race = createRaceState({
      seed: 4182,
      lapCount: 1,
      tuning,
      players: [
        { id: asPlayerId("c-p1"), name: asPlayerName("Kite") },
        { id: asPlayerId("c-p2"), name: asPlayerName("Koi") },
      ],
    });
    const source: RaceState = { ...race, phase: "racing", raceStartedAtTick: 0 };
    const floor = source.course.floors[3]!;
    const state = new RaceRoomState();
    projectRace(state, source, TEST_REVISIONS);
    expect([...state.platforms.get(floor.id)!.collectedBy]).toEqual([]);

    source.players[asPlayerId("c-p2")]!.visitedFloorIds.push(floor.id);
    projectRace(state, source, TEST_REVISIONS);
    expect([...state.platforms.get(floor.id)!.collectedBy]).toEqual(["c-p2"]);

    source.players[asPlayerId("c-p1")]!.visitedFloorIds.push(floor.id);
    projectRace(state, source, TEST_REVISIONS);
    expect([...state.platforms.get(floor.id)!.collectedBy]).toEqual(["c-p1", "c-p2"]);

    // A new ascent clears what the racer collected.
    source.players[asPlayerId("c-p1")]!.visitedFloorIds = [source.course.floors[0]!.id];
    projectRace(state, source, TEST_REVISIONS);
    expect([...state.platforms.get(floor.id)!.collectedBy]).toEqual(["c-p2"]);
  });

  it("carries a race's new tuning, when the tuning is replaced", () => {
    const state = new RaceRoomState();
    projectRace(state, racing(), TEST_REVISIONS);
    expect(state.tuning.GRAVITY).toBe(tuning.GRAVITY);

    const heavier = resolveTuning({ GRAVITY: tuning.GRAVITY * 2 });
    projectRace(state, racing({ tuning: heavier }), TEST_REVISIONS);
    expect(state.tuning.GRAVITY).toBe(heavier.GRAVITY);
  });

  it("drops a player who has left the race", () => {
    const state = new RaceRoomState();
    projectRace(state, racing(), TEST_REVISIONS);
    projectRace(state, racing({ players: {} }), TEST_REVISIONS);
    expect(state.players.size).toBe(0);
  });

  it("projects the select step, every pick, the stage and who loaded", () => {
    const state = new RaceRoomState();
    const race: RaceState = { ...racing(), phase: "select", roomSeed: 99 };
    race.select = {
      step: "stageReveal",
      endsAtTick: 300,
      picks: { [PLAYER]: { focus: "snow-shrine", locked: true, seed: 48213 } },
      stage: { id: "snow-shrine", pickedBy: PLAYER, seed: 48213, classic: false },
      loaded: [],
    };
    race.stageId = "snow-shrine";
    projectRace(state, race, { ...TEST_REVISIONS, courseRevisions: { "snow-shrine": asRevision("c".repeat(64)) } });
    expect(state.select.step).toBe("stageReveal");
    expect(state.select.picks.get(PLAYER)!.focus).toBe("snow-shrine");
    expect(state.select.picks.get(PLAYER)!.seed).toBe("48213");
    expect(state.select.stageSeed).toBe(48213);
    expect(state.select.stageClassic).toBe(false);
    expect(state.select.stageId).toBe("snow-shrine");
    expect(state.select.stagePickedBy).toBe(PLAYER);
    expect(state.stageId).toBe("snow-shrine");
    expect(state.roomSeed).toBe(99);
    expect(state.courseRevision).toBe("c".repeat(64));
  });

  it("projects the song result and the race's song", () => {
    const state = new RaceRoomState();
    const race: RaceState = { ...racing(), phase: "select" };
    race.select = {
      step: "songReveal",
      endsAtTick: 600,
      picks: { [PLAYER]: { focus: "whats-next", locked: true, seed: "random" } },
      stage: { id: "snow-shrine", pickedBy: PLAYER },
      song: { id: "whats-next", pickedBy: PLAYER },
      loaded: [],
    };
    race.stageId = "snow-shrine";
    race.songId = "whats-next";
    projectRace(state, race, TEST_REVISIONS);
    expect(state.select.step).toBe("songReveal");
    expect(state.select.stageId).toBe("snow-shrine");
    expect(state.select.songId).toBe("whats-next");
    expect(state.select.songPickedBy).toBe(PLAYER);
    expect(state.songId).toBe("whats-next");
  });

  it("keeps the race's song once select is over", () => {
    const state = new RaceRoomState();
    projectRace(state, racing({ songId: "whats-next" }), TEST_REVISIONS);
    expect(state.songId).toBe("whats-next");
    expect(state.select.songId).toBe(ABSENT_ID);
  });

  it("projects no select outside the select phase", () => {
    const state = new RaceRoomState();
    projectRace(state, racing(), TEST_REVISIONS);
    expect(state.select.step).toBe(ABSENT_ID);
    expect(state.stageId).toBe(ABSENT_ID);
    expect(state.songId).toBe(ABSENT_ID);
    expect(state.select.songId).toBe(ABSENT_ID);
    expect(state.select.songPickedBy).toBe(ABSENT_ID);
    expect(state.select.stageSeed).toBe(-1);
    expect(state.select.stageClassic).toBe(false);
  });
});

describe("an endless race on the wire (race-options spec §5.4)", () => {
  const P1 = asPlayerId("p1");

  it("projects an endless course's window only, and its height", () => {
    const source = placeAtFloor(endlessRaceState(1), P1, 30);
    const target = new RaceRoomState();
    projectRace(target, source, TEST_REVISIONS);
    expect([...target.platforms.keys()].sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `floor-${24 + i}`).sort(),
    );
    expect(target.floorCount).toBe(source.course.floorCount);
  });

  it("drops a platform that left the window", () => {
    const target = new RaceRoomState();
    projectRace(target, placeAtFloor(endlessRaceState(1), P1, 30), TEST_REVISIONS);
    projectRace(target, placeAtFloor(endlessRaceState(1), P1, 10), TEST_REVISIONS);
    expect(target.platforms.has("floor-30")).toBe(false);
    expect(target.platforms.has("floor-10")).toBe(true);
  });

  it("projects a best floor, and an endless racer's progress from it", () => {
    const source = cloneRaceState(endlessRaceState(1));
    source.players[P1]!.bestFloor = 49;
    source.players[P1]!.bestFloorAtTick = 2400;
    const target = new RaceRoomState();
    projectRace(target, source, TEST_REVISIONS);
    const row = target.players.get(P1)!;
    expect([row.bestFloor, row.bestFloorAtTick, row.progress]).toEqual([49, 2400, 1]);
  });

  it("marks a best floor never reached as absent", () => {
    const target = new RaceRoomState();
    projectRace(target, racing(), TEST_REVISIONS);
    expect(target.players.get(PLAYER)!.bestFloorAtTick).toBe(ABSENT_TICK);
  });
});
