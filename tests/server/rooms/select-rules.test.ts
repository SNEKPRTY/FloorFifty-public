import { describe, expect, it } from "vitest";
import { LOADING_TIMEOUT_TICKS, REVEAL_TICKS, SELECT_STEP_TICKS, SOLO_REVEAL_TICKS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import { createRaceState, spawnPosition, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { setReady } from "../../../apps/server/src/rooms/lobby-rules";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";
import { drawUniform, rouletteRng } from "@floor-fifty/shared/room/roulette";
import { advanceSelect, enterSelect, lockIn, markLoaded, pickFocus, pickSeed, type SelectContext } from "../../../apps/server/src/rooms/select-rules";

const A = asPlayerId("room-p1");
const B = asPlayerId("room-p2");
const ALL: AccessSets = { stages: ["rooftops", "snow-shrine", "sunken-dome"], songs: ["moving-on", "whats-next", "unseen"], characters: ["ninja"] };
const SEEDS: Record<string, number> = { rooftops: 35229, "snow-shrine": 1111, "sunken-dome": 2222 };
const ctx: SelectContext = {
  accessOf: () => ALL,
  stageCourse: (id) => ({ seed: SEEDS[id]!, tuning: resolveTuning() }),
};

function inSelect(...ids: PlayerId[]): RaceState {
  const race = createRaceState({ seed: 35229, roomSeed: 7, lapCount: 1, tuning: resolveTuning(), players: ids.map((id) => ({ id, name: asPlayerName(id) })) });
  for (const id of ids) setReady(race, id, true);
  enterSelect(race, ctx);
  return race;
}

const step = (race: RaceState, ticks = 1) => {
  for (let index = 0; index < ticks; index += 1) {
    race.tick += 1;
    advanceSelect(race, ctx);
  }
};

/** Every seat locks the stage step, and its reveal runs out: the room is in the song step. */
function inSongStep(...ids: PlayerId[]): RaceState {
  const race = inSelect(...ids);
  for (const id of ids) lockIn(race, id);
  step(race);
  step(race, ids.length === 1 ? SOLO_REVEAL_TICKS : REVEAL_TICKS);
  return race;
}

function refusal(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RoomCommandError) return error.code;
    throw error;
  }
  return undefined;
}

describe("entering select", () => {
  it("moves the lobby to the stage step once everyone is ready, with every seat focused on its first stage", () => {
    const race = inSelect(A, B);
    expect(race.phase).toBe("select");
    expect(race.select!.step).toBe("stage");
    expect(race.select!.endsAtTick).toBe(race.tick + SELECT_STEP_TICKS);
    expect(race.select!.picks[A]).toEqual({ focus: "rooftops", locked: false, seed: "random" });
  });
});

describe("picking", () => {
  it("moves a seat's focus to an accessible stage, or ?", () => {
    const race = inSelect(A, B);
    pickFocus(race, A, "stage", "snow-shrine", ALL);
    pickFocus(race, B, "stage", "?", ALL);
    expect(race.select!.picks[A]!.focus).toBe("snow-shrine");
    expect(race.select!.picks[B]!.focus).toBe("?");
  });

  it("refuses a stage outside the seat's access, a locked seat, and the wrong step", () => {
    const race = inSelect(A, B);
    expect(refusal(() => pickFocus(race, A, "stage", "sunken-dome", { ...ALL, stages: ["rooftops"] }))).toBe("MALFORMED_MESSAGE");
    lockIn(race, A);
    expect(refusal(() => pickFocus(race, A, "stage", "snow-shrine", ALL))).toBe("MALFORMED_MESSAGE");
    step(race); // B still picking; nothing ends
    expect(race.select!.step).toBe("stage");
  });
});

