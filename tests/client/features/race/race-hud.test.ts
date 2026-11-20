/**
 * The race HUD's model.
 *
 * The numbers the HUD shows are the ones a player races by, so they are asserted
 * against the pure function rather than through a mounted component: a test that
 * went through the DOM would be checking the same arithmetic a second time, with
 * a renderer in the way.
 *
 * The two that matter most are the ones that would be silent. A roster sorted by
 * measured progress still renders; it has simply stopped being seat order. And a
 * predicted floor still counts up; it has simply started counting something the
 * server has not agreed to.
 */

import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { LapPulses, hudModel, ordinal, standingsPillText, standingsSummary, survivalDanger } from "../../../../apps/client/src/features/race/hud-model";
import { BOTTOM_BAND, BOTTOM_BAND_FOR, placementFor } from "../../../../apps/client/src/features/race/race-hud.svelte";
import type { ViewportInfo } from "../../../../apps/client/src/features/render/stage-port";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const viewport = (overrides: Partial<ViewportInfo> = {}): ViewportInfo => ({
  canvasCss: { x: 0, y: 0, width: 1280, height: 720 },
  gameplayCss: { x: 0, y: 72, width: 1280, height: 576 },
  sceneryLogical: { x: 0, y: 0, width: 960, height: 540 },
  portrait: false,
  formFactor: "desktop",
  fieldLogical: { width: 960, height: 540 },
  pixelRatio: 1,
  ...overrides,
});

describe("the race readout", () => {
  it("counts the floors the local player has taken out of the room's total", () => {
    const model = hudModel(
      snapshotAt(300, {
        raceStartedAtTick: 0,
        floorCount: 20,
        player: { progress: 6 / 20 },
      }),
      LOCAL_ID,
    );

    expect(model.collected).toBe(6);
    expect(model.floorCount).toBe(20);
    expect(model.elapsed).toBe("0:05.0");
  });

  it("counts from the race start rather than from the room's opening", () => {
    // A lobby ticks before anyone races. A clock that read the room's age would
    // start every race already minutes in.
    const model = hudModel(
      snapshotAt(TICK_HZ * 30, { raceStartedAtTick: TICK_HZ * 25, floorCount: 20 }),
      LOCAL_ID,
    );

    expect(model.elapsed).toBe("0:05.0");
  });

  it("stops a finished racer's clock at their own result", () => {
    const model = hudModel(
      snapshotAt(TICK_HZ * 60, {
        raceStartedAtTick: 0,
        player: { finishedAtTick: TICK_HZ * 39 },
      }),
      LOCAL_ID,
    );

    expect(model.elapsed).toBe("0:39.0");
  });

  it("reads a race nobody is in as an empty one rather than a blank frame", () => {
    // The window between entering and being given a seat, and a reconnect that
    // has not been answered yet.
    const model = hudModel(snapshotAt(300, { raceStartedAtTick: 0, floorCount: 20 }));

    expect(model.collected).toBe(0);
    expect(model.lap).toBe(1);
    expect(model.floorCount).toBe(20);
    expect(model.elapsed).toBe("0:05.0");
  });

  it("formats the lap and its total from the snapshot", () => {
    const model = hudModel(snapshotAt(0, { lapCount: 3, player: { lap: 2 } }), LOCAL_ID);

    expect(model.lap).toBe(2);
    expect(model.lapCount).toBe(3);
  });
});

