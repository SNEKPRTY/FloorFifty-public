import { beforeAll, describe, expect, it } from "vitest";
import { TICK_HZ, TICK_MS, VIEWPORT } from "@floor-fifty/shared/common/constants";
import { shortestWrappedOffset } from "@floor-fifty/shared/common/math";
import { asPlayerId, asPlayerName, raceEventId } from "@floor-fifty/shared/common/ids";
import type {
  HeldInput,
  PlayerSnapshot,
  RaceEvent,
  RoomSnapshot,
} from "@floor-fifty/shared/common/protocol";
import {
  createRaceState,
  floorX,
  type PlayerState,
  type RaceState,
} from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { stateToSnapshot } from "../../support/snapshots";

/** Projects a bare state; these tests never ask which artifact it came from. */
const toRoomSnapshot = (state: RaceState, events: readonly RaceEvent[]) =>
  stateToSnapshot(state, events);
import { LocalSimulation } from "../../../../apps/client/src/features/net/local-simulation";
import { RenderClock } from "../../../../apps/client/src/features/net/render-clock";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { fakeContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { LOCAL_ID, snapshotAt } from "../../support/snapshots";

const tuning = resolveTuning();

/**
 * The server's own simulation over a state.
 *
 * A world is built once and stepped, which is what a room does and what keeps
 * a ten-tick loop from rebuilding one per tick.
 */
function serverSimulation(state: RaceState): RaceSimulation {
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  return simulation;
}
const P = asPlayerId("p1");

const held = (o: Partial<HeldInput> = {}): HeldInput => ({
  sequence: 1,
  left: false,
  right: false,
  fastFall: false,
  reset: false,
  ...o,
});

describe("the lap hold, predicted", () => {
  it("adopts a lap hold across a reconciliation and releases on the room's tick", () => {
    const start = racing();
    const state = { ...start, players: { [P]: { ...start.players[P]!, holdUntilTick: start.tick + 20, vx: 0, vy: 0 } } };
    const input = held({ sequence: 2, right: true });
    let server: RaceState = state;
    const serverSim = serverSimulation(server);
    for (let tick = 0; tick < 30; tick += 1) {
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, input]])).state;
    }

    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));
    for (let tick = 0; tick < 30; tick += 1) sim.advance(input);
    expect(sim.state()!.x).toBeCloseTo(server.players[P]!.x, 6);
    expect(sim.state()!.y).toBeCloseTo(server.players[P]!.y, 6);
    expect(server.players[P]!.holdUntilTick).toBeUndefined();
  });
});

function racing(overrides: Partial<PlayerState> = {}): RaceState {
  const base = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [{ id: P, name: asPlayerName("Kite") }],
  });
  return {
    ...base,
    phase: "racing",
    raceStartedAtTick: 0,
    players: { [P]: { ...base.players[P]!, ...overrides } },
  };
}

/**
 * A `LocalSimulation` with the room's clock attached, as the screen attaches
 * `RenderClock` to it.
 *
 * The prediction is told which tick to predict up to rather than counting
 * rendered frames, so a test has to say what time it is. Here that is a plain
 * count of room ticks which every snapshot pulls forward: a client may lead
 * authority -- that is what predicting *is* -- but it never falls behind a
 * snapshot it has already been handed.
 *
 * The test that cares about the clock itself drives a real `RenderClock`
 * instead; everything below is about replay, pruning and correction, and wants
 * to name its ticks.
 */
function driven(): {
  reconcile: (snapshot: RoomSnapshot) => void;
  advance: (input: HeldInput, ticks?: number) => void;
  state: () => ReturnType<LocalSimulation["state"]>;
  clear: () => void;
} {
  const sim = new LocalSimulation(tuning);
  let tick = 0;
  return {
    reconcile(snapshot) {
      tick = Math.max(tick, snapshot.tick);
      sim.reconcile(snapshot, P, tick);
    },
    advance(input, ticks = 1) {
      for (let step = 0; step < ticks; step += 1) {
        tick += 1;
        sim.advance(input, TICK_MS, tick);
      }
    },
    state: () => sim.state(),
    clear: () => sim.clear(),
  };
}

/** An authority snapshot at tick 10 holding the local player. */
function racingSnapshot(
  overrides: Partial<RoomSnapshot> & { player?: Partial<PlayerSnapshot> } = {},
): RoomSnapshot {
  return snapshotAt(10, overrides);
}