describe("the stage step", () => {
  it("ends early once every connected seat has locked in, and draws a locked pick", () => {
    const race = inSelect(A, B);
    pickFocus(race, A, "stage", "snow-shrine", ALL);
    pickFocus(race, B, "stage", "sunken-dome", ALL);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    expect(race.select!.step).toBe("stageReveal");
    expect(["snow-shrine", "sunken-dome"]).toContain(race.select!.stage!.id);
    expect(race.stageId).toBe(race.select!.stage!.id);
    // Both seats left the seed on Random: the course is the resolved seed's, not the authored one.
    expect(race.seed).toBe(race.select!.stage!.seed);
    expect(race.course.seed).toBe(race.select!.stage!.seed);
    expect(race.select!.endsAtTick).toBe(race.tick + REVEAL_TICKS);
  });

  it("locks every focus at the timeout", () => {
    const race = inSelect(A, B);
    pickFocus(race, A, "stage", "sunken-dome", ALL);
    pickFocus(race, B, "stage", "sunken-dome", ALL);
    step(race, SELECT_STEP_TICKS);
    expect(race.select!.step).toBe("stageReveal");
    expect(race.select!.stage!.id).toBe("sunken-dome");
  });

  it("a lock-in on the timeout tick ends the step once", () => {
    const race = inSelect(A, B);
    step(race, SELECT_STEP_TICKS - 1);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    expect(race.select!.step).toBe("stageReveal");
    const first = race.select!.stage;
    step(race);
    expect(race.select!.stage).toEqual(first);
    expect(race.select!.step).toBe("stageReveal");
  });

  it("resolves the same result for the same room seed, round and picks", () => {
    const run = () => {
      const race = inSelect(A, B);
      pickFocus(race, A, "stage", "?", ALL);
      pickFocus(race, B, "stage", "snow-shrine", ALL);
      step(race, SELECT_STEP_TICKS);
      return race.select!.stage;
    };
    expect(run()).toEqual(run());
  });

  it("resolves ? from the seat's own access", () => {
    const race = inSelect(A);
    pickFocus(race, A, "stage", "?", { ...ALL, stages: ["sunken-dome"] });
    const only: SelectContext = { ...ctx, accessOf: () => ({ ...ALL, stages: ["sunken-dome"] }) };
    lockIn(race, A);
    race.tick += 1;
    advanceSelect(race, only);
    expect(race.select!.stage).toMatchObject({ id: "sunken-dome", pickedBy: A });
  });

  it("a ghost's focus locks at the timeout; a leaver is never drawn", () => {
    const race = inSelect(A, B);
    pickFocus(race, A, "stage", "sunken-dome", ALL);
    pickFocus(race, B, "stage", "snow-shrine", ALL);
    race.players[B]!.status = "ghost";
    lockIn(race, A);
    step(race); // A locked, B is a ghost: connected seats all locked
    expect(race.select!.step).toBe("stageReveal");
    // B's focus stayed in the draw
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const trial = inSelect(A, B);
      trial.roomSeed = seed;
      pickFocus(trial, A, "stage", "sunken-dome", ALL);
      pickFocus(trial, B, "stage", "snow-shrine", ALL);
      trial.players[B]!.status = "ghost";
      step(trial, SELECT_STEP_TICKS);
      drawn.add(trial.select!.stage!.id);
    }
    expect([...drawn].sort()).toEqual(["snow-shrine", "sunken-dome"]);

    const left = inSelect(A, B);
    pickFocus(left, B, "stage", "snow-shrine", ALL);
    pickFocus(left, A, "stage", "sunken-dome", ALL);
    delete left.players[B];
    delete left.select!.picks[B];
    lockIn(left, A);
    step(left);
    expect(left.select!.stage).toMatchObject({ id: "sunken-dome", pickedBy: A });
  });
});