describe("the roster", () => {
  it("is the room's seat order, not a ranking", () => {
    // The failure this guards is quiet and plausible: sorting by progress
    // produces a standings table nobody issued, and reshuffles rows under a
    // player who is reading them.
    const behind = playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 0.1 });
    const ahead = playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", progress: 0.9 });

    const model = hudModel(snapshotAt(0, { players: [behind, ahead] }), LOCAL_ID);

    expect(model.rows.map((row) => row.name)).toEqual(["Kite", "Ninja Two"]);
    expect(model.rows.map((row) => row.seat)).toEqual([0, 1]);
  });

  it("colours a row by its player's colour, not its seat", () => {
    const model = hudModel(
      snapshotAt(0, {
        players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", colour: "gold" }), playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", colour: "scarlet" })],
      }),
      LOCAL_ID,
    );
    expect(model.rows.map((row) => row.scarf)).toEqual(["gold", "scarlet"]);
  });

  it("gives each row a stable seat colour and marks the local one", () => {
    const model = hudModel(
      snapshotAt(0, {
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite" }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", colour: "cyan" }),
        ],
      }),
      LOCAL_ID,
    );

    expect(model.rows[0]?.scarf).toBe("scarlet");
    expect(model.rows[1]?.scarf).toBe("cyan");
    expect(model.rows[0]?.local).toBe(true);
    expect(model.rows[1]?.local).toBe(false);
  });

  it("keeps a whole name, however long", () => {
    // The row may clip what it draws; the model may not clip what it carries.
    const longest = "N".repeat(24);
    const model = hudModel(
      snapshotAt(0, { players: [playerSnapshot({ id: LOCAL_ID, name: longest })] }),
      LOCAL_ID,
    );

    expect(model.rows[0]?.name).toBe(longest);
  });

  it("carries a status rather than a colour for it", () => {
    const model = hudModel(
      snapshotAt(0, {
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite" }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
        ],
      }),
      LOCAL_ID,
    );

    expect(model.rows[1]?.status).toBe("dns");
  });

  it("clamps progress into the bar's range without moving anyone", () => {
    // A prediction or a rounding error must not push a bar past its track, and
    // clamping must not reorder the rows to do it.
    const model = hudModel(
      snapshotAt(0, {
        players: [
          playerSnapshot({ id: LOCAL_ID, progress: 1.4 }),
          playerSnapshot({ id: REMOTE_ID, progress: -0.2 }),
        ],
      }),
      LOCAL_ID,
    );

    expect(model.rows[0]?.progress).toBe(1);
    expect(model.rows[1]?.progress).toBe(0);
    expect(model.rows.map((row) => row.id)).toEqual([asPlayerId(LOCAL_ID), asPlayerId(REMOTE_ID)]);
  });
});

/**
 * Where the HUD may draw.
 *
 * The requirement this preserves from the drawn HUD: an element placed in the
 * cropped tenth is not dimmed, it is covered by the bar. That was a placement
 * assertion against Pixi coordinates and is now a rectangle derived from the
 * shared viewport, which is the same claim expressed once instead of per
 * element.
 */
describe("the portrait roster strip's labels", () => {
  it("names the restart by the elapsed time in a finite race", () => {
    const model = hudModel(snapshotAt(300, { raceStartedAtTick: 0 }), LOCAL_ID);
    expect(model.restart).toBe(`Restart, time ${model.elapsed}`);
  });

  it("names each seat, and says a racer's status when it is not racing", () => {
    const model = hudModel(
      snapshotAt(10, {
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite" }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", status: "dns" }),
        ],
      }),
      LOCAL_ID,
    );

    expect(model.rows.map((row) => row.label)).toEqual(["1 Kite", "2 Wren, Did not start"]);
  });
});

