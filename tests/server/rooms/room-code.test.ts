import { LocalPresence } from "@colyseus/core";
import { describe, expect, it } from "vitest";
import { ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";
import {
  ROOM_CODE_ALPHABET,
  claimRoomCode,
  generateRoomCode,
  releaseRoomCode,
} from "../../../apps/server/src/rooms/room-code";

describe("room codes", () => {
  it("uses only unambiguous characters", () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));
    }
  });

  it("does not repeat a code that is still claimed", async () => {
    const presence = new LocalPresence();
    const claimed = new Set<string>();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = await claimRoomCode(presence);
      expect(claimed.has(code)).toBe(false);
      claimed.add(code);
    }
  });

  it("returns a released code to the namespace", async () => {
    const presence = new LocalPresence();
    const code = await claimRoomCode(presence);
    await releaseRoomCode(presence, code);
    expect(await presence.smembers("floor-fifty:rooms")).not.toContain(code);
  });

  it("gives up rather than spinning when the source keeps colliding", async () => {
    const presence = new LocalPresence();
    const everyCode = { ...presence, sismember: async () => 1 } as unknown as LocalPresence;
    await expect(claimRoomCode(everyCode)).rejects.toThrow(/allocate/i);
  });
});