describe("the song step", () => {
  it("follows the stage reveal, every seat focused on its first song", () => {
    const race = inSongStep(A, B);
    expect(race.select!.step).toBe("song");
    expect(race.select!.endsAtTick).toBe(race.tick + SELECT_STEP_TICKS);
    expect(race.select!.picks[A]).toEqual({ focus: "moving-on", locked: false, seed: "random" });
    expect(race.songId).toBeUndefined();
  });

  it("ends once every connected seat has locked in, and sets the race's song", () => {
    const race = inSongStep(A, B);
    const stageId = race.stageId;
    pickFocus(race, A, "song", "whats-next", ALL);
    pickFocus(race, B, "song", "unseen", ALL);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    expect(race.select!.step).toBe("songReveal");
    expect(["whats-next", "unseen"]).toContain(race.select!.song!.id);
    expect(race.songId).toBe(race.select!.song!.id);
    expect(race.stageId).toBe(stageId);
    expect(race.select!.stage).toBeDefined();
    expect(race.select!.endsAtTick).toBe(race.tick + REVEAL_TICKS);
  });

  it("refuses a song in the stage step, a song outside the seat's access, a stage in the song step, and a pick after locking", () => {
    const early = inSelect(A, B);
    expect(refusal(() => pickFocus(early, A, "song", "moving-on", ALL))).toBe("MALFORMED_MESSAGE");
    const race = inSongStep(A, B);
    expect(refusal(() => pickFocus(race, A, "song", "unseen", { ...ALL, songs: ["moving-on"] }))).toBe("MALFORMED_MESSAGE");
    expect(refusal(() => pickFocus(race, A, "stage", "snow-shrine", ALL))).toBe("MALFORMED_MESSAGE");
    lockIn(race, A);
    expect(refusal(() => pickFocus(race, A, "song", "whats-next", ALL))).toBe("MALFORMED_MESSAGE");
    expect(race.select!.picks[A]).toEqual({ focus: "moving-on", locked: true, seed: "random" });
  });

  it("resolves the same song for the same room seed, round and picks", () => {
    const run = () => {
      const race = inSongStep(A, B);
      pickFocus(race, A, "song", "?", ALL);
      pickFocus(race, B, "song", "whats-next", ALL);
      step(race, SELECT_STEP_TICKS);
      return race.select!.song;
    };
    expect(run()).toEqual(run());
  });

  it("resolves ? from the seat's own access", () => {
    const race = inSongStep(A);
    const only: SelectContext = { ...ctx, accessOf: () => ({ ...ALL, songs: ["unseen"] }) };
    pickFocus(race, A, "song", "?", ALL);
    lockIn(race, A);
    race.tick += 1;
    advanceSelect(race, only);
    expect(race.select!.song).toEqual({ id: "unseen", pickedBy: A });
  });

  it("reveals for 1 s with one seat", () => {
    const solo = inSongStep(A);
    lockIn(solo, A);
    step(solo);
    expect(solo.select!.step).toBe("songReveal");
    expect(solo.select!.endsAtTick - solo.tick).toBe(SOLO_REVEAL_TICKS);
  });

  it("a ghost's song locks at the timeout; a leaver's is never drawn", () => {
    const race = inSongStep(A, B);
    pickFocus(race, A, "song", "whats-next", ALL);
    pickFocus(race, B, "song", "unseen", ALL);
    race.players[B]!.status = "ghost";
    step(race); // A has not locked in: nothing ends
    expect(race.select!.step).toBe("song");
    step(race, SELECT_STEP_TICKS);
    expect(race.select!.step).toBe("songReveal");
    expect(race.select!.picks[B]).toEqual({ focus: "unseen", locked: true, seed: "random" });
    // B's focus stays in the draw
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const trial = inSongStep(A, B);
      trial.roomSeed = seed;
      pickFocus(trial, A, "song", "whats-next", ALL);
      pickFocus(trial, B, "song", "unseen", ALL);
      trial.players[B]!.status = "ghost";
      lockIn(trial, A);
      step(trial);
      drawn.add(trial.select!.song!.id);
    }
    expect([...drawn].sort()).toEqual(["unseen", "whats-next"]);

    const left = inSongStep(A, B);
    pickFocus(left, B, "song", "unseen", ALL);
    pickFocus(left, A, "song", "whats-next", ALL);
    delete left.players[B];
    delete left.select!.picks[B];
    lockIn(left, A);
    step(left);
    expect(left.select!.song).toEqual({ id: "whats-next", pickedBy: A });
  });
});

describe("the reveal and loading", () => {
  it("reveals for 1 s with one seat, and 2.5 s with more", () => {
    const solo = inSelect(A);
    lockIn(solo, A);
    step(solo);
    expect(solo.select!.endsAtTick - solo.tick).toBe(SOLO_REVEAL_TICKS);
  });

  it("goes through the song step to loading, then the countdown once every connected seat has loaded", () => {
    const race = inSongStep(A, B);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    step(race, REVEAL_TICKS);
    expect(race.select!.step).toBe("loading");
    markLoaded(race, A);
    step(race);
    expect(race.phase).toBe("select");
    markLoaded(race, B);
    step(race);
    expect(race.phase).toBe("countdown");
    expect(race.select).toBeUndefined();
    expect(race.stageId).toBeDefined();
    expect(race.songId).toBeDefined();
  });

  it("re-seats every racer on the start floor as the countdown begins", () => {
    const race = inSongStep(A, B);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    step(race, REVEAL_TICKS);
    expect(race.select!.step).toBe("loading");
    race.players[A]!.x += 100;
    race.players[B]!.y += 50;
    markLoaded(race, A);
    markLoaded(race, B);
    step(race);
    expect(race.phase).toBe("countdown");
    const spawn = spawnPosition(race.course, race.tuning);
    for (const player of Object.values(race.players)) {
      expect(player).toMatchObject({ x: spawn.x, y: spawn.y, vx: 0, vy: 0, awaitingInput: true, lap: 1 });
    }
  });

  it("loading times out at 10 s", () => {
    const race = inSongStep(A, B);
    lockIn(race, A);
    lockIn(race, B);
    step(race);
    step(race, REVEAL_TICKS);
    markLoaded(race, A);
    step(race, LOADING_TIMEOUT_TICKS);
    expect(race.phase).toBe("countdown");
  });

  it("refuses loaded outside loading and lockIn outside a pick step", () => {
    const race = inSelect(A);
    expect(refusal(() => markLoaded(race, A))).toBe("MALFORMED_MESSAGE");
    lockIn(race, A);
    step(race);
    expect(refusal(() => lockIn(race, A))).toBe("MALFORMED_MESSAGE");
  });
});