describe("LocalSimulation", () => {
  it("draws nothing before its first snapshot", () => {
    expect(new LocalSimulation(tuning).state()).toBeUndefined();
  });

  it("adopts authority exactly on the first snapshot", () => {
    const state = racing();
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));

    const drawn = sim.state()!;
    expect(drawn.x).toBeCloseTo(state.players[P]!.x, 6);
    expect(drawn.y).toBeCloseTo(state.players[P]!.y, 6);
  });

  it("predicts a tick of held input ahead of the snapshot it has", () => {
    const state = racing();
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));

    sim.advance(held({ sequence: 2, right: true }));

    const simulation = serverSimulation(state);
    const server = simulation.step(
      { ...state, tick: state.tick + 1 },
      new Map([[P, held({ sequence: 2, right: true })]]),
    ).state;
    simulation.dispose();

    expect(sim.state()!.x).toBeCloseTo(server.players[P]!.x, 6);
  });

  it("replays unacknowledged input to land exactly where the server will", () => {
    const state = racing();
    const input = held({ sequence: 2, right: true });

    // The server's own future, ten ticks on.
    let server: RaceState = state;
    const serverSim = serverSimulation(server);
    for (let tick = 0; tick < 10; tick += 1) {
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, input]])).state;
    }
    // ...and the snapshot it broadcast halfway through.
    let midway: RaceState = state;
    const midwaySim = serverSimulation(state);
    for (let tick = 0; tick < 5; tick += 1) {
      midway = midwaySim.step({ ...midway, tick: midway.tick + 1 }, new Map([[P, input]])).state;
    }

    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));
    for (let tick = 0; tick < 10; tick += 1) sim.advance(input);

    sim.reconcile(toRoomSnapshot(midway, []));

    expect(sim.state()!.x).toBeCloseTo(server.players[P]!.x, 6);
    expect(sim.state()!.y).toBeCloseTo(server.players[P]!.y, 6);
  });

  it("keeps replaying an acknowledged frame, because the server still is", () => {
    // The room keeps a frame in force until a newer one takes over
    // (`InputQueue.take`). Reading an ack as "finished with this frame" would
    // replay those ticks blank, which measures as twenty-three units of drift
    // over ten ticks.
    const state = racing();
    const input = held({ sequence: 2, right: true });

    let server: RaceState = state;
    const serverSim = serverSimulation(server);
    for (let tick = 0; tick < 6; tick += 1) {
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, input]])).state;
    }

    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));
    for (let tick = 0; tick < 6; tick += 1) sim.advance(input);

    // A snapshot from tick 3, acknowledging sequence 2 outright.
    let acked: RaceState = state;
    const ackedSim = serverSimulation(state);
    for (let tick = 0; tick < 3; tick += 1) {
      acked = ackedSim.step({ ...acked, tick: acked.tick + 1 }, new Map([[P, input]])).state;
    }
    expect(acked.players[P]!.lastSequence, "the server must have consumed it").toBe(2);
    sim.reconcile(toRoomSnapshot(acked, []));

    expect(sim.state()!.x).toBeCloseTo(server.players[P]!.x, 6);
  });

  it("does not drift while a wall refuses the input it is given", () => {
    // The whole point. Pinned against a floor's side holding into it, the
    // server pushes back every tick and the old predictor kept marching.
    const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
    const base = racing();
    const floor = base.course.floors[1]!;
    let server: RaceState = {
      ...base,
      players: {
        [P]: {
          ...base.players[P]!,
          x: floorX(base, floor) - reachX - 1,
          y: floor.y - 20,
          vy: tuning.BOUNCE_VELOCITY,
        },
      },
    };
    const serverSim = serverSimulation(server);

    const sim = driven();
    sim.reconcile(toRoomSnapshot(server, []));

    const input = held({ sequence: 2, right: true });
    const snapshotEvery = 3; // 20Hz against a 60Hz tick

    for (let tick = 1; tick <= 45; tick += 1) {
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, input]])).state;
      sim.advance(input);
      if (tick % snapshotEvery === 0) sim.reconcile(toRoomSnapshot(server, []));

      expect(
        Math.abs(sim.state()!.x - server.players[P]!.x),
        `drawn x drifted from authority at tick ${tick}`,
      ).toBeLessThan(2);
    }
  });

  it("adopts a respawn outright rather than sliding across the course", () => {
    const state = racing();
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));
    sim.advance(held({ sequence: 2, right: true }));

    const respawned: RaceState = {
      ...state,
      tick: state.tick + 1,
      players: { [P]: { ...state.players[P]!, x: state.players[P]!.x + 400 } },
    };
    sim.reconcile(toRoomSnapshot(respawned, []));

    expect(sim.state()!.x).toBeCloseTo(respawned.players[P]!.x, 6);
  });

  it("eases a small correction instead of snapping it", () => {
    const state = racing();
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));

    const nudged: RaceState = {
      ...state,
      tick: state.tick + 1,
      players: { [P]: { ...state.players[P]!, x: state.players[P]!.x + 10 } },
    };
    sim.reconcile(toRoomSnapshot(nudged, []));

    // Short of authority on the frame it arrives: the error is carried, not taken.
    expect(Math.abs(sim.state()!.x - nudged.players[P]!.x)).toBeGreaterThan(5);

    // And gone within half a second, with both sides advancing together.
    const idle = held({ sequence: 2 });
    let server: RaceState = nudged;
    const serverSim = serverSimulation(server);
    for (let frame = 0; frame < 30; frame += 1) {
      sim.advance(idle);
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, idle]])).state;
    }

    expect(Math.abs(sim.state()!.x - server.players[P]!.x)).toBeLessThan(1);
  });

  it("never carries a drawing correction as far as the snap distance", () => {
    // The offset softens how fast the sprite reaches the replayed truth; it is
    // never a lead being maintained. What keeps that true is that `reconcile`
    // adopts outright at `SNAP_DISTANCE` and the offset only shrinks between
    // snapshots -- so the sprite is never drawn a snap distance from the
    // simulation it is correcting toward.
    //
    // Successive corrections are the case worth pinning, because each one is
    // measured from the *drawn* position and so carries the previous one
    // forward. Authority jerks sideways by just under the threshold every
    // snapshot, always the same way, which is the shape that would accumulate.
    const SNAP_DISTANCE = 120; // `local-simulation.ts`, module-private.
    const idle = held({ sequence: 2 });

    let server = racing();
    const serverSim = serverSimulation(server);
    const sim = driven();
    sim.reconcile(toRoomSnapshot(server, []));

    let worst = 0;
    const gap = () =>
      Math.abs(shortestWrappedOffset(server.players[P]!.x, sim.state()!.x, VIEWPORT.width));

    for (let round = 0; round < 40; round += 1) {
      // Three ticks between snapshots, as the broadcast rate gives.
      for (let tick = 0; tick < 3; tick += 1) {
        server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, idle]])).state;
        sim.advance(idle);
        worst = Math.max(worst, gap());
      }

      server = {
        ...server,
        players: { [P]: { ...server.players[P]!, x: server.players[P]!.x + SNAP_DISTANCE - 1 } },
      };
      // A teleport this far can land inside a floor, and how a solver resolves
      // a deep overlap depends on its warm-start history. Rebuilding the
      // server's world here gives it the same fresh start the client's
      // reconcile has, so the gap measured is the drawing correction alone.
      serverSim.restore(server);
      sim.reconcile(toRoomSnapshot(server, []));
      worst = Math.max(worst, gap());
    }

    expect(worst, "a correction was carried past the snap distance").toBeLessThan(SNAP_DISTANCE);
  });

  it("ignores a snapshot older than the one it has", () => {
    const state = racing();
    const sim = driven();
    const fresh: RaceState = { ...state, tick: 50 };
    sim.reconcile(toRoomSnapshot(fresh, []));
    const drawn = sim.state()!.x;

    const stale: RaceState = {
      ...state,
      tick: 20,
      players: { [P]: { ...state.players[P]!, x: state.players[P]!.x + 300 } },
    };
    sim.reconcile(toRoomSnapshot(stale, []));

    expect(sim.state()!.x).toBeCloseTo(drawn, 6);
  });

  it("refuses to predict when the room's tuning is not the one it resolved", () => {
    const state = racing();
    const snapshot: RoomSnapshot = {
      ...toRoomSnapshot(state, []),
      tuning: { ...tuning, GRAVITY: tuning.GRAVITY * 2 },
    };
    const sim = driven();
    sim.reconcile(snapshot);

    // Nothing predicted, so the screen draws this player from the same
    // interpolated sample it draws everybody else from.
    expect(sim.state()).toBeUndefined();

    sim.advance(held({ sequence: 2, right: true }));
    expect(sim.state()).toBeUndefined();
  });

  it("stops leading when no snapshot has arrived for two seconds", () => {
    const state = racing();
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));

    // Held input, not drummed: the bound is how far ahead of authority the
    // prediction has run, not how many frames happen to be buffered.
    for (let tick = 0; tick < TICK_HZ * 3; tick += 1) {
      sim.advance(held({ sequence: 2, right: true }));
    }

    expect(sim.state()).toBeUndefined();
  });

  it("predicts nothing at all outside a running race", () => {
    const state: RaceState = { ...racing(), phase: "countdown" };
    const sim = driven();
    sim.reconcile(toRoomSnapshot(state, []));
    sim.advance(held({ sequence: 2, right: true }));

    expect(sim.state()).toBeUndefined();
  });

  it("hands the screen nothing once the player has finished, so one clock draws the room", () => {
    // Crossing the line stops the lead while the race, and this screen, carry
    // on for everybody else. Returning the newest snapshot here would draw the
    // finisher on a different clock from the racers beside them: their own
    // sprite stepping at the snapshot rate while everyone else interpolates
    // smoothly, and the camera following the jumpy one.
    const finished: RaceState = {
      ...racing(),
      players: { [P]: { ...racing().players[P]!, finishedAtTick: 30 } },
    };

    const sim = driven();
    sim.reconcile(toRoomSnapshot(finished, []));

    expect(sim.state()).toBeUndefined();
  });

  it("forgets the player on clear", () => {
    const sim = driven();
    sim.reconcile(toRoomSnapshot(racing(), []));
    sim.clear();
    expect(sim.state()).toBeUndefined();
  });

  it("draws the local player where authority has them, on a room clock that is not exactly 60 Hz", () => {
    // The defect this pins is a whole-race divergence, so it is measured over
    // a whole race rather than over a handful of ticks.
    //
    // The room's clock is a `setInterval`, measured at 58.9 Hz; the display is
    // 60. A prediction that steps on an accumulator of its own has no way to
    // learn that, so its tick runs away from authority's for as long as the
    // race lasts and then sits wherever its bound is -- half a second, which
    // is a hundred and seventy-eight units of running and, because a racer is
    // permanently bouncing, two entire bounces of vertical. The sprite is then
    // drawn over floors the player is nowhere near, which is the complaint
    // this whole initiative exists to answer.
    //
    // `RenderClock` already measures authority's real rate, because the world
    // is drawn on it. The prediction reads the same clock, so there is one
    // answer to what time it is rather than two that drift apart.
    const SERVER_HZ = 58.9;
    const LATENCY_MS = 25;
    const FRAME_MS = 1000 / 60;
    const SECONDS = 40;

    let server = racing();
    const serverSim = serverSimulation(server);
    const clock = new RenderClock();
    const sim = new LocalSimulation(tuning);
    const input = held({ sequence: 2, right: true });

    let owed = 0;
    let now = 0;
    const inFlight: { at: number; snapshot: RoomSnapshot }[] = [];
    let worstX = 0;
    let worstY = 0;
    let worstJump = 0;
    let previous: number | undefined;

    for (let frame = 1; frame <= 60 * SECONDS; frame += 1) {
      now += FRAME_MS;

      owed += (SERVER_HZ * FRAME_MS) / 1000;
      while (owed >= 1) {
        owed -= 1;
        server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, input]])).state;
        // Authority broadcasts on every third tick, as `SNAPSHOT_INTERVAL_TICKS`.
        if (server.tick % 3 === 0) {
          inFlight.push({ at: now + LATENCY_MS, snapshot: toRoomSnapshot(server, []) });
        }
      }

      while (inFlight.length > 0 && inFlight[0]!.at <= now) {
        const snapshot = inFlight.shift()!.snapshot;
        clock.observe(snapshot.tick);
        sim.reconcile(snapshot, P, clock.authorityTick());
      }

      clock.advance(FRAME_MS);
      sim.advance(input, FRAME_MS, clock.authorityTick());

      const drawn = sim.state();
      if (drawn === undefined) continue;
      const truth = server.players[P]!;
      // The course wraps, so a difference is measured the short way round.
      worstX = Math.max(worstX, Math.abs(shortestWrappedOffset(truth.x, drawn.x, VIEWPORT.width)));
      worstY = Math.max(worstY, Math.abs(drawn.y - truth.y));
      if (previous !== undefined) {
        worstJump = Math.max(
          worstJump,
          Math.abs(shortestWrappedOffset(previous, drawn.x, VIEWPORT.width)),
        );
      }
      previous = drawn.x;
    }

    // Authority is always a little behind what is drawn, and legitimately so:
    // the newest snapshot spent a one-way transit getting here and the next is
    // still in flight. One snapshot interval of travel is the whole of that
    // honest gap, on either axis. What the accumulator produced was ten times
    // it.
    const interval = 3 / TICK_HZ;
    expect(worstX, "the drawn sprite ran away from authority").toBeLessThan(
      tuning.MAX_MOVE_SPEED * interval,
    );
    expect(worstY, "the drawn sprite climbed away from authority").toBeLessThan(
      tuning.BOUNCE_VELOCITY * interval,
    );

    // And it got there by moving rather than by teleporting. A lead that runs
    // away is abandoned all at once when it trips the silent-server guard,
    // which puts the whole of it on the screen in a single frame. An honest
    // frame is a tick of running plus one step of a correction easing out: a
    // correction is adopted outright at the snap distance, so the largest ever
    // carried is just under 120 units, bleeding at six per second.
    const honestStep = tuning.MAX_MOVE_SPEED / TICK_HZ + 12;
    expect(worstJump, "the drawn sprite jumped rather than moved").toBeLessThan(honestStep);
  });

  it("replays the frame the server is holding, even on ticks it recorded later", () => {
    // `prune` keeps the most recently acknowledged frame because the server is
    // still applying it. The tick bound then has to honour that: a replay tick
    // earlier than the frame's own recorded tick must still get the frame, or
    // it steps with no input at all, `applyInputs` reads that as NEUTRAL, and
    // the player is stopped dead for a tick the server spent moving them.
    //
    // The ack outruns the recorded tick whenever the client's clock leads the
    // server's, which is the ordinary state of a client that predicts.
    const idle = held({ sequence: 1 });
    const right = held({ sequence: 2, right: true });

    // High above the top floor, so nothing here resolves against geometry and
    // the measurement is of the replay alone.
    const start: RaceState = {
      ...racing(),
      players: { [P]: { ...racing().players[P]!, x: 0, y: 5000, vy: 0 } },
    };

    const sim = driven();
    sim.reconcile(toRoomSnapshot(start, []));
    for (let i = 0; i < 3; i += 1) sim.advance(idle);
    for (let i = 0; i < 3; i += 1) sim.advance(right);

    // The server received sequence 2 earlier in its own frame of reference and
    // has been applying it since its first tick.
    let server: RaceState = start;
    const serverSim = serverSimulation(server);
    for (let i = 0; i < 2; i += 1) {
      server = serverSim.step({ ...server, tick: server.tick + 1 }, new Map([[P, right]])).state;
    }
    expect(server.players[P]!.lastSequence, "the server must have consumed it").toBe(2);

    sim.reconcile(toRoomSnapshot(server, []));

    // Where the server actually reaches by the client's tick, still holding it.
    let truth: RaceState = server;
    const truthSim = serverSimulation(truth);
    for (let i = 0; i < 4; i += 1) {
      truth = truthSim.step({ ...truth, tick: truth.tick + 1 }, new Map([[P, right]])).state;
    }

    // Let the drawing correction bleed out with no further authority, so what
    // is compared is the replayed simulation rather than the easing. Neutral
    // input moves neither side horizontally, so any gap that remains is real.
    const neutral = held({ sequence: 3 });
    for (let i = 0; i < 100; i += 1) {
      sim.advance(neutral);
      truth = truthSim.step({ ...truth, tick: truth.tick + 1 }, new Map([[P, neutral]])).state;
    }

    expect(Math.abs(sim.state()!.x - truth.players[P]!.x)).toBeLessThan(0.5);
  });
});