describe("where the HUD may draw", () => {
  it("puts the portrait roster strip below the play field, and none in landscape", () => {
    // The strip is the one part of the HUD a finger may touch (names on tap
    // and hold), so it must never sit over the course.
    const portrait = placementFor(
      viewport({
        portrait: true,
        formFactor: "phone-portrait",
        fieldLogical: { width: 960, height: 720 },
        canvasCss: { x: 0, y: 0, width: 390, height: 844 },
        gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      }),
    );
    expect(portrait.stripTop).toBeGreaterThanOrEqual(60 + 219);
    expect(placementFor(viewport()).stripTop).toBeUndefined();
  });

  it("puts the portrait strip in the bottom band, directly above the thumbs (spec §5.4)", () => {
    // The strip belongs to a band attached to the bottom of the screen, not to
    // the field's edge, where it floated in the sky.
    const portrait = placementFor(
      viewport({
        portrait: true,
        formFactor: "phone-portrait",
        fieldLogical: { width: 960, height: 720 },
        canvasCss: { x: 0, y: 0, width: 390, height: 844 },
        gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      }),
    );
    expect(portrait.stripTop).toBeGreaterThanOrEqual(844 - BOTTOM_BAND);
  });

  it("insets the HUD 8 px from the edge on a phone held sideways, 12 on desktop (spec §5.4)", () => {
    const phone = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 844, height: 390 }, formFactor: "phone-landscape" }),
    );
    const desktop = placementFor(viewport());

    expect(phone.inset.inline).toBe(8);
    expect(desktop.inset.inline).toBe(12);
  });

  it("gives a tablet held upright its own, taller bottom band (spec §5.4)", () => {
    const tablet = placementFor(
      viewport({
        portrait: true,
        formFactor: "tablet-portrait",
        canvasCss: { x: 0, y: 0, width: 820, height: 1180 },
        gameplayCss: { x: 0, y: 60, width: 820, height: 820 },
      }),
    );

    expect(tablet.formFactor).toBe("tablet-portrait");
    expect(tablet.portrait).toBe(true);
    expect(tablet.stripTop).toBe(1180 - BOTTOM_BAND_FOR["tablet-portrait"]);
    expect(BOTTOM_BAND).toBe(BOTTOM_BAND_FOR["phone-portrait"]);
  });

  it("starts below the letterbox crop in landscape", () => {
    const placement = placementFor(viewport({ gameplayCss: { x: 0, y: 72, width: 1280, height: 576 } }));

    expect(placement.inset.top).toBeGreaterThan(72);
  });

  it("uses the free scenery above the play rectangle in portrait", () => {
    // Portrait hides the bars, so the whole clip is visible and the top of the
    // screen is free. A HUD that inset itself by the field's top edge there
    // would give up space nothing is using.
    const placement = placementFor(
      viewport({
        portrait: true,
        formFactor: "phone-portrait",
        fieldLogical: { width: 960, height: 720 },
        canvasCss: { x: 0, y: 0, width: 390, height: 844 },
        gameplayCss: { x: 0, y: 300, width: 390, height: 244 },
      }),
    );

    expect(placement.portrait).toBe(true);
    expect(placement.inset.top).toBeLessThan(300);
    expect(placement.frame).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  it("goes compact on a short landscape screen, and not on a tall one", () => {
    // The compact layout exists so four roster rows do not crowd the thumbs on
    // a 844 x 390 phone. A tall screen has room for the full rows.
    const short = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 844, height: 390 }, formFactor: "phone-landscape" }),
    );
    const tall = placementFor(viewport({ canvasCss: { x: 0, y: 0, width: 1280, height: 720 } }));

    expect(short.compact).toBe(true);
    expect(tall.compact).toBe(false);
  });

  it("goes compact on any phone-landscape window, including a short desktop one (D-R2)", () => {
    // Compact follows the form factor, not a height of its own: 490 px is
    // above the old 480 cut-off and below the classifier's 500.
    const placement = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 1280, height: 490 }, formFactor: "phone-landscape" }),
    );

    expect(placement.compact).toBe(true);
  });

  it("collapses the standings on a compact landscape screen only", () => {
    const browser = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 780, height: 270 }, formFactor: "phone-landscape" }),
    );
    const phone = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 844, height: 390 }, formFactor: "phone-landscape" }),
    );
    const portrait = placementFor(
      viewport({ canvasCss: { x: 0, y: 0, width: 360, height: 640 }, portrait: true, formFactor: "phone-portrait" }),
    );
    expect(browser.collapsed).toBe(true);
    expect(phone.collapsed).toBe(false);
    expect(portrait.collapsed).toBe(false);
  });
});

