/**
 * The replay a room records (race-options spec §6), and its re-simulation: the
 * final state and every check match the race that made it, through the
 * server's deflate and either side's inflate.
 */
import { describe, expect, it } from "vitest";
import { asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createRng } from "@floor-fifty/shared/level/rng";
import { unpackReplay, type ReplayCompression } from "@floor-fifty/shared/replay/compression";
import type { Replay } from "@floor-fifty/shared/replay/replay";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { createReplayStepper } from "@floor-fifty/shared/replay/stepper";
import { ReplayRecorder } from "../../../apps/server/src/rooms/replay-recorder";
import { deflateReplaySync, zlibCompression } from "../../../apps/server/src/rooms/replay-compression";
import { streamCompression } from "../../../apps/client/src/features/replay/replay-compression";
import { GO_TICK, REVISIONS, ids, runRoomLike, setStatus } from "../support/room-like";

async function resimulate(replay: Replay, compression: ReplayCompression = zlibCompression) {
  const decoded = await unpackReplay(deflateReplaySync(replay), compression);
  const stepper = createReplayStepper(decoded);
  const mismatches: number[] = [];
  while (!stepper.done) {
    const { check } = stepper.step();
    if (check !== undefined && check.expected !== check.actual) mismatches.push(check.expected);
  }
  const state = stepper.state;
  stepper.dispose();
  return { state, mismatches };
}

async function expectBitIdentical(run: { replay: Replay; final: RaceState }, compression?: ReplayCompression): Promise<void> {
  const { state, mismatches } = await resimulate(run.replay, compression);
  expect(mismatches).toEqual([]);
  expect(run.replay.checks.length).toBeGreaterThan(0);
  expect(stateHash(state)).toBe(run.replay.finalHash);
  expect(stateHash(state)).toBe(stateHash(run.final));
  expect(state.tick).toBe(run.final.tick);
  expect(state.standings).toEqual(run.final.standings);
  expect(state.winnerId).toBe(run.final.winnerId);
}

const FIFTY = resolveTuning({ COURSE_FLOOR_COUNT: 50 });
const INFINITE = resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 });

describe("bit-identical re-simulation (race-options spec §10.1) (a test copy of stepOnce; the real room's cases are in race-room-replay.test.ts, and the burst with a reset is only here)", () => {
  it("a 4-bot 20-floor race of 3 laps", { timeout: 60_000 }, async () => {
    await expectBitIdentical(runRoomLike({ tuning: resolveTuning(), seats: 4, lapCount: 3 }));
  });

  it("a 50-floor race", { timeout: 60_000 }, async () => {
    await expectBitIdentical(runRoomLike({ tuning: FIFTY, seats: 2 }));
  });

  it("a Survival race until the edge puts every racer out", { timeout: 120_000 }, async () => {
    const run = runRoomLike({ tuning: INFINITE, seats: 4 });
    expect(run.final.phase).toBe("finished");
    expect(run.final.tick - GO_TICK).toBeLessThan(10_800);
    expect(Object.values(run.final.players).every((player) => player.outAtTick !== undefined)).toBe(true);
    expect(run.final.course.floorCount).toBeGreaterThan(50);
    await expectBitIdentical(run);
  });

  it("a race with a ghost, a reconnect and a DNS", { timeout: 60_000 }, async () => {
    const [, p2, p3] = ids(3);
    const run = runRoomLike({
      tuning: resolveTuning(),
      seats: 3,
      script: (tick, race, queue) => {
        if (tick === GO_TICK + 300) return setStatus(race, p2!, "ghost");
        if (tick === GO_TICK + 500) return setStatus(race, p2!, "connected");
        if (tick === GO_TICK + 700) {
          queue.forget(p3!);
          return setStatus(race, p3!, "dns");
        }
        return race;
      },
    });
    expect(run.replay.room.map((entry) => entry.status)).toEqual(["ghost", "connected", "dns"]);
    await expectBitIdentical(run);
  });

  it("a race with a burst that carries a reset", { timeout: 60_000 }, async () => {
    const [p1] = ids(1);
    const run = runRoomLike({
      tuning: resolveTuning(),
      seats: 1,
      script: (tick, race, queue) => {
        if (tick === GO_TICK + 400) {
          const sequence = race.players[p1!]!.lastSequence + 1000;
          queue.submit(p1!, { sequence, left: false, right: true, fastFall: false, reset: true, tick: tick + 1 }, tick);
          queue.submit(p1!, { sequence: sequence + 1, left: false, right: true, fastFall: false, reset: false, tick: tick + 1 }, tick);
        }
        return race;
      },
    });
    expect(run.replay.inputs[p1!]!.some((entry) => entry.frame?.reset === true)).toBe(true);
    await expectBitIdentical(run);
  });

  it("re-simulates the server's zlib bytes after the browser's inflate", { timeout: 60_000 }, async () => {
    await expectBitIdentical(runRoomLike({ tuning: resolveTuning(), seats: 2 }), streamCompression);
  });
});

