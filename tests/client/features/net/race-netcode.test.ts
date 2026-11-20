import { describe, expect, it } from "vitest";
import { TICK_MS, VIEWPORT } from "@floor-fifty/shared/common/constants";
import { shortestWrappedOffset } from "@floor-fifty/shared/common/math";
import type { InputFrame, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { asPlayerName } from "@floor-fifty/shared/common/ids";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { InputIntent } from "../../../../apps/client/src/features/platform/input";
import { INITIAL_LEAD_TICKS } from "../../../../apps/client/src/features/net/input-lead";
import {
  MAX_CATCH_UP_TICKS,
  PING_EVERY_MS,
  RaceNetcode,
} from "../../../../apps/client/src/features/net/race-netcode";
import { LOCAL_ID, stateToSnapshot } from "../../support/snapshots";

const tuning = resolveTuning();
const IDLE: InputIntent = { left: false, right: false, fastFall: false, reset: false };

/** A racing room with the local player seated, as a snapshot at `tick`. */
function racingAt(tick: number, phase: RaceState["phase"] = "racing"): RoomSnapshot {
  const state = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [{ id: LOCAL_ID, name: asPlayerName("Kite") }],
  });
  return stateToSnapshot({ ...state, tick, phase, raceStartedAtTick: 0 }, []);
}

function harness(options: { roundTripMs?: number } = {}) {
  const sent: InputFrame[] = [];
  const pings: number[] = [];
  const netcode = new RaceNetcode({
    tuning,
    send: (frame) => sent.push(frame),
    ping: (tick) => {
      pings.push(tick);
      return pings.length;
    },
    ...options,
  });
  return { netcode, sent, pings };
}

