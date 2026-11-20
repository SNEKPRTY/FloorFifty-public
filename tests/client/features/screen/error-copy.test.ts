import type { ServerErrorCode } from "@floor-fifty/shared/common/protocol";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorCopy } from "../../../../apps/client/src/features/screen/error-copy";
import { recoverableError } from "../../../../apps/client/src/features/net/error-view";

describe("errorCopy (languages spec §4.4, §8.1)", () => {
  it("has copy for every recoverable and server code", () => {
    for (const code of ERROR_CODES) expect(errorCopy(code)().length).toBeGreaterThan(0);
  });

  it("covers the server's codes exactly", () => {
    const server: Record<ServerErrorCode, true> = {
      INVALID_ROOM: true,
      ROOM_FULL: true,
      VERSION_MISMATCH: true,
      ROOM_CLOSED: true,
      NOT_HOST: true,
      MALFORMED_MESSAGE: true,
      RATE_LIMITED: true,
      STILL_SEARCHING: true,
      SIMULATION_FAILURE: true,
      SERVER_UPDATING: true,
      SERVER_BUSY: true,
      UNREACHABLE: true,
    };
    for (const code of Object.keys(server)) expect(ERROR_CODES).toContain(code);
  });

  it("keeps the distinctions a detail carries", () => {
    expect(errorCopy("ROOM_CLOSED", "last-room-closed")()).toBe("Your last room has closed.");
    expect(errorCopy("ROOM_CLOSED", "seat-lost")()).toBe("You were disconnected for too long and lost your seat.");
    expect(errorCopy("ROOM_CLOSED", "room-racing")()).toBe("That room is already racing.");
    expect(errorCopy("ROOM_CLOSED")()).toBe("The room was closed.");
    expect(errorCopy("ASSET_LOAD_FAILED", "race-assets")()).toBe("Could not load the race.");
    expect(errorCopy("ASSET_LOAD_FAILED")()).toBe("Could not load the game.");
  });

  it("says an unreachable server in its own words, not as a wrong room code (audit S7, Owner's string B)", () => {
    expect(errorCopy("UNREACHABLE")()).toBe("Could not reach the game server. Check your connection and try again.");
    expect(errorCopy("UNREACHABLE")()).not.toBe(errorCopy("INVALID_ROOM")());
    expect(recoverableError("UNREACHABLE")).toEqual({ code: "UNREACHABLE", retry: true });
  });

  it("carries a detail, never prose, in a recoverable error", () => {
    const error = recoverableError("ROOM_CLOSED", "last-room-closed");
    expect(error).toEqual({ code: "ROOM_CLOSED", detail: "last-room-closed", retry: false });
    expect("message" in error).toBe(false);
    expect(recoverableError("ASSET_LOAD_FAILED")).toEqual({ code: "ASSET_LOAD_FAILED", retry: true });
  });
});
