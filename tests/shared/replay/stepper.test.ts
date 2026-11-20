/**
 * The replay stepper (race-options spec §7.2) rebuilds the GO state from the
 * header, floors and all, from the seed and tuning alone.
 */
import { describe, expect, it } from "vitest";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { decodeReplay, encodeReplay } from "@floor-fifty/shared/replay/codec";
import { REPLAY_CHECK_TICKS, type InputEntry, type Replay } from "@floor-fifty/shared/replay/replay";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { createReplayStepper, goStateOf } from "@floor-fifty/shared/replay/stepper";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { ENDLESS_TUNING, endlessRaceState } from "../support/race";

describe("the replay stepper", () => {
  it("rebuilds the GO state's course from its seed and tuning", () => {
    const { course, ...go } = endlessRaceState(1);
    const replay = { header: { go }, inputs: {}, room: [], checks: [], finalTick: go.tick, finalHash: 0 } as unknown as Replay;
    expect(goStateOf(replay).course).toEqual(createCourse(go.seed, go.tuning));
    expect(goStateOf(replay).course).toEqual(course);
  });

  describe("a Survival race with a waiting racer (first-race spec §2)", () => {
    const P1 = asPlayerId("p1");
    const P2 = asPlayerId("p2");
    const P3 = asPlayerId("p3");
    const press = (sequence: number, flags: Partial<HeldInput>): HeldInput => ({
      sequence,
      left: false,
      right: false,
      fastFall: false,
      reset: false,
      ...flags,
    });

    /**
     * Records a three-seat Survival race as a room would, by its own loop and not
     * the stepper's: p1's first input comes at `firstInputAt.p1` (none for a seat
     * listed in `idle`), p3 is a computer seat pressing from tick 1. A check is taken
     * after every 60th step, and the recording runs to the end of the race.
     * `tuning` builds the GO state's tuning; `without` removes a key from it, as in a
     * GO state recorded before that tunable existed.
     */
    function recordSurvival(options: { firstInputAt?: { p1: number }; idle: readonly PlayerId[]; tuning?: Partial<ResolvedTuning>; without?: keyof ResolvedTuning }): Replay {
      const tuning: Partial<ResolvedTuning> = { ...ENDLESS_TUNING(options.tuning) };
      if (options.without !== undefined) delete tuning[options.without];
      const created = createRaceState({
        seed: 35229,
        lapCount: 1,
        tuning: tuning as ResolvedTuning,
        players: [P1, P2, P3].map((id, i) => ({ id, name: asPlayerName(`Racer ${i + 1}`) })),
      });
      created.players[P3]!.cpu = true;
      const go: RaceState = { ...created, phase: "racing", raceStartedAtTick: 0 };
      const { course: _course, ...header } = go;

      const inputs: Record<PlayerId, InputEntry[]> = { [P1]: [], [P2]: [], [P3]: [] };
      // One fast-fall press and then nothing: a racer who has started and stays on the first floor,
      // so the race runs until each edge has caught somebody.
      const pressOnce = (seat: PlayerId, tick: number) =>
        inputs[seat]!.push({ tick, frame: press(1, { fastFall: true }) }, { tick: tick + 1, frame: press(2, {}) });
      if (!options.idle.includes(P1)) pressOnce(P1, options.firstInputAt?.p1 ?? 1);
      pressOnce(P3, 1);

      const simulation = createRaceSimulation(go);
      simulation.restore(go);
      const inForce = new Map<PlayerId, HeldInput>();
      const cursors: Record<PlayerId, number> = { [P1]: 0, [P2]: 0, [P3]: 0 };
      const checks: Replay["checks"] = [];
      let state = go;
      let tick = go.tick;
      for (let step = 1; ; step += 1) {
        if (step > 1) {
          tick += 1;
          state = { ...state, tick };
        }
        for (const seat of [P1, P2, P3]) {
          const track = inputs[seat]!;
          while (track[cursors[seat]!]?.tick === tick) inForce.set(seat, track[cursors[seat]!++]!.frame!);
        }
        state = simulation.step(state, new Map(inForce)).state;
        if (step % REPLAY_CHECK_TICKS === 0) checks.push({ tick, hash: stateHash(state) });
        if (state.phase === "finished") break;
        if (tick > 20_000) throw new Error("the race never ended");
      }
      simulation.dispose();
      return {
        header: {
          format: 1,
          rulesetRevision: "r".repeat(64),
          courseRevision: "c".repeat(64),
          contentRevision: "t".repeat(64),
          stageId: "rooftops",
          songId: undefined,
          modeId: "infinite",
          lapCount: 1,
          seats: [P1, P2, P3],
          go: header,
        },
        inputs,
        room: [],
        checks,
        finalTick: tick,
        finalHash: stateHash(state),
      };
    }

    /** Plays `replay` through the stepper, every check compared; returns the last state. */
    function play(replay: Replay): RaceState {
      const stepper = createReplayStepper(replay);
      while (!stepper.done) {
        const { check } = stepper.step();
        if (check !== undefined) expect(check.actual).toBe(check.expected);
      }
      const { state } = stepper;
      stepper.dispose();
      return state;
    }

    it("replays a late first input and an idle racer to every recorded check", () => {
      // The default wait (600): p1's first input is on tick 300, p2 never presses, p3 is a computer seat.
      const replay = recordSurvival({ firstInputAt: { p1: 300 }, idle: [P2] });
      expect(replay.checks.length).toBeGreaterThan(5);
      const state = play(replay);
      expect(stateHash(state)).toBe(replay.finalHash);
      expect(state.players[P2]!.edgeWaitTicks).toBe(600); // p2 waited out the whole cap
      expect(state.players[P1]!.edgeWaitTicks).toBe(300);
      expect(state.players[P3]!.edgeWaitTicks).toBeUndefined();
      // The same bytes a saved file would hold play back as well.
      expect(stateHash(play(decodeReplay(encodeReplay(replay))))).toBe(replay.finalHash);
    });

    it("steps a GO state recorded before the start wait existed by the old rule", () => {
      // The same race twice: once with the tunable missing from the GO state's tuning, once with it 0.
      // Every check matches in both, and they are the same race to the last hash.
      const before = recordSurvival({ idle: [P2], without: "SURVIVAL_START_WAIT_TICKS" });
      const off = recordSurvival({ idle: [P2], tuning: { SURVIVAL_START_WAIT_TICKS: 0 } });
      const [oldRule, zero] = [play(before), play(off)];
      expect(before.finalTick).toBe(off.finalTick);
      expect(before.finalHash).toBe(off.finalHash);
      expect(oldRule.players[P2]!.edgeWaitTicks).toBeUndefined();
      // With the wait on, the same idle racer's edge has not moved when the race ends, at the same
      // tick: she is not caught early, and nobody else's race changed. Her edge rose in the old one.
      const waiting = recordSurvival({ idle: [P2] });
      const held = play(waiting).players[P2]!;
      expect(waiting.finalTick).toBe(before.finalTick);
      expect(held.floorEdgeY).toBeLessThan(oldRule.players[P2]!.floorEdgeY);
      expect(oldRule.players[P2]!.floorEdgeY).toBe(zero.players[P2]!.floorEdgeY);
      expect(held.edgeWaitTicks).toBe(waiting.finalTick + 1); // still waiting on the race's last tick
    });
  });
});