describe("the lap banner", () => {
  it("names the lap the local racer is held for", () => {
    const snapshot = snapshotAt(100, {
      lapCount: 3,
      players: [playerSnapshot({ id: LOCAL_ID, lap: 2, holdUntilTick: 130 })],
    });
    expect(hudModel(snapshot, LOCAL_ID).lapBanner).toBe("LAP 2");
  });

  it("says FINAL LAP for the last ascent", () => {
    const snapshot = snapshotAt(100, {
      lapCount: 3,
      players: [playerSnapshot({ id: LOCAL_ID, lap: 3, holdUntilTick: 130 })],
    });
    expect(hudModel(snapshot, LOCAL_ID).lapBanner).toBe("FINAL LAP");
  });

  it("shows nothing once released, and nothing for another racer's hold", () => {
    const released = snapshotAt(130, { lapCount: 3, players: [playerSnapshot({ id: LOCAL_ID, lap: 2, holdUntilTick: 130 })] });
    expect(hudModel(released, LOCAL_ID).lapBanner).toBeUndefined();
    const other = snapshotAt(100, {
      lapCount: 3,
      players: [playerSnapshot({ id: LOCAL_ID, lap: 1 }), playerSnapshot({ id: REMOTE_ID, lap: 2, holdUntilTick: 130 })],
    });
    expect(hudModel(other, LOCAL_ID).lapBanner).toBeUndefined();
  });
});

describe("another racer's lap pulse", () => {
  const rows = (lap: number) =>
    hudModel(snapshotAt(0, { lapCount: 3, players: [playerSnapshot({ id: LOCAL_ID, lap: 1 }), playerSnapshot({ id: REMOTE_ID, lap })] }), LOCAL_ID).rows;

  it("pulses for 600 ms when another racer's lap goes up", () => {
    const pulses = new LapPulses();
    expect(pulses.observe(rows(1), 0).size).toBe(0);
    expect([...pulses.observe(rows(2), 100)]).toEqual([REMOTE_ID]);
    expect([...pulses.observe(rows(2), 699)]).toEqual([REMOTE_ID]);
    expect(pulses.observe(rows(2), 700).size).toBe(0);
  });

  it("does not pulse on first sight, or for the local racer, who gets the banner", () => {
    const pulses = new LapPulses();
    expect(pulses.observe(rows(3), 0).size).toBe(0);
    const local = hudModel(snapshotAt(0, { lapCount: 3, players: [playerSnapshot({ id: LOCAL_ID, lap: 2 })] }), LOCAL_ID).rows;
    pulses.observe(hudModel(snapshotAt(0, { lapCount: 3, players: [playerSnapshot({ id: LOCAL_ID, lap: 1 })] }), LOCAL_ID).rows, 0);
    expect(pulses.observe(local, 10).size).toBe(0);
  });
});

