import { describe, expect, it } from "vitest";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { applyLocale, installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { RaceAnnouncer } from "../../../../apps/client/src/features/race/race-announcer";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const players = (remote: Partial<Parameters<typeof playerSnapshot>[0]> = {}) => [
  playerSnapshot({ id: LOCAL_ID, name: "Kite" }),
  playerSnapshot({ id: REMOTE_ID, name: "Wren", ...remote }),
];
const finish: RaceEvent = { id: "900:raceFinished:p2:3", tick: 900, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent;
const lap: RaceEvent = { id: "400:lapCompleted:p2:1", tick: 400, type: "lapCompleted", playerId: REMOTE_ID, lap: 1 } as RaceEvent;

describe("the race announcer", () => {
  it("says Go once, as the countdown becomes the race", () => {
    const announcer = new RaceAnnouncer();
    expect(announcer.observe(snapshotAt(10, { phase: "countdown", countdownEndsAtTick: 180, players: players() }))).toEqual([]);
    expect(announcer.observe(snapshotAt(180, { phase: "racing", players: players() }))).toEqual(["Go"]);
    expect(announcer.observe(snapshotAt(183, { phase: "racing", players: players() }))).toEqual([]);
  });

  it("says nothing on joining a race already running", () => {
    expect(new RaceAnnouncer().observe(snapshotAt(500, { phase: "racing", players: players() }))).toEqual([]);
  });

  it("says each racer's lap, of the total", () => {
    const announcer = new RaceAnnouncer();
    announcer.observe(snapshotAt(399, { phase: "racing", lapCount: 3, players: players() }));
    expect(announcer.observe(snapshotAt(400, { phase: "racing", lapCount: 3, players: players(), events: [lap] }))).toEqual([
      "Wren completed lap 1 of 3",
    ]);
  });

  it("says a finish exactly once, and a replayed batch says nothing", () => {
    const announcer = new RaceAnnouncer();
    announcer.observe(snapshotAt(899, { phase: "racing", players: players() }));
    const finished = snapshotAt(900, { phase: "finished", winnerId: REMOTE_ID, players: players(), events: [finish] });
    expect(announcer.observe(finished)).toEqual(["Wren finished first"]);
    expect(announcer.observe(finished)).toEqual([]);
  });

  it("says when a racer did not start, once", () => {
    const announcer = new RaceAnnouncer();
    announcer.observe(snapshotAt(10, { phase: "racing", players: players() }));
    expect(announcer.observe(snapshotAt(13, { phase: "racing", players: players({ status: "dns" }) }))).toEqual(["Wren did not start"]);
    expect(announcer.observe(snapshotAt(16, { phase: "racing", players: players({ status: "dns" }) }))).toEqual([]);
  });

  it("does not say a racer who went out did not start when they leave afterwards (survival spec §4)", () => {
    const announcer = new RaceAnnouncer();
    announcer.observe(snapshotAt(10, { phase: "racing", players: players({ outAtTick: 8, finishedAtTick: 8 }) }));
    expect(announcer.observe(snapshotAt(13, { phase: "racing", players: players({ status: "dns", outAtTick: 8, finishedAtTick: 8 }) }))).toEqual([]);
  });

  it("never announces the timer, floors, progress or the count", () => {
    const announcer = new RaceAnnouncer();
    const said: string[] = [];
    for (let tick = 0; tick < 60; tick += 1) {
      said.push(...announcer.observe(snapshotAt(tick, { phase: "countdown", countdownEndsAtTick: 180, players: players() })));
    }
    for (let tick = 200; tick < 260; tick += 1) {
      said.push(...announcer.observe(snapshotAt(tick, { phase: "racing", players: players({ progress: tick / 1000 }) })));
    }
    expect(said).toEqual(["Go"]);
  });

  it("speaks the locale active when a line happens, and repeats nothing across a switch (languages plan, review focus 1)", async () => {
    const settings = new SettingsStore(memoryStorage());
    const undo = installLocaleStrategy(settings, () => ["en"]);
    try {
      const announcer = new RaceAnnouncer();
      announcer.observe(snapshotAt(10, { phase: "countdown", countdownEndsAtTick: 180, lapCount: 3, players: players() }));
      expect(announcer.observe(snapshotAt(180, { phase: "racing", lapCount: 3, players: players() }))).toEqual([m.race_go()]);
      await applyLocale("es-419");
      expect(announcer.observe(snapshotAt(181, { phase: "racing", lapCount: 3, players: players() }))).toEqual([]);
      expect(announcer.observe(snapshotAt(400, { phase: "racing", lapCount: 3, players: players(), events: [lap] }))).toEqual([
        m.race_lap_completed({ name: "Wren", lap: 1, laps: 3 }, { locale: "es-419" }),
      ]);
    } finally {
      undo();
    }
  });

  it("says Time once when an Infinite race ends, then the winner (race-options spec §5.5)", () => {
    const announcer = new RaceAnnouncer();
    const tuning = { ...resolveTuning(), RACE_TIME_LIMIT_TICKS: 600 };
    const time: RaceEvent = { id: "600:raceFinished:p2:time", tick: 600, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent;
    announcer.observe(snapshotAt(599, { phase: "racing", raceStartedAtTick: 0, tuning, players: players() }));
    const atLimit = players().map((player) => ({ ...player, finishedAtTick: 600 }));
    const ended = snapshotAt(600, { phase: "finished", raceStartedAtTick: 0, tuning, winnerId: REMOTE_ID, players: atLimit, events: [time] });
    expect(announcer.observe(ended)).toEqual(["Time", "Wren finished first"]);
    expect(announcer.observe(snapshotAt(601, { phase: "finished", raceStartedAtTick: 0, tuning, players: players() }))).toEqual([]);
  });

  it("does not say Time when a Survival race ends on its last one standing, before the clock (survival spec §4)", () => {
    const announcer = new RaceAnnouncer();
    const tuning = { ...resolveTuning(), RACE_TIME_LIMIT_TICKS: 600 };
    const last: RaceEvent = { id: "300:raceFinished:p2:survival", tick: 300, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent;
    announcer.observe(snapshotAt(299, { phase: "racing", raceStartedAtTick: 0, tuning, players: players() }));
    const ended = snapshotAt(300, { phase: "finished", raceStartedAtTick: 0, tuning, winnerId: REMOTE_ID, players: players(), events: [last] });
    expect(announcer.observe(ended)).toEqual(["Wren finished first"]);
  });

  it("reads the finish, not the update's tick: a last-one-standing win just before the clock, seen after it, is not Time", () => {
    const announcer = new RaceAnnouncer();
    const tuning = { ...resolveTuning(), RACE_TIME_LIMIT_TICKS: 600 };
    const last: RaceEvent = { id: "598:raceFinished:p2:survival", tick: 598, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent;
    announcer.observe(snapshotAt(597, { phase: "racing", raceStartedAtTick: 0, tuning, players: players() }));
    const [kite, wren] = players();
    const ended = snapshotAt(601, {
      phase: "finished",
      raceStartedAtTick: 0,
      tuning,
      winnerId: REMOTE_ID,
      players: [{ ...kite!, outAtTick: 598, finishedAtTick: 598 }, { ...wren!, finishedAtTick: 598 }],
      events: [last],
    });
    expect(announcer.observe(ended)).toEqual(["Wren finished first"]);
  });

  it("says Time when the clock ends it, read from the survivors' finish", () => {
    const announcer = new RaceAnnouncer();
    const tuning = { ...resolveTuning(), RACE_TIME_LIMIT_TICKS: 600 };
    announcer.observe(snapshotAt(597, { phase: "racing", raceStartedAtTick: 0, tuning, players: players() }));
    const [kite, wren] = players();
    const ended = snapshotAt(603, {
      phase: "finished",
      raceStartedAtTick: 0,
      tuning,
      winnerId: REMOTE_ID,
      players: [{ ...kite!, finishedAtTick: 600 }, { ...wren!, finishedAtTick: 600 }],
    });
    expect(announcer.observe(ended)).toEqual(["Time"]);
  });

  it("says who went out in Survival, once (survival spec §7)", () => {
    const announcer = new RaceAnnouncer();
    const out: RaceEvent = { id: "300:playerOut:p2:edge", tick: 300, type: "playerOut", playerId: REMOTE_ID } as RaceEvent;
    const racing = snapshotAt(300, { phase: "racing", players: players(), events: [out] });
    expect(announcer.observe(racing)).toEqual(["Wren is out"]);
    expect(announcer.observe(racing)).toEqual([]);
  });

  it("tells the local racer why she is out, once, and names the others", () => {
    const announcer = new RaceAnnouncer(LOCAL_ID);
    const out = (id: typeof LOCAL_ID): RaceEvent => ({ id: `300:playerOut:${id}:edge`, tick: 300, type: "playerOut", playerId: id } as RaceEvent);
    const said = (event: RaceEvent) => announcer.observe(snapshotAt(300, { phase: "racing", players: players(), events: [event] }));
    expect(said(out(LOCAL_ID))).toEqual([m.race_out_line()]);
    expect(said(out(REMOTE_ID))).toEqual([m.race_player_out({ name: "Wren" })]);
  });

  it("names every racer when it has no local seat, as on a replay", () => {
    const out: RaceEvent = { id: "300:playerOut:p1:edge", tick: 300, type: "playerOut", playerId: LOCAL_ID } as RaceEvent;
    expect(new RaceAnnouncer().observe(snapshotAt(300, { phase: "racing", players: players(), events: [out] }))).toEqual([
      m.race_player_out({ name: "Kite" }),
    ]);
  });

  it("follows a seat that is only known later, as after a reload", () => {
    let seat: typeof LOCAL_ID | undefined;
    const announcer = new RaceAnnouncer(() => seat);
    seat = LOCAL_ID;
    const out: RaceEvent = { id: "300:playerOut:p1:edge", tick: 300, type: "playerOut", playerId: LOCAL_ID } as RaceEvent;
    expect(announcer.observe(snapshotAt(300, { phase: "racing", players: players(), events: [out] }))).toEqual([m.race_out_line()]);
  });

  it("does not say Time when a finite race ends", () => {
    const announcer = new RaceAnnouncer();
    announcer.observe(snapshotAt(899, { phase: "racing", players: players() }));
    const finished = snapshotAt(900, { phase: "finished", winnerId: REMOTE_ID, players: players(), events: [finish] });
    expect(announcer.observe(finished)).not.toContain("Time");
  });
});