describe("drawing between ticks", () => {
  /** A prediction adopted at `state` and stepped `ticks` more with `input` held. */
  function leading(state: RaceState, input: HeldInput, ticks: number): LocalSimulation {
    const sim = new LocalSimulation(tuning);
    sim.reconcile(toRoomSnapshot(state, []), P, state.tick);
    for (let tick = 1; tick <= ticks; tick += 1) sim.advance(input, TICK_MS, state.tick + tick);
    return sim;
  }

  it("draws a moment between its two newest ticks where the racer was at that moment", () => {
    const state = racing();
    const input = held({ sequence: 2, right: true });
    const sim = leading(state, input, 2);
    const newest = state.tick + 2;

    const older = sim.state(newest - 1)!;
    const newer = sim.state(newest)!;
    const between = sim.state(newest - 0.25)!;

    // The older end is the tick before, exactly as the server steps it.
    const truth = serverSimulation(state);
    const first = truth.step({ ...state, tick: state.tick + 1 }, new Map([[P, input]])).state;
    truth.dispose();
    expect(older.x).toBeCloseTo(first.players[P]!.x, 6);
    expect(Math.abs(newer.x - older.x)).toBeGreaterThan(1);
    expect(between.x).toBeCloseTo(older.x + (newer.x - older.x) * 0.75, 6);
    expect(between.y).toBeCloseTo(older.y + (newer.y - older.y) * 0.75, 6);
  });

  it("blends across the seam the short way round", () => {
    // A tick and a half of running short of the right-hand edge, so the wrap
    // falls between the two ticks being blended.
    const half = VIEWPORT.width / 2;
    const state = racing({ x: half - 1.5 * (tuning.MAX_MOVE_SPEED / TICK_HZ) });
    const sim = leading(state, held({ sequence: 2, right: true }), 2);
    const newest = state.tick + 2;
    expect(sim.state(newest - 1)!.x).toBeGreaterThan(0);
    expect(sim.state(newest)!.x).toBeLessThan(0);

    // Halfway is at the seam, not dragged back across the middle of the course.
    expect(Math.abs(sim.state(newest - 0.5)!.x)).toBeGreaterThan(half - 2);
  });

  it("does not blend across a reset", () => {
    const state = racing();
    const away: RaceState = {
      ...state,
      players: { [P]: { ...state.players[P]!, x: state.players[P]!.x + 400 } },
    };
    const sim = new LocalSimulation(tuning);
    sim.reconcile(toRoomSnapshot(away, []), P, away.tick);
    sim.advance(held({ sequence: 2 }), TICK_MS, away.tick + 1);
    sim.advance(held({ sequence: 3, reset: true }), TICK_MS, away.tick + 2);
    const newest = away.tick + 2;

    const older = sim.state(newest - 1)!;
    const newer = sim.state(newest)!;
    expect(Math.hypot(newer.x - older.x, newer.y - older.y)).toBeGreaterThan(120);

    // A respawn is a teleport: no moment of it is halfway across the course.
    // Before the tick it happens on, it has not happened.
    const between = sim.state(newest - 0.5)!;
    expect(between.x).toBeCloseTo(older.x, 6);
    expect(between.y).toBeCloseTo(older.y, 6);
  });

  it("draws the moving floors at the same moment as the racer", () => {
    const state = racing();
    const sim = leading(state, held({ sequence: 2 }), 2);
    const newest = state.tick + 2;

    const older = sim.predictedFloors(newest - 1)!;
    const newer = sim.predictedFloors(newest)!;
    const between = sim.predictedFloors(newest - 0.5)!;
    const moving = [...newer.keys()].filter((id) => older.get(id) !== newer.get(id));
    expect(moving.length).toBeGreaterThan(0);
    for (const id of moving) {
      expect(between.get(id)).toBeCloseTo((older.get(id)! + newer.get(id)!) / 2, 6);
    }
  });

  it("keeps the sprite where it was drawn when a correction arrives", () => {
    // The correction is measured at the moment last drawn, not at the newest
    // tick. Authority here disagrees about how fast the racer was climbing, an
    // error that grows every tick, so the two ends of the blend are wrong by
    // different amounts and measuring at either end would move the sprite.
    const state = racing();
    const input = held({ sequence: 2, right: true });
    const sim = leading(state, input, 4);
    const moment = state.tick + 3.5;
    const before = sim.state(moment)!;

    let authority = state;
    const truth = serverSimulation(state);
    for (let tick = 0; tick < 2; tick += 1) {
      authority = truth.step({ ...authority, tick: authority.tick + 1 }, new Map([[P, input]])).state;
    }
    truth.dispose();
    const disagreeing: RaceState = {
      ...authority,
      players: { [P]: { ...authority.players[P]!, vy: authority.players[P]!.vy + 60 } },
    };
    sim.reconcile(toRoomSnapshot(disagreeing, []), P, state.tick + 4, moment);

    const after = sim.state(moment)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe("prediction runs the shared simulation", () => {
  it("builds a world holding only the local player", () => {
    const simulation = new LocalSimulation(tuning);
    simulation.reconcile(racingSnapshot(), LOCAL_ID, 10);
    expect(simulation.localPlayerCount).toBe(1);
    simulation.clear();
  });

  it("releases the world when the lead stands down", () => {
    const simulation = new LocalSimulation(tuning);
    simulation.reconcile(racingSnapshot(), LOCAL_ID, 10);
    simulation.reconcile({ ...racingSnapshot(), tick: 11, phase: "finished" }, LOCAL_ID, 11);
    expect(simulation.state()).toBeUndefined();
    simulation.clear();
  });

  it("restores from authority rather than continuing its own history", () => {
    const simulation = new LocalSimulation(tuning);
    simulation.reconcile(racingSnapshot(), LOCAL_ID, 10);
    const teleported = {
      ...racingSnapshot(),
      tick: 11,
      players: [{ ...racingSnapshot().players[0]!, y: 2_000 }],
    };
    simulation.reconcile(teleported, LOCAL_ID, 11);
    expect(simulation.state()!.y).toBeGreaterThan(1_500);
    simulation.clear();
  });

  it("rebuilding many times does not accumulate worlds", () => {
    const simulation = new LocalSimulation(tuning);
    for (let tick = 10; tick < 210; tick += 1) {
      simulation.reconcile({ ...racingSnapshot(), tick }, LOCAL_ID, tick);
    }
    expect(simulation.state()).toBeDefined();
    simulation.clear();
    expect(simulation.state()).toBeUndefined();
  });
});

describe("the gameplay screen's own frame", () => {
  // The gameplay screen's first import (its scene, views and HUD) runs to
  // seconds on a busy runner; paid here, under its own timeout, rather than
  // inside whichever test happens to run first.
  beforeAll(async () => {
    await import("../../../../apps/client/src/features/race/gameplay");
  }, 30_000);

  it("leads the local player from a held key between snapshots", async () => {
    const { screen } = await gameplayWithFakeNetwork({
      localPlayerId: LOCAL_ID,
      latestSnapshot: snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }),
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    for (let frame = 0; frame < 6; frame += 1) screen.draw(1000 / 60);

    expect(screen.predictedState()!.x).toBeGreaterThan(0);
    screen.exit();
  });

  it("starts the race from the newest snapshot, not the one it entered on", async () => {
    // Entering gameplay loads bundles and audio, which takes most of a second
    // in a browser, and the room keeps ticking through it. Seeded from the
    // snapshot that triggered the entry, the clock began that far in the past:
    // the first inputs of the race were stamped for ticks the room had already
    // stepped, arrived forty ticks late, and were corrected on screen.
    const { screen, network } = await gameplayWithFakeNetwork({
      localPlayerId: LOCAL_ID,
      latestSnapshot: snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }),
      whileLoading: (fake) => fake.emitSnapshot(snapshotAt(52, { player: { id: LOCAL_ID, x: 0, y: 0 } })),
    });

    screen.draw(1000 / 60);

    expect(screen.sample()!.tick).toBeGreaterThan(45);
    expect(network.sentInputs[0]!.tick).toBeGreaterThan(52);
    screen.exit();
  });

  it("keeps network time with the wall clock through frames slower than the ticker's cap", async () => {
    // Pixi caps a frame's delta at 100 ms. The first frames of a race are
    // slower than that, and a clock fed the capped delta fell a second behind
    // the room, snapped, and stamped the first inputs a hundred ticks late.
    const { screen, network } = await gameplayWithFakeNetwork({
      localPlayerId: LOCAL_ID,
      latestSnapshot: snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }),
    });

    // The first frame after the clock is set counts one tick at most; the
    // slow frame is one mid-race.
    screen.draw(1000 / 60);
    const before = network.sentInputs.at(-1)!.tick;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    screen.draw(100, 400);

    // Four hundred milliseconds is twenty-four ticks, not the six a capped
    // delta would claim.
    expect(network.sentInputs.at(-1)!.tick - before).toBeGreaterThanOrEqual(24);
    screen.exit();
  });

  it("has nothing predicted before authority arrives", async () => {
    const { screen } = await gameplayWithFakeNetwork();
    expect(screen.predictedState()).toBeUndefined();
    screen.exit();
  });

  it("still sends that key to the server rather than acting on it alone", async () => {
    const { screen, network } = await gameplayWithFakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }));

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    screen.draw(1000 / 60);

    expect(network.sentInputs.at(-1)).toMatchObject({ right: true });
    screen.exit();
  });

  it("carries the predicted racer's sideways speed, which the lean follows (Wonder spec §4.1)", async () => {
    const { screen, network } = await gameplayWithFakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(snapshotAt(10, { phase: "racing", player: { id: LOCAL_ID, x: 0, y: 0 } }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    for (let frame = 0; frame < 20; frame += 1) screen.draw(1000 / 60);
    expect(screen.predictedState()?.vx).toBeGreaterThan(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    screen.exit();
  });

  it("forgets the prediction when the screen is left", async () => {
    const { screen, network } = await gameplayWithFakeNetwork();
    network.localPlayerId = LOCAL_ID;
    network.emitSnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }));
    expect(screen.predictedState()).toBeDefined();

    screen.exit();

    expect(screen.predictedState()).toBeUndefined();
  });
});