describe("the Infinite HUD (race-options spec §5.5)", () => {
  const endlessTuning = { ...resolveTuning(), COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
  const endless = (
    tick: number,
    players = [playerSnapshot({ id: LOCAL_ID, y: (540 / 4.2) * 12 + 40, bestFloor: 20, bestFloorAtTick: 900 })],
  ) => snapshotAt(tick, { raceStartedAtTick: 0, floorCount: 60, tuning: endlessTuning, players });

  it("says who leads in the leader's label (audit remediation B2)", () => {
    const model = hudModel(
      endless(0, [playerSnapshot({ id: LOCAL_ID, bestFloor: 10 }), playerSnapshot({ id: REMOTE_ID, name: "Wren", bestFloor: 40 })]),
      LOCAL_ID,
      0,
    );
    expect(model.rows[1]!.label).toBe("2 Wren, best floor 40, leads");
    expect(model.rows[0]!.label).not.toContain("leads");
  });

  it("names the restart by the countdown in Infinite (audit remediation B4)", () => {
    expect(hudModel(endless(0), LOCAL_ID, 61).restart).toBe("Restart, 2:59 left");
  });

  it("counts down from 3:00 against the clock tick it is given", () => {
    expect(hudModel(endless(0), LOCAL_ID, 0).endless?.clock).toBe("3:00");
    expect(hudModel(endless(0), LOCAL_ID, 61).endless?.clock).toBe("2:59");
    expect(hudModel(endless(0), LOCAL_ID, 10_800).endless?.clock).toBe("0:00");
    expect(hudModel(endless(0), LOCAL_ID, 20_000).endless?.clock).toBe("0:00");
  });

  it("reads the clock tick, not the sample's tick", () => {
    expect(hudModel(endless(600), LOCAL_ID, 1_200).endless?.clock).toBe("2:40");
  });

  it("is urgent from 0:10, not before", () => {
    expect(hudModel(endless(0), LOCAL_ID, 10_800 - 601).endless?.urgent).toBe(false);
    expect(hudModel(endless(0), LOCAL_ID, 10_800 - 600).endless?.urgent).toBe(true);
  });

  it("shows the local racer's floor and best", () => {
    expect(hudModel(endless(0), LOCAL_ID, 0).endless).toMatchObject({ floor: 12, best: 20 });
  });

  it("keeps seat order, bars by best floor over the leader's, and marks the leader", () => {
    const model = hudModel(
      endless(0, [playerSnapshot({ id: LOCAL_ID, bestFloor: 10 }), playerSnapshot({ id: REMOTE_ID, name: "Wren", bestFloor: 40 })]),
      LOCAL_ID,
      0,
    );
    expect(model.rows.map((row) => [row.id, row.progress, row.leader])).toEqual([
      [LOCAL_ID, 0.25, false],
      [REMOTE_ID, 1, true],
    ]);
    expect(model.rows[1]!.label).toContain("best floor 40");
  });

  it("marks no leader before anyone has climbed", () => {
    const model = hudModel(endless(0, [playerSnapshot({ id: LOCAL_ID }), playerSnapshot({ id: REMOTE_ID })]), LOCAL_ID, 0);
    expect(model.rows.map((row) => [row.progress, row.leader])).toEqual([[0, false], [0, false]]);
  });

  it("rises to full danger at the edge, and is calm a third of a view above it (survival spec §7)", () => {
    expect(survivalDanger(100, 100, endlessTuning)).toBe(1);
    expect(survivalDanger(90, 100, endlessTuning)).toBe(1);
    expect(survivalDanger(100 + 0.35 * 540, 100, endlessTuning)).toBe(0);
    const half = survivalDanger(100 + 0.175 * 540, 100, endlessTuning);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it("reads the local racer's danger, and none once they are out", () => {
    const near = playerSnapshot({ id: LOCAL_ID, y: 110, floorEdgeY: 100 });
    expect(hudModel(endless(0, [near]), LOCAL_ID, 0).danger).toBeGreaterThan(0.9);
    const out = playerSnapshot({ id: LOCAL_ID, y: 90, floorEdgeY: 100, outAtTick: 400, finishedAtTick: 400 });
    expect(hudModel(endless(0, [out]), LOCAL_ID, 0).danger).toBe(0);
  });

  it("calls OUT for an out local racer, and marks every out row", () => {
    const model = hudModel(
      endless(0, [
        playerSnapshot({ id: LOCAL_ID, outAtTick: 400, finishedAtTick: 400 }),
        playerSnapshot({ id: REMOTE_ID, name: "Wren" }),
      ]),
      LOCAL_ID,
      0,
    );
    expect(model.outBanner).toBe("OUT!");
    expect(model.rows.map((row) => row.out)).toEqual([true, false]);
    expect(model.rows[0]!.label).toContain("Out");
    expect(hudModel(endless(0), LOCAL_ID, 0).outBanner).toBeUndefined();
  });

  it("has no clock, and no leader, in a finite race", () => {
    const model = hudModel(snapshotAt(0, { raceStartedAtTick: 0 }), LOCAL_ID);
    expect(model.endless).toBeUndefined();
    expect(model.rows.every((row) => !row.leader)).toBe(true);
    expect(model.danger).toBe(0);
  });
});

describe("a racer who has not started, and why a racer is out (first-race spec parts 2 and 3)", () => {
  // A Survival race is an endless course, and a 20-floor race is not; the same
  // racer, in either, may be waiting for a first input.
  const survival = (local: Parameters<typeof playerSnapshot>[0] = {}) =>
    snapshotAt(300, {
      raceStartedAtTick: 0,
      floorCount: 60,
      tuning: { ...resolveTuning(), COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 },
      players: [playerSnapshot({ id: LOCAL_ID, ...local })],
    });
  const finite = (local: Parameters<typeof playerSnapshot>[0] = {}) =>
    snapshotAt(300, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, ...local })] });

  it("says she has not started while her Survival racer waits for a first input", () => {
    expect(hudModel(survival({ awaitingInput: true }), LOCAL_ID).awaitingStart).toBe(true);
  });

  it.each([
    ["she has pressed", survival({ awaitingInput: false })],
    ["she is out", survival({ awaitingInput: true, outAtTick: 790 })],
    ["the race is a 20-floor climb", finite({ awaitingInput: true })],
    ["the countdown is still running", { ...survival({ awaitingInput: true }), phase: "countdown" as const }],
    ["she dropped", survival({ awaitingInput: true, status: "ghost" })],
  ])("does not when %s", (_why, snapshot) => {
    expect(hudModel(snapshot, LOCAL_ID).awaitingStart).toBe(false);
  });

  it("does not for a watcher with no seat", () => {
    expect(hudModel(survival({ awaitingInput: true })).awaitingStart).toBe(false);
  });

  it("says why she is out, with OUT!", () => {
    const model = hudModel(survival({ outAtTick: 790 }), LOCAL_ID);
    expect(model.outBanner).toBe(m.race_out());
    expect(model.outLine).toBe(m.race_out_line());
    expect(hudModel(survival({}), LOCAL_ID).outLine).toBeUndefined();
  });
});

