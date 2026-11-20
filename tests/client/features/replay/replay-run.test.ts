/**
 * A replay played on this device (race-options spec §7.2): it steps to the
 * recorded result, re-keys its events per playthrough, and changes what is
 * drawn with speed and pause, never what is simulated.
 */
import { describe, expect, it } from "vitest";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { checkReplay, liveReplaySimulations, MAX_STEPS_PER_FRAME, ReplayRun, VERSION_MISMATCH } from "../../../../apps/client/src/features/replay/replay-run";
import { deflateReplaySync } from "../../../../apps/server/src/rooms/replay-compression";
import { GO_TICK, runRoomLike } from "../../../server/support/room-like";
import { contentFor } from "./replay-content";

const race = runRoomLike({ tuning: resolveTuning(), seats: 2 });
const bytes = deflateReplaySync(race.replay);

async function opened(): Promise<ReplayRun> {
  const run = await ReplayRun.open(bytes, contentFor(race.replay));
  if (!(run instanceof ReplayRun)) throw new Error(run.message());
  return run;
}

function playThrough(run: ReplayRun): { ids: string[]; drifts: number; tick: number } {
  const ids: string[] = [];
  let drifts = 0;
  let tick = GO_TICK;
  for (let guard = 0; guard < 100_000; guard += 1) {
    const frame = run.advance(TICK_MS * MAX_STEPS_PER_FRAME);
    ids.push(...frame.events.map((event) => event.id));
    if (frame.driftedNow) drifts += 1;
    tick = frame.snapshot.tick;
    if (frame.finished) break;
  }
  return { ids, drifts, tick };
}