/**
 * Where gameplay's numbers come from.
 *
 * The room resolves tuning once and broadcasts the object it stepped. The
 * client builds its view and its prediction from that object rather than from
 * a resolved default, because the failure a default causes is silent: wrong
 * gravity draws a confident sprite in the wrong place and reports nothing.
 */
describe("gameplay and the room's tuning", () => {
  it("constructs gameplay systems from snapshot tuning", async () => {
    const snapshot = snapshotAt(0, { tuning: resolveTuning({ GRAVITY: -300 }) });
    const { screen } = await gameplayWithFakeNetwork({ latestSnapshot: snapshot });

    // Reference identity, not equality: two equal tuning objects would hide
    // exactly the mistake this arrangement removes.
    expect(screen.gameplayTuning()).toBe(snapshot.tuning);
  });

  it("leaves for the menu rather than guessing when no snapshot explains the room", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: null });

    expect(gameplay.lastPublished()).toBe("room.recovery-required");
    expect(gameplay.errors.take()?.code).toBe("INVALID_ROOM");
    expect(gameplay.screen.gameplayTuning()).toBeUndefined();
  });

  it("never refreshes content from inside a race", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const gameplay = await gameplayWithFakeNetwork({
      content,
      latestSnapshot: snapshotAt(0, { phase: "racing" }),
    });

    gameplay.network.emitSnapshot(
      snapshotAt(1, { phase: "racing", contentRevision: asRevision("b".repeat(64)) }),
    );

    expect(content.refresh).not.toHaveBeenCalled();
  });
});

