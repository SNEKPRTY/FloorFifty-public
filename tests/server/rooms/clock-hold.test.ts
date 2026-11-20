import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, RECONNECT_GRACE_TICKS, SELECT_STEP_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { HELD_GRACE_SECONDS, abandonedByPeople, graceSeconds, holdClocks, isClockName } from "../../../apps/server/src/rooms/clock-hold";
import { setReady } from "../../../apps/server/src/rooms/lobby-rules";
import { enterSelect, type SelectContext } from "../../../apps/server/src/rooms/select-rules";

const A = asPlayerId("room-p1");
const ALL: AccessSets = { stages: ["rooftops"], songs: ["moving-on"], characters: ["ninja"] };
const ctx: SelectContext = { accessOf: () => ALL, stageCourse: () => ({ seed: 35229, tuning: resolveTuning() }) };

function inSelect(): RaceState {
  const race = createRaceState({ seed: 35229, roomSeed: 7, lapCount: 1, tuning: resolveTuning(), players: [{ id: A, name: asPlayerName(A) }] });
  setReady(race, A, true);
  enterSelect(race, ctx);
  return race;
}

describe("holding a room's clocks (the browser suite's way of keeping a screen up)", () => {
  it("pushes a held select step's end back by the tick that just passed", () => {
    const race = inSelect();
    const ends = race.select!.endsAtTick;
    expect(ends).toBe(race.tick + SELECT_STEP_TICKS);
    race.tick += 1;
    holdClocks(race, new Set(["stage"]));
    expect(race.select!.endsAtTick).toBe(ends + 1);
    // What the clients read, the ticks left on the step, is what it was.
    expect(race.select!.endsAtTick - race.tick).toBe(SELECT_STEP_TICKS);
  });

  it("leaves a step that was not named to run out", () => {
    const race = inSelect();
    const ends = race.select!.endsAtTick;
    race.tick += 1;
    holdClocks(race, new Set(["song", "countdown"]));
    expect(race.select!.endsAtTick).toBe(ends);
  });

  it("pushes a held countdown's end back, and only while the room is counting", () => {
    const race = inSelect();
    delete race.select;
    race.phase = "countdown";
    race.countdownEndsAtTick = race.tick + COUNTDOWN_TICKS;
    race.tick += 1;
    holdClocks(race, new Set(["countdown"]));
    expect(race.countdownEndsAtTick - race.tick).toBe(COUNTDOWN_TICKS);

    race.phase = "racing";
    delete race.countdownEndsAtTick;
    holdClocks(race, new Set(["countdown"]));
    expect(race.countdownEndsAtTick).toBeUndefined();
  });

  it("does nothing when nothing is held, or outside select and the countdown", () => {
    const race = inSelect();
    const ends = race.select!.endsAtTick;
    holdClocks(race, new Set());
    expect(race.select!.endsAtTick).toBe(ends);

    const lobby = createRaceState({ seed: 35229, roomSeed: 7, lapCount: 1, tuning: resolveTuning(), players: [{ id: A, name: asPlayerName(A) }] });
    holdClocks(lobby, new Set(["stage", "countdown"]));
    expect(lobby.phase).toBe("lobby");
    expect(lobby.select).toBeUndefined();
    expect(lobby.countdownEndsAtTick).toBeUndefined();
  });

  it("keeps a dropped seat for as long as anything is held, so a page that reloads is still the player it was", () => {
    const race = inSelect();
    const player = race.players[A]!;
    player.status = "ghost";
    player.ghostDeadlineTick = race.tick + RECONNECT_GRACE_TICKS;
    race.tick += 1;
    holdClocks(race, new Set(["song"]));
    expect(player.ghostDeadlineTick - race.tick).toBe(RECONNECT_GRACE_TICKS);

    race.tick += 1;
    holdClocks(race, new Set());
    expect(player.ghostDeadlineTick - race.tick).toBe(RECONNECT_GRACE_TICKS - 1);
  });

  it("gives a dropped seat the usual grace, or a long one while the room is held", () => {
    expect(graceSeconds(new Set())).toBe(RECONNECT_GRACE_TICKS / TICK_HZ);
    expect(graceSeconds(new Set(["stage"]))).toBe(HELD_GRACE_SECONDS);
    expect(HELD_GRACE_SECONDS).toBeGreaterThan(RECONNECT_GRACE_TICKS / TICK_HZ);
  });

  it("calls a room abandoned only when people sat in it and none is connected now", () => {
    // A room nobody has joined yet (the host's seat arrives with their join).
    const empty = inSelect();
    delete empty.players[A];
    expect(abandonedByPeople(empty)).toBe(false);

    const race = inSelect();
    expect(abandonedByPeople(race)).toBe(false);
    race.players[A]!.status = "ghost";
    expect(abandonedByPeople(race)).toBe(true);

    // A CPU is not looking at anything: a room of CPUs and a ghost is abandoned, and of CPUs alone is not.
    race.players[A]!.status = "connected";
    const cpuOnly = { ...race, players: { cpu: { ...race.players[A]!, cpu: true, status: "connected" } } } as unknown as RaceState;
    expect(abandonedByPeople(cpuOnly)).toBe(false);
  });

  it("names every select step and the countdown, and nothing else", () => {
    for (const name of ["stage", "stageReveal", "song", "songReveal", "loading", "countdown"]) expect(isClockName(name)).toBe(true);
    for (const name of ["", "racing", "STAGE", "lobby"]) expect(isClockName(name)).toBe(false);
    expect(isClockName(7)).toBe(false);
  });
});