describe("a room nobody is connected to", () => {
  // Review finding 1: with every seat a ghost, "every connected seat has
  // locked in" held vacuously, so a solo player who reloaded came back to a
  // race already running. The lobby has the same guard for readiness.
  it("waits out the pick step's clock rather than ending it at once", () => {
    const race = inSelect(A);
    race.players[A]!.status = "ghost";
    step(race);
    expect(race.select!.step).toBe("stage");
    step(race, SELECT_STEP_TICKS);
    expect(race.select!.step).toBe("stageReveal");
  });

  it("waits out the loading clock rather than starting the countdown at once", () => {
    const race = inSongStep(A);
    lockIn(race, A);
    step(race);
    step(race, SOLO_REVEAL_TICKS);
    expect(race.select!.step).toBe("loading");
    race.players[A]!.status = "ghost";
    step(race);
    expect(race.phase).toBe("select");
    step(race, LOADING_TIMEOUT_TICKS);
    expect(race.phase).toBe("countdown");
  });
});

describe("random never repeats the last two", () => {
  /** Runs a whole select with one seat on `focus`, on round `round`, and returns the stage and song it landed on. */
  function selectOnce(race: RaceState, round: number, focus: { stage: string; song: string }): { stage: string; song: string } {
    race.round = round;
    race.phase = "select";
    delete race.select;
    enterSelect(race, ctx);
    pickFocus(race, A, "stage", focus.stage, ALL);
    lockIn(race, A);
    step(race);
    step(race, SOLO_REVEAL_TICKS);
    pickFocus(race, A, "song", focus.song, ALL);
    lockIn(race, A);
    step(race);
    return { stage: race.select!.stage!.id, song: race.select!.song!.id };
  }

  it("draws ? from outside the last two stages and songs, whatever the room seed", () => {
    for (let roomSeed = 1; roomSeed <= 50; roomSeed += 1) {
      const race = inSelect(A);
      race.roomSeed = roomSeed;
      const landed = [0, 1, 2, 3, 4, 5].map((round) => selectOnce(race, round, { stage: "?", song: "?" }));
      for (let index = 2; index < landed.length; index += 1) {
        expect([landed[index - 1]!.stage, landed[index - 2]!.stage]).not.toContain(landed[index]!.stage);
        expect([landed[index - 1]!.song, landed[index - 2]!.song]).not.toContain(landed[index]!.song);
      }
      expect(landed[1]!.stage).not.toBe(landed[0]!.stage);
    }
  });

  it("still lands on a recent stage someone picked by name", () => {
    const race = inSelect(A);
    selectOnce(race, 0, { stage: "rooftops", song: "unseen" });
    expect(selectOnce(race, 1, { stage: "rooftops", song: "unseen" })).toEqual({ stage: "rooftops", song: "unseen" });
  });

  it("falls back to the least recent when the seat's access is too small to avoid both", () => {
    const two: AccessSets = { ...ALL, stages: ["rooftops", "snow-shrine"] };
    const small: SelectContext = { ...ctx, accessOf: () => two };
    const race = inSelect(A);
    race.recentPicks = { stage: ["rooftops", "snow-shrine"] };
    race.round = 1;
    race.phase = "select";
    delete race.select;
    enterSelect(race, small);
    pickFocus(race, A, "stage", "?", two);
    lockIn(race, A);
    race.tick += 1;
    advanceSelect(race, small);
    expect(race.select!.stage!.id).toBe("rooftops");
  });
});