it("drains real side facts once across reconciliation and drops them on stand-down and clear", () => {
  const start = racing();
  const floor = start.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
  Object.assign(start.players[P]!, { x: floor.x - (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 + 1, y: floor.y, vy: 0 });
  const sim = new LocalSimulation(tuning);
  try {
    sim.reconcile(toRoomSnapshot(start, []), P, start.tick);
    sim.record({ ...held({ right: true }), tick: start.tick + 1 });
    sim.advanceTo(start.tick + 2);
    const contacts = sim.drainSideContacts();
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((contact) => contact.playerId === P && contact.floorId === floor.id)).toBe(true);
    expect(sim.drainSideContacts()).toEqual([]);
    sim.reconcile({ ...toRoomSnapshot(start, []), tick: start.tick + 1 }, P, start.tick + 2);
    expect(sim.drainSideContacts()).toEqual([]);
    sim.reconcile({ ...toRoomSnapshot(start, []), tick: start.tick + 3, phase: "finished" }, P, start.tick + 3);
    expect(sim.drainSideContacts()).toEqual([]);
    sim.reconcile({ ...toRoomSnapshot(start, []), tick: start.tick + 4 }, P, start.tick + 4);
    sim.record({ ...held({ sequence: 2, right: true }), tick: start.tick + 5 });
    sim.advanceTo(start.tick + 6);
    expect(sim.drainSideContacts().length).toBeGreaterThan(0);
    sim.reconcile({ ...toRoomSnapshot(start, []), round: 2 }, P, start.tick);
    sim.record({ ...held({ sequence: 3, right: true }), tick: start.tick + 1 });
    sim.advanceTo(start.tick + 2);
    expect(sim.drainSideContacts().length).toBeGreaterThan(0);
    sim.advanceTo(start.tick + 3);
    sim.reconcile({ ...toRoomSnapshot(start, []), round: 2, tick: start.tick + 4, players: [] }, P, start.tick + 4);
    expect(sim.drainSideContacts()).toEqual([]);
    sim.clear();
    expect(sim.drainSideContacts()).toEqual([]);
  } finally { sim.clear(); }
});

