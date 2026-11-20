import { describe, expect, it } from "vitest";
import { CommandLedger, requestIdOf } from "../../../apps/server/src/rooms/command-ledger";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";

/** A command that counts how often it actually ran. */
function counter(): { run: () => void; readonly runs: number } {
  let runs = 0;
  return {
    run: () => {
      runs += 1;
    },
    get runs() {
      return runs;
    },
  };
}

describe("the command ledger", () => {
  it("runs a new request and answers it ok", () => {
    const ledger = new CommandLedger();
    const command = counter();
    expect(ledger.answer("s1", "r1", command.run)).toEqual({
      result: { requestId: "r1", ok: true },
      replayed: false,
    });
    expect(command.runs).toBe(1);
  });

  it("replays a repeated request id without running it again", () => {
    const ledger = new CommandLedger();
    const command = counter();
    ledger.answer("s1", "r1", command.run);
    expect(ledger.answer("s1", "r1", command.run)).toEqual({
      result: { requestId: "r1", ok: true },
      replayed: true,
    });
    expect(command.runs).toBe(1);
  });

  it("answers a refusal with its own code, and replays the refusal", () => {
    const ledger = new CommandLedger();
    let runs = 0;
    const refuse = (): void => {
      runs += 1;
      throw new RoomCommandError("NOT_HOST", "only the host chooses the lap count");
    };
    const first = ledger.answer("s1", "r1", refuse);
    expect(first.result).toEqual({
      requestId: "r1",
      ok: false,
      error: { code: "NOT_HOST", message: "only the host chooses the lap count" },
    });
    expect(ledger.answer("s1", "r1", refuse).replayed).toBe(true);
    expect(runs).toBe(1);
  });

  it("answers an unexpected throw with a generic message, never the error's text", () => {
    const ledger = new CommandLedger();
    const answer = ledger.answer("s1", "r1", () => {
      throw new Error("internal detail a player must not see");
    });
    expect(answer.result).toEqual({
      requestId: "r1",
      ok: false,
      error: { code: "MALFORMED_MESSAGE", message: "the server could not process that message" },
    });
  });

  it("keeps each session's history apart", () => {
    const ledger = new CommandLedger();
    const command = counter();
    ledger.answer("s1", "r1", command.run);
    expect(ledger.answer("s2", "r1", command.run).replayed).toBe(false);
    expect(command.runs).toBe(2);
  });

  it("forgets the oldest answer once a session's history is full", () => {
    const ledger = new CommandLedger(2);
    const command = counter();
    ledger.answer("s1", "r1", command.run);
    ledger.answer("s1", "r2", command.run);
    ledger.answer("s1", "r3", command.run);
    // r1 was evicted to make room for r3, so resending it runs it again.
    expect(ledger.answer("s1", "r1", command.run).replayed).toBe(false);
    // r3 was stored after the eviction and is still remembered.
    expect(ledger.answer("s1", "r3", command.run).replayed).toBe(true);
  });

  it("holds sixty-four answers per session by default", () => {
    const ledger = new CommandLedger();
    const command = counter();
    for (let id = 1; id <= 65; id += 1) ledger.answer("s1", `r${id}`, command.run);
    expect(ledger.answer("s1", "r65", command.run).replayed).toBe(true);
    expect(ledger.answer("s1", "r2", command.run).replayed).toBe(true);
    expect(ledger.answer("s1", "r1", command.run).replayed).toBe(false);
  });

  it("forgets a session entirely", () => {
    const ledger = new CommandLedger();
    const command = counter();
    ledger.answer("s1", "r1", command.run);
    ledger.forget("s1");
    expect(ledger.answer("s1", "r1", command.run).replayed).toBe(false);
  });
});

describe("reading a request id", () => {
  it("reads the id a command carries", () => {
    expect(requestIdOf({ requestId: "abc", ready: true })).toBe("abc");
  });

  it("accepts ids of one and of sixty-four characters", () => {
    expect(requestIdOf({ requestId: "x" })).toBe("x");
    expect(requestIdOf({ requestId: "x".repeat(64) })).toBe("x".repeat(64));
  });

  it("finds nothing in an id that is not a string, without converting it", () => {
    expect(requestIdOf({ requestId: 42 })).toBeUndefined();
    expect(requestIdOf({ requestId: true })).toBeUndefined();
    expect(requestIdOf({ requestId: null })).toBeUndefined();
    expect(requestIdOf({ requestId: ["r1"] })).toBeUndefined();
    // A decoded object can carry a `toString` that is not a function, so
    // converting it throws (audit A01). Reading it must not.
    expect(() => requestIdOf({ requestId: { toString: 1 } })).not.toThrow();
    expect(requestIdOf({ requestId: { toString: 1 } })).toBeUndefined();
  });

  it("finds nothing in an empty or over-long id", () => {
    expect(requestIdOf({ requestId: "" })).toBeUndefined();
    expect(requestIdOf({ requestId: "x".repeat(65) })).toBeUndefined();
  });

  it("reads only the payload's own plain id, never an inherited or computed one", () => {
    expect(requestIdOf(Object.create({ requestId: "r1" }))).toBeUndefined();
    const computed = Object.defineProperty({}, "requestId", {
      enumerable: true,
      get: () => {
        throw new Error("a getter ran");
      },
    });
    expect(() => requestIdOf(computed)).not.toThrow();
    expect(requestIdOf(computed)).toBeUndefined();
  });

  it("finds nothing in a payload without one", () => {
    expect(requestIdOf({ ready: true })).toBeUndefined();
    expect(requestIdOf(null)).toBeUndefined();
    expect(requestIdOf("setReady")).toBeUndefined();
  });
});