describe("seeds (stage seeds spec §3)", () => {
  /** Locks every seat and ends the stage step: the stage and its seed are resolved. */
  const resolveStage = (race: RaceState, ...ids: PlayerId[]) => {
    for (const id of ids) lockIn(race, id);
    step(race);
    return race.select!.stage!;
  };

  it("opens every seat on Random", () => {
    const race = inSelect(A, B);
    expect(race.select!.picks[A]!.seed).toBe("random");
    expect(race.select!.picks[B]!.seed).toBe("random");
  });

  it("takes Random, Classic or a number, and keeps it when the focus moves", () => {
    const race = inSelect(A);
    pickSeed(race, A, 48213);
    pickFocus(race, A, "stage", "snow-shrine", ALL);
    expect(race.select!.picks[A]!.seed).toBe(48213);
    pickSeed(race, A, "classic");
    expect(race.select!.picks[A]!.seed).toBe("classic");
  });

  it("refuses a seed out of bounds, a locked seat and the song step", () => {
    const race = inSelect(A, B);
    expect(refusal(() => pickSeed(race, A, 1_000_000))).toBe("MALFORMED_MESSAGE");
    expect(refusal(() => pickSeed(race, A, -1))).toBe("MALFORMED_MESSAGE");
    expect(refusal(() => pickSeed(race, A, 2.5))).toBe("MALFORMED_MESSAGE");
    lockIn(race, A);
    expect(refusal(() => pickSeed(race, A, 5))).toBe("MALFORMED_MESSAGE");
    const song = inSongStep(A);
    expect(refusal(() => pickSeed(song, A, 5))).toBe("MALFORMED_MESSAGE");
  });

  it("races an entered seed as it is", () => {
    const race = inSelect(A);
    pickSeed(race, A, 12345);
    expect(resolveStage(race, A)).toMatchObject({ id: "rooftops", seed: 12345, classic: false });
    expect(race.seed).toBe(12345);
    expect(race.course.seed).toBe(12345);
  });

  it("races Classic on the stage's authored seed, and an entered authored seed is Classic too", () => {
    const race = inSelect(A);
    pickFocus(race, A, "stage", "snow-shrine", ALL);
    pickSeed(race, A, "classic");
    expect(resolveStage(race, A)).toMatchObject({ id: "snow-shrine", seed: 1111, classic: true });
    expect(race.course.seed).toBe(1111);
    const typed = inSelect(A);
    pickSeed(typed, A, 35229);
    expect(resolveStage(typed, A)).toMatchObject({ seed: 35229, classic: true });
  });

  it("draws Random from the roulette: the same room and round agree, and the next round differs", () => {
    const first = resolveStage(inSelect(A), A);
    const again = resolveStage(inSelect(A), A);
    expect(first.seed).toBe(again.seed);
    expect(first.seed! >= 0 && first.seed! <= 999_999).toBe(true);
    expect(first.classic).toBe(false);
    const later = inSelect(A);
    later.round += 1;
    expect(resolveStage(later, A).seed).not.toBe(first.seed);
  });

  it("draws the same stage as before seeds existed", () => {
    // The seed is drawn after the stage, so the roulette's stage draw is unchanged.
    const race = inSelect(A, B);
    pickFocus(race, A, "stage", "snow-shrine", ALL);
    pickFocus(race, B, "stage", "sunken-dome", ALL);
    const before = drawUniform(rouletteRng(7, race.round, "stage"), [
      { id: "snow-shrine", pickedBy: A },
      { id: "sunken-dome", pickedBy: B },
    ]);
    expect(resolveStage(race, A, B).id).toBe(before.id);
  });

  it("gives a seat that times out its own choice, and Random to one that never chose", () => {
    const race = inSelect(A, B);
    pickSeed(race, B, 777);
    step(race, SELECT_STEP_TICKS);
    const result = race.select!.stage!;
    if (result.pickedBy === B) expect(result.seed).toBe(777);
    else expect(result).toMatchObject({ classic: false });
    expect(race.select!.picks[A]!.seed).toBe("random");
  });

  it("resolves a ? stage, then its seed", () => {
    const race = inSelect(A);
    pickFocus(race, A, "stage", "?", ALL);
    pickSeed(race, A, "classic");
    const result = resolveStage(race, A);
    expect(result.seed).toBe(SEEDS[result.id]);
    expect(result.classic).toBe(true);
  });
});
