// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { growCourse } from "@floor-fifty/shared/simulation/endless";
import { endlessRaceState, placeAtFloor } from "../../../shared/support/race";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { stateToSnapshot } from "../../support/snapshots";

/** Projects a bare state; these tests never ask which artifact it came from. */
const toRoomSnapshot = (state: RaceState, events: readonly RaceEvent[]) =>
  stateToSnapshot(state, events);
import { snapshotToRaceState } from "../../../../apps/client/src/features/net/snapshot-to-race";

const tuning = resolveTuning();
const LOCAL = asPlayerId("p1");
const REMOTE = asPlayerId("p2");

const held = (o: Partial<HeldInput> = {}): HeldInput => ({
  sequence: 1,
  left: false,
  right: false,
  fastFall: false,
  reset: false,
  ...o,
});

describe("Survival in prediction (survival spec §3, §5)", () => {
  it("carries the local racer's edge, an out and the clock", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), LOCAL, 12));
    state.players[LOCAL]!.floorEdgeY = 321;
    state.players[LOCAL]!.outAtTick = 400;
    state.players[LOCAL]!.finishedAtTick = 400;
    state.clockSeconds = 60;
    const rebuilt = snapshotToRaceState(toRoomSnapshot(state, []), LOCAL, state.tuning)!;
    expect(rebuilt.players[LOCAL]!.floorEdgeY).toBe(321);
    expect(rebuilt.players[LOCAL]!.outAtTick).toBe(400);
    expect(rebuilt.clockSeconds).toBe(60);
    expect(rebuilt.freedBelow).toBe(0);
  });
});

describe("the edge's wait in prediction (first-race spec §2)", () => {
  it("carries the wait into prediction, and reads a row without one as no wait", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), LOCAL, 12));
    state.players[LOCAL]!.edgeWaitTicks = 300;
    const rebuilt = snapshotToRaceState(toRoomSnapshot(state, []), LOCAL, state.tuning)!;
    expect(rebuilt.players[LOCAL]!.edgeWaitTicks).toBe(300);
    // A racer whose edge never waited: the row has no field, and prediction's racer has none either.
    delete state.players[LOCAL]!.edgeWaitTicks;
    const none = snapshotToRaceState(toRoomSnapshot(state, []), LOCAL, state.tuning)!;
    expect(none.players[LOCAL]!.edgeWaitTicks).toBeUndefined();
  });
});

/** A two-player race advanced far enough that nobody is still on the spawn seat. */
function midRace(): RaceState {
  const base = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [
      { id: LOCAL, name: asPlayerName("Kite") },
      { id: REMOTE, name: asPlayerName("Vex") },
    ],
  });
  const start: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };
  let state = start;
  const simulation = createRaceSimulation(start);
  simulation.restore(start);
  for (let tick = 0; tick < 90; tick += 1) {
    state = simulation.step(
      { ...state, tick: state.tick + 1 },
      new Map([
        [LOCAL, held({ right: true })],
        [REMOTE, held({ left: true })],
      ]),
    ).state;
  }
  simulation.dispose();
  return state;
}

describe("rebuilding a race from a snapshot", () => {
  it("steps identically to authority for a full second", () => {
    const authority = midRace();
    const rebuilt = snapshotToRaceState(toRoomSnapshot(authority, []), LOCAL, tuning)!;

    let server = authority;
    let client = rebuilt;
    // Each side gets one world of its own, which is what both really have: the
    // server steps a long-lived simulation, and the client's rebuild is stepped
    // rather than rebuilt per tick.
    const serverSim = createRaceSimulation(authority);
    serverSim.restore(authority);
    const clientSim = createRaceSimulation(rebuilt);
    clientSim.restore(rebuilt);

    for (let tick = 0; tick < TICK_HZ; tick += 1) {
      const input = held({ sequence: 2, right: true });
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[LOCAL, input]])).state;
      client = clientSim.step({ ...client, tick: client.tick + 1 }, new Map([[LOCAL, input]])).state;

      expect(client.players[LOCAL]).toEqual(server.players[LOCAL]);
    }
  });

  it("reproduces the local player's state exactly, with nothing excused", () => {
    const authority = midRace();
    const rebuilt = snapshotToRaceState(toRoomSnapshot(authority, []), LOCAL, tuning)!;

    expect(rebuilt.players[LOCAL]).toEqual(authority.players[LOCAL]);
  });

  it("reproduces moving floor phase, not only position", () => {
    const authority = midRace();
    const rebuilt = snapshotToRaceState(toRoomSnapshot(authority, []), LOCAL, tuning)!;

    expect(rebuilt.movingFloors).toEqual(authority.movingFloors);
  });

  it("omits remote players, which no simulation rule reads", () => {
    const authority = midRace();
    const rebuilt = snapshotToRaceState(toRoomSnapshot(authority, []), LOCAL, tuning)!;

    expect(Object.keys(rebuilt.players)).toEqual([LOCAL]);
  });

  it("returns nothing when the local player is absent from the snapshot", () => {
    const authority = midRace();
    const snapshot = toRoomSnapshot(authority, []);
    const stranger = asPlayerId("nobody");

    expect(snapshotToRaceState(snapshot, stranger, tuning)).toBeUndefined();
  });

  it("reuses one course per seed rather than regenerating it per snapshot", () => {
    const authority = midRace();
    const snapshot = toRoomSnapshot(authority, []);
    const a = snapshotToRaceState(snapshot, LOCAL, tuning)!;
    const b = snapshotToRaceState(snapshot, LOCAL, tuning)!;

    expect(a.course).toBe(b.course);
  });

  it("rebuilds the course when the seed changes, as Race Again makes it", () => {
    const authority = midRace();
    const first = snapshotToRaceState(toRoomSnapshot(authority, []), LOCAL, tuning)!;
    const reseeded = snapshotToRaceState(
      { ...toRoomSnapshot(authority, []), seed: 99_991 },
      LOCAL,
      tuning,
    )!;

    expect(reseeded.course).not.toBe(first.course);
    expect(reseeded.course.seed).toBe(99_991);
  });

  it("rebuilds an endless course at the snapshot's height (race-options spec §5.4)", () => {
    const grown = cloneRaceState(placeAtFloor(endlessRaceState(1), LOCAL, 49));
    grown.players[LOCAL]!.bestFloor = 49;
    grown.players[LOCAL]!.bestFloorAtTick = 2_000;
    growCourse(grown);
    expect(grown.course.floorCount).toBeGreaterThan(50);
    const rebuilt = snapshotToRaceState(toRoomSnapshot(grown, []), LOCAL, grown.tuning)!;
    expect(rebuilt.course.floorCount).toBe(grown.course.floorCount);
    expect(rebuilt.course.floors).toEqual(grown.course.floors);
    expect(rebuilt.modeId).toBe(grown.modeId);
    expect([rebuilt.players[LOCAL]!.bestFloor, rebuilt.players[LOCAL]!.bestFloorAtTick]).toEqual([49, 2_000]);
  });

  it("counts an endless course's floors below the window as collected, and the window's from the snapshot", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), LOCAL, 30));
    state.players[LOCAL]!.visitedFloorIds = ["floor-0", "floor-24", "floor-25"];
    const rebuilt = snapshotToRaceState(toRoomSnapshot(state, []), LOCAL, state.tuning)!;
    const below = Array.from({ length: 24 }, (_, i) => `floor-${i}`);
    expect(rebuilt.players[LOCAL]!.visitedFloorIds).toEqual([...below, "floor-24", "floor-25"]);
  });
});