describe("the standings summary", () => {
  const rowsAt = (progress: number[]) =>
    hudModel(
      snapshotAt(300, {
        raceStartedAtTick: 0,
        floorCount: 20,
        players: progress.map((value, seat) =>
          playerSnapshot({
            id: seat === 0 ? LOCAL_ID : asPlayerId(`p${seat + 1}`),
            name: ["Wolfgang-Amadeus", "Sable", "Wren", "Koi"][seat]!,
            progress: value,
          }),
        ),
      }),
      LOCAL_ID,
    ).rows;

  it("says the place in words a player reads", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
  });

  it("places the local racer by authority's progress and names the leader", () => {
    const summary = standingsSummary(rowsAt([0.3, 0.6, 0.1, 0.2]), LOCAL_ID);
    expect(summary).toEqual({ place: 2, count: 4, leader: "Sable", selfLeads: false });
    expect(standingsPillText(summary)).toBe("2nd / 4 · Sable leads");
  });

  it("drops the leader's name when you are leading", () => {
    const summary = standingsSummary(rowsAt([0.9, 0.6, 0.1, 0.2]), LOCAL_ID);
    expect(summary.selfLeads).toBe(true);
    expect(standingsPillText(summary)).toBe("1st / 4");
  });

  it("shares a place on a tie rather than inventing an order", () => {
    const summary = standingsSummary(rowsAt([0.5, 0.5, 0.1, 0.2]), LOCAL_ID);
    expect(summary.place).toBe(1);
    expect(summary.selfLeads).toBe(true);
  });

  it("says first of one for a racer alone", () => {
    const summary = standingsSummary(rowsAt([0.4]), LOCAL_ID);
    expect(summary).toMatchObject({ place: 1, count: 1, selfLeads: true });
    expect(standingsPillText(summary)).toBe("1st / 1");
  });

  it("leaves the rows in seat order", () => {
    const rows = rowsAt([0.1, 0.9, 0.5, 0.2]);
    standingsSummary(rows, LOCAL_ID);
    expect(rows.map((row) => row.seat)).toEqual([0, 1, 2, 3]);
  });
});