describe("the replay budget (race-options spec §6.5)", () => {
  it("a 4-seat 3:00 Infinite race at the input meter's maximum rate is at most 64 KB", { timeout: 120_000 }, () => {
    const rng = createRng(20_261_001);
    const sequences = [0, 0, 0, 0];
    const { replay } = runRoomLike({
      tuning: INFINITE,
      seats: 4,
      driver: (_tick, seat) => {
        const bits = rng.nextUint32();
        sequences[seat]! += 1;
        return {
          sequence: sequences[seat]!,
          left: (bits & 1) !== 0,
          right: (bits & 2) !== 0,
          fastFall: (bits & 4) !== 0,
          reset: (bits & 0x3ff) === 0,
        };
      },
    });
    expect(deflateReplaySync(replay).length).toBeLessThanOrEqual(64 * 1024);
  });

  it("a 4-seat 20-floor reference race is at most 8 KB", { timeout: 60_000 }, () => {
    const { replay } = runRoomLike({ tuning: resolveTuning(), seats: 4 });
    expect(deflateReplaySync(replay).length).toBeLessThanOrEqual(8 * 1024);
  });
});

describe("the recorder", () => {
  const [p1, p2] = ids(2);
  const go = (): RaceState => {
    const lobby = createRaceState({
      seed: 35229,
      lapCount: 1,
      tuning: resolveTuning(),
      players: [
        { id: p1!, name: asPlayerName("A") },
        { id: p2!, name: asPlayerName("B") },
      ],
    });
    return { ...lobby, tick: GO_TICK, phase: "racing", raceStartedAtTick: GO_TICK };
  };
  const held: HeldInput = { sequence: 1, left: false, right: true, fastFall: false, reset: false };

  it("records a frame only when it changes, and a seat leaving the map as null", () => {
    const recorder = new ReplayRecorder();
    const start = go();
    recorder.start(start, REVISIONS);
    for (let tick = GO_TICK; tick < GO_TICK + 3; tick += 1) {
      recorder.beforeStep({ ...start, tick }, new Map([[p1!, held]]));
      recorder.afterStep({ ...start, tick });
    }
    recorder.beforeStep({ ...start, tick: GO_TICK + 3 }, new Map());
    expect(recorder.snapshot()!.inputs[p1!]).toEqual([
      { tick: GO_TICK, frame: held },
      { tick: GO_TICK + 3, frame: null },
    ]);
    expect(recorder.snapshot()!.inputs[p2!]).toEqual([]);
    expect(recorder.snapshot()!.room).toEqual([]);
  });

  it("records a status the room set between ticks, at the next step, once", () => {
    const recorder = new ReplayRecorder();
    const start = go();
    recorder.start(start, REVISIONS);
    const ghosted = setStatus({ ...start, tick: GO_TICK + 1 }, p2!, "ghost");
    recorder.beforeStep(ghosted, new Map());
    recorder.beforeStep({ ...ghosted, tick: GO_TICK + 2 }, new Map());
    expect(recorder.snapshot()!.room).toEqual([{ tick: GO_TICK + 1, playerId: p2, status: "ghost" }]);
  });

  it("keeps every frame of a long race exactly, past its packed track's first capacity", () => {
    const recorder = new ReplayRecorder();
    const start = go();
    recorder.start(start, REVISIONS);
    const expected: { tick: number; frame: HeldInput | null }[] = [];
    for (let step = 0; step < 1000; step += 1) {
      const tick = GO_TICK + step;
      // A CPU's sequence moves every tick; every seventh tick the seat leaves the map.
      const frame: HeldInput | null =
        step % 7 === 6
          ? null
          : { sequence: 2 ** 40 + step, left: step % 2 === 0, right: step % 3 === 0, fastFall: step % 5 === 0, reset: step % 11 === 0 };
      recorder.beforeStep({ ...start, tick }, frame === null ? new Map() : new Map([[p1!, frame]]));
      expected.push({ tick, frame });
    }
    expect(recorder.snapshot()!.inputs[p1!]).toEqual(expected);
  });

  it("returns nothing until the finish, and keeps nothing after clear", () => {
    const recorder = new ReplayRecorder();
    recorder.start(go(), REVISIONS);
    expect(recorder.afterStep(go())).toBeUndefined();
    recorder.clear();
    expect(recorder.afterStep({ ...go(), phase: "finished" })).toBeUndefined();
    expect(recorder.snapshot()).toBeUndefined();
  });
});