describe("the race's netcode", () => {
  it("sends its first frame at once, stamped with the tick it predicts", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);

    expect(sent).toHaveLength(1);
    // Authority is at about tick 31 on the one clock; the frame is stamped the
    // lead's worth past it, which is when it takes effect on both sides.
    expect(sent[0]!.tick).toBe(netcode.sampledTick);
    expect(sent[0]!.tick - 31).toBeGreaterThanOrEqual(INITIAL_LEAD_TICKS - 1);
  });

  it("sends only when the intent changes, and every press of reset", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);
    for (let frame = 0; frame < 5; frame += 1) netcode.frame(() => IDLE, TICK_MS);
    expect(sent).toHaveLength(1);

    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    netcode.frame(() => ({ ...IDLE, right: true, reset: true }), TICK_MS);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent.map((frame) => [frame.right, frame.reset])).toEqual([
      [false, false],
      [true, false],
      [true, true],
      [true, false],
    ]);
    // Sequences climb by one per frame, and ticks never go backward.
    sent.forEach((frame, index) => {
      expect(frame.sequence).toBe(index + 1);
      if (index > 0) expect(frame.tick).toBeGreaterThan(sent[index - 1]!.tick);
    });
  });

  it("stamps a change on the latest tick a long frame reaches, never an earlier one", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);
    const before = netcode.sampledTick!;

    // A hitch: one frame covers three ticks. The key could only be noticed now.
    netcode.frame(() => ({ ...IDLE, left: true }), TICK_MS * 3);
    expect(sent.at(-1)!.tick).toBe(netcode.sampledTick);
    expect(netcode.sampledTick! - before).toBeGreaterThanOrEqual(2);
  });

  it("sends nothing while the room is not taking input", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30, "lobby"), LOCAL_ID);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent).toEqual([]);

    netcode.observe(racingAt(33, "countdown"), LOCAL_ID);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent).toHaveLength(1);
  });

  it("re-seats after a long gap instead of sampling every tick it missed", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);
    const before = netcode.sampledTick!;
    let samples = 0;

    netcode.observe(racingAt(630), LOCAL_ID);
    netcode.frame(() => {
      samples += 1;
      return { ...IDLE, right: true };
    }, TICK_MS);

    expect(samples).toBe(1);
    expect(netcode.sampledTick! - before).toBeGreaterThan(MAX_CATCH_UP_TICKS);
    expect(sent.at(-1)!.tick).toBe(netcode.sampledTick);
  });

  it("keeps sampling if the clock ever lands far behind the input tick", () => {
    // Input must never go dead waiting for a clock to catch up with it.
    const { netcode, sent } = harness();
    netcode.observe(racingAt(300), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);
    // A restarted clock, far behind where input had got to.
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent.at(-1)).toMatchObject({ right: true });
  });

  it("sends the current intent again after the connection comes back", () => {
    const { netcode, sent } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent).toHaveLength(1);

    netcode.resync();
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ sequence: 2, right: true });
  });

  it("numbers on from the room's count when it takes over a seat already in the race", () => {
    // A reloaded page reclaims its seat with a fresh netcode. The room kept
    // the seat's numbering, and refuses any frame at or below it.
    const { netcode, sent } = harness();
    const snapshot = racingAt(30);
    snapshot.players[0]!.lastAckedSequence = 40;
    netcode.observe(snapshot, LOCAL_ID);
    netcode.frame(() => ({ ...IDLE, right: true }), TICK_MS);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sequence: 41, right: true });
  });

  it("probes the clock on a schedule and lets the answers steer the lead", () => {
    const { netcode, pings } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    for (let frame = 0; frame < Math.ceil(PING_EVERY_MS / TICK_MS) + 2; frame += 1) {
      netcode.frame(() => IDLE, TICK_MS);
    }
    expect(pings).toHaveLength(2);

    // The room says the first probe arrived ten ticks late: the lead has to grow.
    const before = netcode.leadTicks;
    netcode.pong(1, 170, -10);
    expect(netcode.leadTicks).toBeGreaterThan(before + 9);
  });

  it("does not steer the lead from a probe sent while the clock was catching up", () => {
    // The first gameplay frames compile shaders and upload textures; a clock
    // that is several ticks off authority then sends a probe whose tick means
    // nothing. Believing its answer leapt the lead to its cap.
    const { netcode } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.observe(racingAt(39), LOCAL_ID); // nine ticks ahead of the clock: not snapped, not caught up
    netcode.frame(() => IDLE, TICK_MS);
    const before = netcode.leadTicks;

    netcode.pong(1, 20, -110);
    expect(netcode.leadTicks).toBe(before);
  });

  it("starts with the lead a measured round trip asks for", () => {
    expect(harness({ roundTripMs: 200 }).netcode.leadTicks).toBeCloseTo(200 / TICK_MS + 3, 9);
    expect(harness().netcode.leadTicks).toBe(INITIAL_LEAD_TICKS);
  });

  it("draws moving floors at the predicted tick while it leads", () => {
    const { netcode } = harness();
    const snapshot = racingAt(30);
    netcode.observe(snapshot, LOCAL_ID);
    const frame = netcode.frame(() => IDLE, TICK_MS)!;

    const moving = snapshot.platforms.filter((platform) =>
      frame.floors?.has(platform.id),
    );
    expect(moving.length).toBeGreaterThan(0);
    // Predicted several ticks past the sample the rest of the room is drawn at.
    const moved = moving.some((platform) => frame.floors!.get(platform.id) !== platform.x);
    expect(moved).toBe(true);
    expect(netcode.predictedRace()!.tick).toBe(netcode.sampledTick);
  });

  it("moves the local racer on every frame of a 144 Hz display, by an even step", () => {
    // The prediction steps whole ticks, sixty a second. Drawn at the tick it
    // had reached, the racer moved on two frames in five and stood still on
    // the other three, while everyone interpolated beside it moved every frame.
    const { netcode } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    const FRAME_MS = 1000 / 144;
    const steps: number[] = [];
    let previous: number | undefined;
    // A dozen ticks of running: past that, this course's first floor edge
    // stops the racer, and a racer held against a wall rightly stops moving.
    for (let frame = 0; frame < 30; frame += 1) {
      const drawn = netcode.frame(() => ({ ...IDLE, right: true }), FRAME_MS)?.predicted;
      // The first frames cover the tick before the key took effect.
      if (drawn === undefined || frame < 6) continue;
      if (previous !== undefined) {
        steps.push(shortestWrappedOffset(previous, drawn.x, VIEWPORT.width));
      }
      previous = drawn.x;
    }

    const even = tuning.MAX_MOVE_SPEED / 144;
    expect(steps.length).toBeGreaterThan(20);
    for (const step of steps) {
      expect(step).toBeGreaterThan(even * 0.9);
      expect(step).toBeLessThan(even * 1.1);
    }
  });

  it("draws the local racer where it was when a correction lands", () => {
    // Authority restarts the racer's bounce three ticks on, which the
    // prediction did not do: a correction well short of a snap, eased rather
    // than adopted. A frame of no length afterwards is the same moment again,
    // so it has to draw the same place.
    const { netcode } = harness();
    const RIGHT = { ...IDLE, right: true };
    netcode.observe(racingAt(30), LOCAL_ID);
    // Thirteen frames: twelve would be exactly five ticks, a whole tick where
    // the blend and the newest tick agree and any correction looks continuous.
    let before = netcode.frame(() => RIGHT, 1000 / 144)!.predicted!;
    for (let frame = 0; frame < 12; frame += 1) {
      before = netcode.frame(() => RIGHT, 1000 / 144)!.predicted!;
    }

    netcode.observe(racingAt(33), LOCAL_ID);
    const after = netcode.frame(() => RIGHT, 0)!.predicted!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("forgets everything when the race is left", () => {
    const { netcode } = harness();
    netcode.observe(racingAt(30), LOCAL_ID);
    netcode.frame(() => IDLE, TICK_MS);
    netcode.clear();
    expect(netcode.sampledTick).toBeUndefined();
    expect(netcode.predicted()).toBeUndefined();
    expect(netcode.frame(() => IDLE, TICK_MS)).toBeUndefined();
  });
});

describe("a presentation time scale (race-flow spec §5.2)", () => {
  it("slows the drawn moment and changes neither authority nor what is sent", () => {
    const plain = harness();
    const slowed = harness();
    slowed.netcode.setPresentationScale(0.25);
    for (let frame = 0; frame < 60; frame += 1) {
      for (const side of [plain, slowed]) {
        if (frame % 3 === 0) side.netcode.observe(racingAt(100 + frame), LOCAL_ID);
        side.netcode.frame(() => ({ ...IDLE, right: frame % 10 < 5 }), TICK_MS);
      }
    }
    expect(slowed.netcode.authorityTick()).toBe(plain.netcode.authorityTick());
    expect(slowed.sent).toEqual(plain.sent);
    expect(slowed.netcode.renderTick()!).toBeLessThan(plain.netcode.renderTick()! - 30);
  });

  it("draws everyone, the local racer included, from the room's record while slowed", () => {
    const { netcode } = harness();
    netcode.setPresentationScale(0.25);
    netcode.observe(racingAt(100), LOCAL_ID);
    const frame = netcode.frame(() => IDLE, TICK_MS);
    expect(frame?.predicted).toBeUndefined();
  });
});

