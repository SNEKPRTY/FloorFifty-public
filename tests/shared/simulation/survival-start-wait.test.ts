/**
 * A Survival racer's edge waits for that racer's first input (first-race spec
 * §2): it stands still from GO until the racer presses something, or until
 * `SURVIVAL_START_WAIT_TICKS` pass, then rests the usual grace and rises on the
 * race clock. One racer's wait slows nobody else's edge.
 */
import { describe, expect, it } from "vitest";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { edgeRiseSpeed } from "@floor-fifty/shared/simulation/survival";
import { ENDLESS_TUNING } from "../support/race";

const P1 = asPlayerId("p1");
const P2 = asPlayerId("p2");

/**
 * An endless race in `racing` whose racers have not pressed anything: unlike
 * `endlessRaceState`, which starts them bouncing, this is a race at GO.
 */
function waitingEndless(count: number, tuning: ResolvedTuning = ENDLESS_TUNING(), cpuIds: readonly string[] = []): RaceState {
  const state = createRaceState({
    seed: 35229,
    lapCount: 1,
    tuning,
    players: Array.from({ length: count }, (_, i) => ({ id: asPlayerId(`p${i + 1}`), name: asPlayerName(`Racer ${i + 1}`) })),
  });
  for (const id of cpuIds) state.players[asPlayerId(id)]!.cpu = true;
  return { ...state, phase: "racing", raceStartedAtTick: 0 };
}

/**
 * Steps `start` to tick `until` (or the end of the race), feeding `press(tick)`
 * to p1 on each tick it returns an input for. Every other racer sends nothing.
 */
function run(start: RaceState, until: number, press: (tick: number) => Partial<HeldInput> | undefined = () => undefined): RaceState {
  let state = start;
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  while (state.phase === "racing" && state.tick < until) {
    const tick = state.tick + 1;
    const held = press(tick);
    const inputs = new Map<typeof P1, HeldInput>();
    if (held !== undefined) inputs.set(P1, { sequence: 1, left: false, right: false, fastFall: false, reset: false, ...held });
    state = simulation.step({ ...state, tick }, inputs).state;
  }
  simulation.dispose();
  return state;
}

/** p1 presses once, on `tick`; everyone else is idle. */
const runWithOnePressAt = (tick: number, until: number, held: Partial<HeldInput> = { fastFall: true }): RaceState =>
  run(waitingEndless(2), until, (now) => (now === tick ? held : undefined));

describe("the edge waits for a racer's first input (first-race spec §2)", () => {
  it("stands still while she has not pressed, and she is not out at the old 0:11", () => {
    const start = waitingEndless(2);
    // Still for the whole wait, then the push alone takes its one step (the rise has not begun).
    expect(run(start, 599).players[P1]!.floorEdgeY).toBe(start.players[P1]!.floorEdgeY);
    const state = run(start, 700); // 11.67 s: past the old out at tick 687
    expect(state.players[P1]!.outAtTick).toBeUndefined();
    expect(state.players[P1]!.floorEdgeY).toBeLessThan(start.players[P1]!.floorEdgeY + 5);
  });

  it("rests the grace from her first input, then rises on the race clock", () => {
    // p1's first input is one fastFall press on tick 300, then nothing. The push (survival.ts) runs
    // whatever the rise is and she may climb a floor on her bounce, so the rest is read as a
    // difference: the same race with the rise switched off. The two are identical through the
    // grace, and part at its end.
    const noRise = ENDLESS_TUNING({ SURVIVAL_RISE_START: 0, SURVIVAL_RISE_STEP: 0 });
    const edgeAt = (tick: number, tuning = ENDLESS_TUNING()) =>
      run(waitingEndless(2, tuning), tick, (now) => (now === 300 ? { fastFall: true } : undefined)).players[P1]!;
    expect(edgeAt(301).edgeWaitTicks).toBe(300);
    expect(edgeAt(479).floorEdgeY).toBe(edgeAt(479, noRise).floorEdgeY); // 300 + 180 grace: no rise yet
    expect(edgeAt(481).floorEdgeY).toBeGreaterThan(edgeAt(481, noRise).floorEdgeY);
    const tuning = ENDLESS_TUNING();
    const pack = [
      { id: "p1", bestFloor: 0 },
      { id: "p2", bestFloor: 0 },
    ];
    expect(edgeRiseSpeed(479, { id: "p1", edgeWaitTicks: 300 }, pack, tuning)).toBe(0);
    expect(edgeRiseSpeed(480, { id: "p1", edgeWaitTicks: 300 }, pack, tuning)).toBeGreaterThan(0);
  });

  it("counts a restart press as her first input, and does nothing else with it", () => {
    // What the start pulse relies on: reset ends the wait; Survival ignores it otherwise.
    const state = runWithOnePressAt(300, 301, { reset: true });
    expect(state.players[P1]!.awaitingInput).toBe(false);
    expect(state.players[P1]!.edgeWaitTicks).toBe(300);
    expect(state.players[P1]!.lap).toBe(1);
    expect(state.players[P1]!.visitedFloorIds).toEqual(waitingEndless(2).players[P1]!.visitedFloorIds);
  });

  it("stops waiting after 10 seconds, so an idle racer holds nobody up", () => {
    const state = run(waitingEndless(2), 60 * 35);
    expect(state.players[P1]!.edgeWaitTicks).toBe(600);
    expect(state.players[P1]!.outAtTick).toBeGreaterThan(780); // 600 + 180
    expect(state.players[P1]!.outAtTick).toBeLessThan(60 * 30);
    expect(state.phase).toBe("finished");
  });

  it("never shifts the ramp: a racer who waited rises as fast as one who did not", () => {
    const tuning = ENDLESS_TUNING();
    const pack = [
      { id: "p1", bestFloor: 3 },
      { id: "p2", bestFloor: 3 },
    ];
    expect(edgeRiseSpeed(2500, { id: "p1", edgeWaitTicks: 600 }, pack, tuning)).toBe(
      edgeRiseSpeed(2500, { id: "p2" }, pack, tuning),
    );
  });

  it("leaves a computer racer's edge as it was", () => {
    // p2 is a CPU that has not acted yet: its edge starts as it always has, on the grace alone.
    const start = waitingEndless(2, ENDLESS_TUNING(), ["p2"]);
    const state = run(start, 200);
    expect(state.players[P2]!.edgeWaitTicks).toBeUndefined();
    expect(state.players[P2]!.floorEdgeY).toBeGreaterThan(run(start, 179).players[P2]!.floorEdgeY);
  });

  it.each([
    ["0", ENDLESS_TUNING({ SURVIVAL_START_WAIT_TICKS: 0 })],
    [
      "absent, as in a GO state recorded before it existed",
      (() => {
        const { SURVIVAL_START_WAIT_TICKS: _dropped, ...before } = ENDLESS_TUNING();
        return before as ResolvedTuning;
      })(),
    ],
  ])("is the old rule when the tunable is %s", (_which, old) => {
    const start = waitingEndless(2, old);
    const state = run(start, 200);
    expect(state.players[P1]!.floorEdgeY).toBeGreaterThan(run(start, 179).players[P1]!.floorEdgeY); // rising from tick 180
    expect(state.players[P1]!.edgeWaitTicks).toBeUndefined();
  });
});
