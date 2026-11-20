/**
 * The 50-floor seed survey for a new stage (select spec §4.5).
 *
 *   pnpm exec vite-node packages/content/bin/survey-seeds.ts -- --from 0 --count 200000 --top 12
 *
 * Deterministic and bounded. It scores each seed's first 50 floors on the
 * four-phrase arc Rooftops was chosen for, then climbs the best candidates with
 * the reference controller. It prints a table; the owner chooses.
 *
 * The phrases are Rooftops' own windows (teach 1-5, combine 6-11, recover
 * 12-15, finish 16-19). Floors 20-49 are what phase 4's longer courses add.
 * Criteria, from the slice review and the archived attempt's measurements:
 *   - teach: mean <= 0.25, and floors 1 and 2 each <= 0.30;
 *   - combine: mean >= 0.60, no step >= 0.98;
 *   - recover: mean <= 0.45;
 *   - finish: mean >= 0.55, and the last step (floor 19) >= 0.40, so the climax
 *     does not deflate (the reason 46302 and 50372 were rejected);
 *   - floors 20-49: mean within [0.45, 0.75];
 *   - over floors 1-49, at most 3 steps >= 0.98 (within one bounce only on a
 *     perfect line; the reason 6101 was rejected);
 *   - climbed: one lap with no reset, and three laps in 30-90 s.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type LapCount } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { stepDemands } from "@floor-fifty/shared/level/demand";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  const value = process.argv[index + 1];
  if (key !== undefined && value !== undefined) args.set(key, value);
}
const FROM = Number(args.get("from") ?? 0);
const COUNT = Math.min(Number(args.get("count") ?? 200_000), 2_000_000);
const TOP = Number(args.get("top") ?? 12);
const EXCLUDE = new Set((args.get("exclude") ?? "35229").split(",").map(Number));

const race = resolveTuning();
const fifty: ResolvedTuning = { ...race, COURSE_FLOOR_COUNT: 50 };
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const slice = (demands: readonly number[], fromFloor: number, toFloor: number) => demands.slice(fromFloor - 1, toFloor);

type Candidate = { seed: number; score: number; teach: number; combine: number; recover: number; finish: number; last: number; long: number; hard: number };

function score(seed: number): Candidate | undefined {
  const demands = stepDemands(createCourse(seed, fifty), fifty);
  const teach = slice(demands, 1, 5);
  const combine = slice(demands, 6, 11);
  const recover = slice(demands, 12, 15);
  const finish = slice(demands, 16, 19);
  const long = slice(demands, 20, 49);
  const hard = demands.filter((value) => value >= 0.98).length;
  const c: Candidate = {
    seed,
    teach: mean(teach),
    combine: mean(combine),
    recover: mean(recover),
    finish: mean(finish),
    last: demands[18]!,
    long: mean(long),
    hard,
    score: 0,
  };
  if (c.teach > 0.25 || demands[0]! > 0.3 || demands[1]! > 0.3) return undefined;
  if (c.combine < 0.6 || combine.some((value) => value >= 0.98)) return undefined;
  if (c.recover > 0.45) return undefined;
  if (c.finish < 0.55 || c.last < 0.4) return undefined;
  if (c.long < 0.45 || c.long > 0.75) return undefined;
  if (hard > 3) return undefined;
  c.score = c.combine + c.finish - c.teach - c.recover;
  return c;
}

const BOT = asPlayerId("p1");
function climb(seed: number, laps: LapCount): { finished: boolean; seconds: number; resets: number } {
  const base = createRaceState({ seed, lapCount: laps, tuning: race, players: [{ id: BOT, name: asPlayerName("Bot") }] });
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
  return { finished: state.phase === "finished", seconds: state.tick / TICK_HZ, resets };
}

const ranked: Candidate[] = [];
for (let seed = FROM; seed < FROM + COUNT; seed += 1) {
  if (EXCLUDE.has(seed)) continue;
  const candidate = score(seed);
  if (candidate !== undefined) ranked.push(candidate);
}
ranked.sort((a, b) => b.score - a.score || a.seed - b.seed);

const f = (value: number) => value.toFixed(2);
console.log(`scanned ${COUNT} seeds from ${FROM}; ${ranked.length} pass the arc`);
console.log("seed\tscore\tteach\tcombine\trecover\tfinish\tlast\t20-49\t>=0.98\tlap resets\t3-lap s");
let printed = 0;
for (const candidate of ranked) {
  if (printed >= TOP) break;
  const lap = climb(candidate.seed, 1);
  if (!lap.finished || lap.resets > 0) continue;
  const three = climb(candidate.seed, 3);
  if (!three.finished || three.seconds < 30 || three.seconds > 90) continue;
  printed += 1;
  console.log(
    [candidate.seed, f(candidate.score), f(candidate.teach), f(candidate.combine), f(candidate.recover), f(candidate.finish), f(candidate.last), f(candidate.long), candidate.hard, lap.resets, three.seconds.toFixed(1)].join("\t"),
  );
}