describe("ReplayRun (race-options spec §7.2)", () => {
  it("steps to the recorded final tick with no drift", async () => {
    const run = await opened();
    const played = playThrough(run);
    expect(played.drifts).toBe(0);
    expect(played.tick).toBe(race.replay.finalTick);
    expect(run.progress()).toBe(1);
    run.dispose();
  });

  it("re-keys every event per playthrough, so Restart sounds each cue again, once", async () => {
    const run = await opened();
    const first = playThrough(run).ids;
    run.restart();
    const second = playThrough(run).ids;
    expect(first.length).toBeGreaterThan(0);
    const prefix = (ids: string[]): string => /^replay:\d+:/.exec(ids[0]!)![0];
    expect(first.every((id) => id.startsWith(prefix(first)))).toBe(true);
    expect(second.every((id) => id.startsWith(prefix(second)))).toBe(true);
    expect(prefix(second)).not.toBe(prefix(first));
    expect(new Set(first).size).toBe(first.length);
    expect(second.map((id) => id.slice(prefix(second).length))).toEqual(first.map((id) => id.slice(prefix(first).length)));
    run.dispose();
  });

  it("keys a second viewing apart from the first, so watching again sounds every cue", async () => {
    // The audio engine never forgets an event ID: a second `ReplayRun` on the
    // same page must not reuse the first one's keys.
    const first = await opened();
    const firstIds = new Set(playThrough(first).ids);
    first.dispose();
    const second = await opened();
    const secondIds = playThrough(second).ids;
    second.dispose();
    expect(secondIds.length).toBeGreaterThan(0);
    expect(secondIds.filter((id) => firstIds.has(id))).toEqual([]);
  });

  it("shows the drift notice once on a tampered check", async () => {
    const tampered = {
      ...race.replay,
      checks: race.replay.checks.map((check, i) => (i === 1 ? { ...check, hash: check.hash ^ 1 } : check)),
    };
    const run = await ReplayRun.open(deflateReplaySync(tampered), contentFor(tampered));
    if (!(run instanceof ReplayRun)) throw new Error(run.message());
    expect(playThrough(run).drifts).toBe(1);
    run.dispose();
  });

  it("refuses a replay from a different ruleset, course or mode", () => {
    const content = contentFor(race.replay);
    expect(checkReplay(race.replay, content)).toBeUndefined();
    expect(checkReplay(race.replay, { ...content, rulesetRevision: "x".repeat(64) as typeof content.rulesetRevision })?.message()).toBe(
      VERSION_MISMATCH(),
    );
    expect(
      checkReplay(race.replay, { ...content, courseRevisions: { ...content.courseRevisions, rooftops: "y".repeat(64) as never } })?.message(),
    ).toBe(VERSION_MISMATCH());
    expect(checkReplay(race.replay, { ...content, content: { ...content.content, modes: [] } })?.message()).toBe(VERSION_MISMATCH());
  });

  it("refuses bytes that are not a replay", async () => {
    const refused = await ReplayRun.open(new Uint8Array([1, 2, 3]), contentFor(race.replay));
    expect(refused).toEqual({ message: VERSION_MISMATCH });
  });

  it("changes what is drawn with speed and pause, never what is simulated", async () => {
    const slow = await opened();
    slow.speed = 0.5;
    const fast = await opened();
    fast.speed = 2;
    const a = slow.advance(100).snapshot.tick;
    const b = fast.advance(100).snapshot.tick;
    expect(b - GO_TICK).toBeGreaterThan(a - GO_TICK);
    fast.setPaused(true);
    expect(fast.advance(100).snapshot.tick).toBe(b);
    fast.setPaused(false);
    expect(playThrough(slow).drifts + playThrough(fast).drifts).toBe(0);
    slow.dispose();
    fast.dispose();
  });

  describe("seeking (the draggable bar)", () => {
    /** Frames until the seek lands, collecting what they returned. */
    function settle(run: ReplayRun): { frames: number; events: number; last: ReturnType<ReplayRun["advance"]> } {
      let frames = 0;
      let events = 0;
      let last = run.advance(0);
      for (; last.seeking && frames < 100_000; frames += 1) {
        events += last.events.length;
        last = run.advance(0);
      }
      return { frames, events: events + last.events.length, last };
    }

    /** The players as drawn after each step, from a run played one tick a frame. */
    async function reference(): Promise<RoomSnapshot["players"][]> {
      const run = await opened();
      const drawn = [run.advance(0).snapshot.players];
      while (!run.advance(0).finished) drawn.push(run.advance(TICK_MS).snapshot.players);
      run.dispose();
      return drawn;
    }

    it("lands exactly where playing would have, backward and forward, and never drifts", async () => {
      const drawn = await reference();
      const run = await opened();
      expect(run.length).toBe(race.replay.finalTick - GO_TICK + 1);
      for (const position of [Math.floor(run.length * 0.8), 30, run.length - 1, 0, Math.floor(run.length / 2)]) {
        run.seek(position);
        const { last } = settle(run);
        expect(run.position).toBe(position);
        expect(last.snapshot.players).toEqual(drawn[position]);
        expect(last.driftedNow).toBe(false);
      }
      run.dispose();
    });

    it("sounds nothing it skipped, and keys the ticks after a rewind afresh so their cues sound again", async () => {
      const run = await opened();
      const before = playThrough(run).ids;
      run.seek(0);
      expect(settle(run).events).toBe(0);
      const after = playThrough(run).ids;
      expect(after.length).toBe(before.length);
      expect(after.filter((id) => before.includes(id))).toEqual([]);
      run.seek(run.length);
      expect(settle(run).events).toBe(0);
      run.dispose();
    });

    it("holds the last drawn frame and reports the target while it catches up", async () => {
      const run = await opened();
      const shown = run.advance(TICK_MS * 4).snapshot;
      run.seek(run.length - 1);
      // No budget: one step a frame, so this frame is still catching up.
      const first = run.advance(0, 1, 0);
      expect(first.seeking).toBe(true);
      expect(first.snapshot.tick).toBe(shown.tick);
      expect(first.finished).toBe(false);
      expect(run.progress()).toBeCloseTo((run.length - 1) / run.length);
      settle(run);
      expect(run.position).toBe(run.length - 1);
      run.dispose();
    });

    it("spreads a long seek over frames within its budget, and finishes at the end", async () => {
      const run = await opened();
      run.seek(run.length);
      // No budget at all still steps once a frame, so a seek always arrives.
      expect(run.advance(0, 1, 0).seeking).toBe(true);
      const { last } = settle(run);
      expect(last.finished).toBe(true);
      expect(run.progress()).toBe(1);
      run.dispose();
    });

    it("stays paused through a seek", async () => {
      const run = await opened();
      run.setPaused(true);
      run.seek(120);
      settle(run);
      expect(run.position).toBe(120);
      expect(run.advance(1_000).snapshot.tick).toBe(run.tick);
      expect(run.position).toBe(120);
      run.dispose();
    });
  });

  it("caps the steps in one frame, so a slow device plays late rather than stalling", async () => {
    const run = await opened();
    expect(run.advance(10_000).snapshot.tick - GO_TICK).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    run.dispose();
  });

  it("leaves no simulation behind after five open, restart, seek and dispose cycles (spec §10.1 Leaks)", async () => {
    const before = liveReplaySimulations();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const run = await opened();
      expect(liveReplaySimulations()).toBe(before + 1);
      run.advance(TICK_MS * MAX_STEPS_PER_FRAME);
      run.restart();
      run.seek(30);
      run.advance(0);
      expect(liveReplaySimulations()).toBe(before + 1);
      run.dispose();
      run.dispose();
    }
    expect(liveReplaySimulations()).toBe(before);
  });
});
