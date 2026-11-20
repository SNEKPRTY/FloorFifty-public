// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { onRoomError, roomIsGone } from "../../../../apps/client/src/features/net/room-gone";

/**
 * Audit S10: a room that died during character, stage or song select left the
 * player on a dead screen. A pushed error only set the status line; whether the
 * player is "in a room" comes from a store that only a snapshot or a command
 * changes, and select has no Leave. A phone player who switches apps for over
 * 30 seconds, or a server restart, came back to a screen only a reload left.
 */

const harness = (leave: () => Promise<void> = () => Promise.resolve()) => {
  const calls: string[] = [];
  const deps = {
    network: {
      leaveRoom: vi.fn(async () => {
        calls.push("leave");
        await leave();
      }),
    },
    sync: vi.fn(() => void calls.push("sync")),
    report: vi.fn(() => void calls.push("report")),
  };
  return { deps, calls };
};
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("an error that says the room is gone (audit S10)", () => {
  it("is only a room that closed", () => {
    expect(roomIsGone({ code: "ROOM_CLOSED" })).toBe(true);
    expect(roomIsGone({ code: "RATE_LIMITED" })).toBe(false);
    expect(roomIsGone({ code: "NOT_HOST" })).toBe(false);
    expect(roomIsGone(undefined)).toBe(false);
    expect(roomIsGone("ROOM_CLOSED")).toBe(false);
  });

  it("is told to the player, then the room is left and the store re-read, so the connect panel returns", async () => {
    const { deps, calls } = harness();
    onRoomError({ code: "ROOM_CLOSED", detail: "seat-lost" }, deps);
    await settled();
    expect(calls).toEqual(["report", "leave", "sync"]);
  });

  it("re-reads the store even when leaving fails, because the room is already gone", async () => {
    const { deps, calls } = harness(() => Promise.reject(new Error("socket already closed")));
    onRoomError({ code: "ROOM_CLOSED" }, deps);
    await settled();
    expect(calls).toEqual(["report", "leave", "sync"]);
  });

  it("leaves the player in a room that only refused a command", async () => {
    const { deps, calls } = harness();
    onRoomError({ code: "NOT_HOST" }, deps);
    await settled();
    expect(calls).toEqual(["report"]);
    expect(deps.network.leaveRoom).not.toHaveBeenCalled();
  });
});
