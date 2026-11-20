// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanRoomCode } from "../../../../apps/client/src/features/lobby/room-code-input";

describe("a room code as typed or pasted", () => {
  it("survives the space or line break a chat app adds around it", () => {
    expect(cleanRoomCode(" ABC234")).toBe("ABC234");
    expect(cleanRoomCode("ABC234\n")).toBe("ABC234");
    expect(cleanRoomCode("\tabc234 ")).toBe("ABC234");
  });

  it("drops a separator a friend typed in the middle", () => {
    expect(cleanRoomCode("ABC-234")).toBe("ABC234");
    expect(cleanRoomCode("abc 234")).toBe("ABC234");
  });

  it("stops at the code's length once cleaned, not before", () => {
    expect(cleanRoomCode("ABC2345")).toBe("ABC234");
    expect(cleanRoomCode("   ABC234")).toBe("ABC234");
  });

  it("keeps a part-typed code as it is", () => {
    expect(cleanRoomCode("ab")).toBe("AB");
    expect(cleanRoomCode("")).toBe("");
  });
});
