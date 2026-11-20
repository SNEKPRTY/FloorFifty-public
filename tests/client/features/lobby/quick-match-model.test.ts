import { describe, expect, it } from "vitest";
import { QUICK_MATCH_SEARCH_TICKS, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import {
  announcementFor,
  clockLine,
  formatClock,
  quickMatchClock,
  readyLabel,
} from "../../../../apps/client/src/features/lobby/quick-match-model";
import { SEAT_COLOUR_NAMES } from "../../../../apps/client/src/lib/constants";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { snapshotAt } from "../../support/snapshots";

const lobby = (over: Parameters<typeof snapshotAt>[1]) => snapshotAt(0, { phase: "lobby", access: "public", ...over });

describe("quickMatchClock", () => {
  it("is absent for a private room, outside the lobby, and before any snapshot", () => {
    expect(quickMatchClock(undefined)).toBeUndefined();
    expect(quickMatchClock(lobby({ access: "private", soloFromTick: 1200 }))).toBeUndefined();
    expect(quickMatchClock(lobby({ phase: "select", soloFromTick: 1200 }))).toBeUndefined();
  });

  it("is a search with seconds left while alone, rounded up", () => {
    expect(quickMatchClock(lobby({ tick: 0, soloFromTick: QUICK_MATCH_SEARCH_TICKS }))).toEqual({ kind: "searching", seconds: 20 });
    expect(quickMatchClock(lobby({ tick: 1141, soloFromTick: QUICK_MATCH_SEARCH_TICKS }))).toEqual({ kind: "searching", seconds: 1 });
  });

  it("is solo-ready once the search has run out", () => {
    expect(quickMatchClock(lobby({ tick: 1200, soloFromTick: QUICK_MATCH_SEARCH_TICKS }))).toEqual({ kind: "solo-ready" });
  });

  it("is a start clock with seconds left with company", () => {
    expect(quickMatchClock(lobby({ tick: 360, startsAtTick: QUICK_MATCH_START_TICKS }))).toEqual({ kind: "starting", seconds: 24 });
  });

  it("never reads below zero", () => {
    expect(quickMatchClock(lobby({ tick: 5000, startsAtTick: QUICK_MATCH_START_TICKS }))).toEqual({ kind: "starting", seconds: 0 });
  });
});

describe("the words", () => {
  it("formats m:ss", () => {
    expect(formatClock(12)).toBe("0:12");
    expect(formatClock(24)).toBe("0:24");
    expect(formatClock(60)).toBe("1:00");
  });

  it("says what the room is doing", () => {
    expect(clockLine({ kind: "searching", seconds: 12 })).toBe("Looking for racers… 0:12");
    expect(clockLine({ kind: "starting", seconds: 24 })).toBe("Race starts in 0:24");
    expect(clockLine({ kind: "solo-ready" })).toBe("Nobody has joined. You can race CPUs.");
  });

  it("announces the seconds actually left, so a racer who joins late hears the true time", () => {
    expect(announcementFor("starting", 12)).toBe("Race starts in 12 seconds.");
    expect(announcementFor("starting", 1)).toBe("Race starts in 1 second.");
  });

  it("announces a clock once, in whole seconds, and nothing when there is none", () => {
    expect(announcementFor("starting", 30)).toBe("Race starts in 30 seconds.");
    expect(announcementFor("searching")).toBe("Looking for racers.");
    expect(announcementFor("solo-ready")).toBe("You can race CPUs now.");
    expect(announcementFor(undefined)).toBe("");
  });
});

describe("the Ready button", () => {
  it("reads Ready with company and in a private room", () => {
    expect(readyLabel({ kind: "starting", seconds: 20 }, false)).toBe("Ready");
    expect(readyLabel(undefined, false)).toBe("Ready");
  });

  it("reads Race CPUs while alone, during the search and after it", () => {
    expect(readyLabel({ kind: "searching", seconds: 12 }, false)).toBe("Race CPUs");
    expect(readyLabel({ kind: "solo-ready" }, false)).toBe("Race CPUs");
  });

  it("lets a racer who is already ready take it back, whatever the clock", () => {
    expect(readyLabel({ kind: "searching", seconds: 12 }, true)).toBe("Not ready");
    expect(readyLabel({ kind: "starting", seconds: 12 }, true)).toBe("Not ready");
  });
});

describe("the ready room's words come from the catalogue (languages spec §4.1)", () => {
  it("names the swatch colours through messages", () => {
    expect(SEAT_COLOUR_NAMES.gold()).toBe("Orange");
    expect(SEAT_COLOUR_NAMES.scarlet()).toBe("Red");
  });

  it("chooses the start announcement's plural by the locale's rules", () => {
    expect(m.ready_start_announcement({ seconds: 1 }, { locale: "en" })).toBe("Race starts in 1 second.");
    expect(m.ready_start_announcement({ seconds: 2 }, { locale: "en" })).toBe("Race starts in 2 seconds.");
  });
});
