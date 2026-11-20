import { describe, expect, it } from "vitest";
import { MAX_INPUT_LEAD_TICKS, RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { InputFrame } from "@floor-fifty/shared/common/protocol";
import { InputQueue, MAX_QUEUED_FRAMES } from "../../../apps/server/src/rooms/input-queue";

const P = asPlayerId("room-p1");

const frame = (sequence: number, tick: number, overrides: Partial<InputFrame> = {}): InputFrame => ({
  sequence,
  tick,
  left: false,
  right: true,
  fastFall: false,
  reset: false,
  ...overrides,
});

describe("the input queue", () => {
  it("holds a frame until the tick it was stamped for", () => {
    const queue = new InputQueue();
    // The room has stepped tick 100; the next tick it steps is 101.
    expect(queue.submit(P, frame(1, 104), 100)).toEqual({ ok: true, slack: 3 });

    expect(queue.take(101).get(P)).toBeUndefined();
    expect(queue.take(103).get(P)).toBeUndefined();
    expect(queue.take(104).get(P)).toMatchObject({ sequence: 1 });
  });

  it("keeps the frame in force until a newer one takes over", () => {
    const queue = new InputQueue();
    queue.submit(P, frame(1, 101), 100);
    queue.submit(P, frame(2, 105, { right: false, left: true }), 100);

    expect(queue.take(101).get(P)).toMatchObject({ sequence: 1 });
    expect(queue.take(104).get(P)).toMatchObject({ sequence: 1 });
    expect(queue.take(105).get(P)).toMatchObject({ sequence: 2, left: true });
    expect(queue.take(200).get(P)).toMatchObject({ sequence: 2 });
  });

  it("applies a late frame on the next tick the room steps, and says how late", () => {
    const queue = new InputQueue();
    expect(queue.submit(P, frame(1, 96), 100)).toEqual({ ok: true, slack: -5 });
    expect(queue.take(101).get(P)).toMatchObject({ sequence: 1 });
  });

  it("keeps a reset edge when a newer frame is consumed on the same tick", () => {
    // A stall delivers a burst: the reset and the release after it arrive
    // together. The newest frame wins, but the press must not be lost.
    const queue = new InputQueue();
    queue.submit(P, frame(1, 97, { reset: true }), 100);
    queue.submit(P, frame(2, 98), 100);

    const applied = queue.take(101).get(P)!;
    expect(applied.sequence).toBe(2);
    expect(applied.reset).toBe(true);
    // The carried edge belongs to that tick alone.
    expect(queue.take(102).get(P)!.reset).toBe(false);
  });

  it("refuses a sequence that does not move forward", () => {
    const queue = new InputQueue();
    queue.submit(P, frame(5, 101), 100);
    expect(queue.submit(P, frame(5, 102), 100)).toEqual({ ok: false, reason: "sequence" });
    expect(queue.submit(P, frame(3, 102), 100)).toEqual({ ok: false, reason: "sequence" });
  });

  it("refuses a sequence that jumps beyond the reconnect window", () => {
    const queue = new InputQueue();
    expect(queue.submit(P, frame(RECONNECT_GRACE_TICKS + 5, 101), 100)).toEqual({
      ok: false,
      reason: "sequence",
    });
  });

  it("refuses a frame stamped further ahead than any link needs", () => {
    const queue = new InputQueue();
    expect(queue.submit(P, frame(1, 100 + MAX_INPUT_LEAD_TICKS + 2), 100)).toEqual({
      ok: false,
      reason: "lead",
    });
    expect(queue.submit(P, frame(1, 100 + MAX_INPUT_LEAD_TICKS), 100).ok).toBe(true);
  });

  it("never lets a later sequence take effect before an earlier one", () => {
    // A frame stamped behind its predecessor is treated as taking effect with
    // it, not before it: sequence order is intent order.
    const queue = new InputQueue();
    queue.submit(P, frame(1, 110), 100);
    queue.submit(P, frame(2, 105, { left: true, right: false }), 100);

    expect(queue.take(105).get(P)).toBeUndefined();
    expect(queue.take(110).get(P)).toMatchObject({ sequence: 2 });
  });

  it("refuses a flood rather than growing without bound", () => {
    const queue = new InputQueue();
    for (let index = 1; index <= MAX_QUEUED_FRAMES; index += 1) {
      expect(queue.submit(P, frame(index, 150), 100).ok).toBe(true);
    }
    expect(queue.submit(P, frame(MAX_QUEUED_FRAMES + 1, 150), 100)).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("remembers the sequence across a disconnect, so a reconnect continues it", () => {
    const queue = new InputQueue();
    for (let index = 1; index <= 2_000; index += 1) {
      queue.submit(P, frame(index, 100 + index), 99 + index);
      queue.take(100 + index);
    }
    // A reconnect: nothing about the seat's numbering is forgotten.
    expect(queue.submit(P, frame(2_001, 2_101), 2_100).ok).toBe(true);
  });

  // Audit S13: a reload kept the queue as the dropped page left it.
  it("resumes a seat at the sequence its racer acknowledged, with nothing waiting and nothing held", () => {
    const queue = new InputQueue();
    // Frames 1 to 3 stamped ahead of the room; the room has consumed only the first.
    queue.submit(P, frame(1, 101), 100);
    queue.submit(P, frame(2, 130), 100);
    queue.submit(P, frame(3, 131), 100);
    expect(queue.take(101).get(P)).toMatchObject({ sequence: 1, right: true });

    queue.resume(P, 1);

    // The page that numbers on from what it was told (1) is accepted, and what the
    // dropped page left waiting never takes effect.
    expect(queue.take(130).get(P)).toBeUndefined();
    expect(queue.take(131).get(P)).toBeUndefined();
    expect(queue.submit(P, frame(2, 140, { right: false, left: true }), 139).ok).toBe(true);
    expect(queue.take(140).get(P)).toMatchObject({ sequence: 2, left: true, right: false });
  });

  it("still refuses what the racer had already acknowledged after a resume", () => {
    const queue = new InputQueue();
    queue.submit(P, frame(5, 101), 100);
    queue.take(101);
    queue.resume(P, 5);
    expect(queue.submit(P, frame(5, 110), 109).ok).toBe(false);
    expect(queue.submit(P, frame(6, 110), 109).ok).toBe(true);
  });

  it("forgets a seat entirely, and everything on reset", () => {
    const queue = new InputQueue();
    queue.submit(P, frame(9, 101), 100);
    queue.take(101);
    queue.forget(P);
    expect(queue.take(102).get(P)).toBeUndefined();
    expect(queue.submit(P, frame(1, 103), 102).ok).toBe(true);

    queue.reset();
    expect(queue.take(200).size).toBe(0);
  });
});