for (const transition of ["playerReset", "lapCompleted"] as const) {
  it(`drops undrawn wall contacts when authority reports ${transition}`, () => {
    const start = { ...racing(), lapCount: 3 as const };
    const floor = start.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
    Object.assign(start.players[P]!, { x: floor.x - (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 + 1, y: floor.y, vy: 0 });
    const sim = new LocalSimulation(tuning);
    try {
      sim.reconcile(toRoomSnapshot(start, []), P, start.tick);
      sim.record({ ...held({ right: true }), tick: start.tick + 1 });
      sim.advanceTo(start.tick + 2);
      // Real predictor collision; intentionally do not drain it before reset.
      const reset = racing({ lap: transition === "lapCompleted" ? 2 : 1 });
      reset.tick = start.tick + 3;
      reset.lapCount = 3;
      const base = { id: raceEventId(reset.tick, transition, P, ""), tick: reset.tick, playerId: P };
      const event: RaceEvent = transition === "playerReset"
        ? { ...base, type: "playerReset", reason: "manual" }
        : { ...base, type: "lapCompleted", lap: 1 };
      sim.reconcile(toRoomSnapshot(reset, [event]), P, reset.tick);
      expect(sim.drainSideContacts()).toEqual([]);
      // Repeated old transition must not discard fresh contact feedback.
      sim.reconcile(toRoomSnapshot({ ...start, tick: start.tick + 4 }, [event]), P, start.tick + 4);
      sim.record({ ...held({ sequence: 2, right: true }), tick: start.tick + 5 });
      sim.advanceTo(start.tick + 6);
      expect(sim.drainSideContacts().length).toBeGreaterThan(0);
    } finally { sim.clear(); }
  });
}

it("retains real pending contacts across another racer's reset and an already-seen reset", () => {
  for (const oldReset of [false, true]) {
    const start = racing();
    const floor = start.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
    Object.assign(start.players[P]!, { x: floor.x - (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 + 1, y: floor.y, vy: 0 });
    const sim = new LocalSimulation(tuning);
    const playerId = oldReset ? P : asPlayerId("other");
    const event: RaceEvent = { id: raceEventId(0, "playerReset", playerId, ""), tick: 0, playerId, type: "playerReset", reason: "manual" };
    try {
      sim.reconcile(toRoomSnapshot(start, oldReset ? [event] : []), P, start.tick);
      sim.record({ ...held({ right: true }), tick: start.tick + 1 });
      sim.advanceTo(start.tick + 2);
      sim.reconcile({ ...toRoomSnapshot(start, [{ ...event, tick: oldReset ? 0 : 3 }]), tick: start.tick + 3 }, P, start.tick + 3);
      expect(sim.drainSideContacts().length).toBeGreaterThan(0);
    } finally { sim.clear(); }
  }
});
