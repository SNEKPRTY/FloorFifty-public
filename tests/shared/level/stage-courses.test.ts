import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type LapCount } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { createRng } from "@floor-fifty/shared/level/rng";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../content/generated/content.json"), "utf8")),
);
const BOT = asPlayerId("p1");

/**
 * The reference controller climbs a frozen course. Stepped directly rather
 * than through `support/race.ts`'s `advance`, which double-counts ticks and
 * so reports lap times twice as long as they are.
 */
function climb(
  seed: number,
  tuning: ResolvedTuning,
  laps: LapCount,
): { finished: boolean; seconds: number; resets: number; bestFloor: number } {
  const base = createRaceState({ seed, lapCount: laps, tuning, players: [{ id: BOT, name: asPlayerName("Bot") }] });
  let state: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };
  const controller = createClimbController(BOT);
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  let resets = 0;
  for (let tick = 0; tick < TICK_HZ * 180 && state.phase !== "finished"; tick += 1) {
    const input = controller.next(state, tick + 1);
    const result = simulation.step({ ...state, tick: state.tick + 1 }, input === undefined ? new Map() : new Map([[BOT, input]]));
    resets += result.events.filter((event) => event.type === "playerReset").length;
    state = result.state;
  }
  simulation.dispose();
  return { finished: state.phase === "finished", seconds: state.tick / TICK_HZ, resets, bestFloor: state.players[BOT]!.bestFloor };
}

describe("every catalogued stage's frozen course", () => {
  for (const stage of content.stages) {
    const seed = stage.course?.seed;
    const tuning = resolveTuning({ ...content.baseTuning, ...stage.courseTuning });

    it(`${stage.id} is authored by a frozen seed`, () => {
      expect(seed).toBeTypeOf("number");
    });

    it(`${stage.id} is climbed by the reference controller without a reset`, () => {
      const lap = climb(seed!, tuning, 1);
      expect(lap.finished).toBe(true);
      expect(lap.resets).toBe(0);
    });

    it(`${stage.id} takes the reference controller 30 to 90 s over three laps`, () => {
      const race = climb(seed!, tuning, 3);
      expect(race.finished).toBe(true);
      expect(race.seconds).toBeGreaterThanOrEqual(30);
      expect(race.seconds).toBeLessThanOrEqual(90);
    });
  }
});

describe("each stage's 50-floor course (race-options spec §4)", () => {
  const fifty = content.modes.find((mode) => mode.id === "floors-50")!;

  for (const stage of content.stages) {
    // Measured 2026-10-01: 35.4 to 40.2 s, no resets.
    it(`${stage.id} is finished by the reference controller without a reset, inside 60 s`, () => {
      const tuning = resolveTuning({ ...content.baseTuning, ...stage.courseTuning, ...fifty.tuning });
      const race = climb(stage.course!.seed, tuning, 1);
      expect(race.finished).toBe(true);
      expect(race.resets).toBe(0);
      expect(race.seconds).toBeLessThan(60);
    });

    it(`${stage.id} describes floors 20–49 in its extension`, () => {
      const covered = (stage.course!.extension ?? []).flatMap((entry) =>
        Array.from({ length: entry.toFloor - entry.fromFloor + 1 }, (_, i) => entry.fromFloor + i),
      );
      expect(covered).toEqual(Array.from({ length: 30 }, (_, i) => 20 + i));
    });
  }
});

/**
 * A room races a random seed unless a player picks Classic (stage seeds spec
 * §5). Nobody reviews that climb, so the generator's bounds carry the whole
 * guarantee: the reference controller must finish every one, on every stage
 * and every finite mode.
 */
describe("random seeds on every stage (stage seeds spec §5)", () => {
  const rng = createRng(20261004);
  const seeds = Array.from({ length: 24 }, () => rng.nextInt(0, 999_999));
  const finite = content.modes.filter((mode) => mode.course !== "endless");

  for (const stage of content.stages) {
    for (const mode of finite) {
      it(`${stage.id} on ${mode.id}: the reference controller finishes every seed`, { timeout: 120_000 }, () => {
        const tuning = resolveTuning({ ...content.baseTuning, ...stage.courseTuning, ...mode.tuning });
        const failed = seeds.filter((seed) => !climb(seed, tuning, 1).finished);
        expect(failed, `unclimbable seeds: ${failed.join(", ")}`).toEqual([]);
      });
    }
  }
});

describe("each stage in Infinite (race-options spec §10.1)", () => {
  const infinite = content.modes.find((mode) => mode.id === "infinite")!;

  for (const stage of content.stages) {
    it(`${stage.id}: the reference controller passes floor 50 within 3:00`, { timeout: 120_000 }, () => {
      const tuning = resolveTuning({ ...content.baseTuning, ...stage.courseTuning, ...infinite.tuning });
      const race = climb(stage.course!.seed, tuning, 1);
      expect(race.finished).toBe(true);
      expect(race.bestFloor).toBeGreaterThanOrEqual(50);
    });
  }
});
