// @vitest-environment node
/**
 * Authority and immediacy.
 *
 * The design permits a local client to answer a contact before the server has,
 * on one condition: what it says must not be the thing the server is about to
 * say. These are the tests of that condition, and of the three failures it is
 * there to prevent -- a doubled impact, a cue nobody takes back, and a remote
 * racer being predicted at all.
 */

import { describe, expect, it } from "vitest";
import { MAX_LEAD_TICKS } from "../../../../apps/client/src/features/net/input-lead";
import {
  CONFIRMATION_WINDOW_TICKS,
  SpeculativeContacts,
} from "../../../../apps/client/src/features/net/speculative-contact";

describe("predicting a contact", () => {
  it("answers immediately, without waiting for the server", () => {
    const contacts = new SpeculativeContacts();
    expect(contacts.predict({ floorId: "floor-3", tick: 100 })).toEqual({
      kind: "speculate",
      floorId: "floor-3",
    });
  });

  it("ticks a continuing contact once, not once a tick", () => {
    // A wall ride touches the same face on consecutive ticks. Each of those is
    // the same contact continuing, and ticking every one would turn a ride into
    // a buzz.
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });

    for (let tick = 101; tick < 110; tick += 1) {
      expect(contacts.predict({ floorId: "floor-3", tick })).toBeUndefined();
    }
    expect(contacts.outstanding).toBe(1);
  });

  it("treats a different floor as a different contact", () => {
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });
    expect(contacts.predict({ floorId: "floor-4", tick: 104 })).toBeDefined();
  });
});

describe("confirmation", () => {
  it("upgrades a prediction rather than sounding a second impact", () => {
    // The whole point. The player already heard a tick when their racer
    // touched the floor; the confirmation owes them the landing, not the tick
    // again.
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });

    expect(contacts.confirm("floor-3", "t102:floorLanded:p1:floor-3")).toEqual({
      kind: "upgrade",
      floorId: "floor-3",
      eventId: "t102:floorLanded:p1:floor-3",
    });
    expect(contacts.outstanding).toBe(0);
  });

  it("confirms a landing nothing predicted, which is the ordinary case", () => {
    const contacts = new SpeculativeContacts();
    expect(contacts.confirm("floor-9", "t200:floorLanded:p1:floor-9").kind).toBe("confirm");
  });

  it("upgrades once, however many times the event is redelivered", () => {
    // A reconnect replays a batch of snapshots. The second delivery finds no
    // prediction left and reports a plain confirmation, which the mixer then
    // discards on the event ID it already heard.
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });

    const first = contacts.confirm("floor-3", "t102:floorLanded:p1:floor-3");
    const second = contacts.confirm("floor-3", "t102:floorLanded:p1:floor-3");

    expect(first.kind).toBe("upgrade");
    expect(second.kind).toBe("confirm");
    // Both carry the same authoritative identity, which is what the mixer
    // discards the redelivery on.
    if ("eventId" in first && "eventId" in second) {
      expect(first.eventId).toBe(second.eventId);
    }
  });

  it("tolerates the server's tick differing from the predicted one", () => {
    // A prediction runs ahead of authority by design, so the two ticks are
    // never expected to match. Identity is the floor, which both agree on.
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });
    expect(contacts.confirm("floor-3", "t117:floorLanded:p1:floor-3").kind).toBe("upgrade");
  });
});

describe("cancellation", () => {
  it("drops a prediction the server never confirms", () => {
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });

    expect(contacts.expire(100 + CONFIRMATION_WINDOW_TICKS - 1)).toEqual([]);
    expect(contacts.expire(100 + CONFIRMATION_WINDOW_TICKS)).toEqual([
      { kind: "cancel", floorId: "floor-3" },
    ]);
    expect(contacts.outstanding).toBe(0);
  });

  it("waits long enough to cover a real round trip", () => {
    // Half a second of ticks. Shorter than this and a prediction on a slow
    // connection would be cancelled moments before the server agreed with it.
    expect(CONFIRMATION_WINDOW_TICKS).toBeGreaterThanOrEqual(30);
  });

  it("waits out the input lead too, because it counts on the predicted tick", () => {
    // The prediction runs up to the maximum lead ahead of authority, and the
    // confirmation still has its round trip to make after that.
    expect(CONFIRMATION_WINDOW_TICKS).toBeGreaterThanOrEqual(MAX_LEAD_TICKS + 30);
  });

  it("cannot cancel a contact already upgraded", () => {
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });
    contacts.confirm("floor-3", "t102:floorLanded:p1:floor-3");

    expect(contacts.expire(100 + CONFIRMATION_WINDOW_TICKS * 4)).toEqual([]);
  });

  it("expires each prediction on its own clock", () => {
    const contacts = new SpeculativeContacts();
    contacts.predict({ floorId: "floor-3", tick: 100 });
    contacts.predict({ floorId: "floor-4", tick: 140 });

    expect(contacts.expire(100 + CONFIRMATION_WINDOW_TICKS)).toEqual([
      { kind: "cancel", floorId: "floor-3" },
    ]);
    expect(contacts.outstanding).toBe(1);
  });
});

describe("what a speculative cue may be", () => {
  it("names only effects, never a score, a floor or a camera move", () => {
    // The rule the design puts on this, expressed as the only thing the type
    // can express. A caller reading this cannot credit a floor from a
    // prediction because there is nothing here that would let it.
    const contacts = new SpeculativeContacts();
    const speculative = contacts.predict({ floorId: "floor-3", tick: 100 })!;

    expect(Object.keys(speculative).sort()).toEqual(["floorId", "kind"]);
    expect(speculative.kind).toBe("speculate");
  });
});
