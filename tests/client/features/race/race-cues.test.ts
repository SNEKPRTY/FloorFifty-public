/**
 * Race events, heard: which sounds each one makes, and that every layer of one
 * event is still heard once however often the event arrives.
 */

import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { asContentId, type StageContent } from "@floor-fifty/shared/content/game-content";
import { SIZZLE_CUE, SIZZLE_GAIN } from "../../../../apps/client/src/features/race/race-cues";
import {
  bedForStage,
  clashCueFor,
  CLIMB_DRONE,
  CLIMB_DRONE_ENDLESS_TICKS,
  climbDrone,
  countdownCues,
  FastFallWhoosh,
  cuesForEvents,
  landingCueFor,
  landingRateFor,
  landingSounds,
  ladderHeight,
  panFor,
  distanceFor,
  FAR_FLOORS,
  RIVAL_LANDING_SHARE,
  BOUNCE_GAIN,
  juiceSound,
  LANDING_GAIN,
  SLAM_GAIN,
} from "../../../../apps/client/src/features/race/race-cues";
// Static, not `await import(...)` inside a test: the HUD and the gameplay
// screen pull in the compiled catalogues and every fake, which runs to seconds
// cold on a busy runner and would be charged to that test's own budget.
import { RaceHudView } from "../../../../apps/client/src/features/race/race-hud.svelte";
import { shippedContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const eid = (id: string) => id as RaceEvent["id"];
const me = "p-me" as PlayerId;
const them = "p-them" as PlayerId;
const room = { players: [{ id: them, colour: "scarlet" as const }, { id: me, colour: "cyan" as const }], lapCount: 3 };

const aliases = (events: RaceEvent[], local: PlayerId | undefined = me) =>
  cuesForEvents(events, local, room).map((cue) => cue.alias);

describe("race events", () => {
  it("rings a fall off the bottom and rewinds a manual reset, over the same cost cue", () => {
    expect(aliases([{ id: eid("r1"), tick: 1, type: "playerReset", playerId: me, reason: "fall" }])).toEqual([
      "sfx.reset",
      "sfx.fallOff",
    ]);
    expect(aliases([{ id: eid("r2"), tick: 1, type: "playerReset", playerId: me, reason: "manual" }])).toEqual([
      "sfx.reset",
      "sfx.rewind",
    ]);
  });

  it("rings the fall off the bottom when the racer goes out in Survival, and only for them", () => {
    expect(aliases([{ id: eid("o1"), tick: 1, type: "playerOut", playerId: me }])).toEqual(["sfx.reset", "sfx.fallOff"]);
    expect(aliases([{ id: eid("o2"), tick: 1, type: "playerOut", playerId: them }])).toEqual([]);
  });

  it("leaves another racer's resets and laps silent", () => {
    expect(aliases([{ id: eid("r3"), tick: 1, type: "playerReset", playerId: them, reason: "fall" }])).toEqual([]);
    expect(aliases([{ id: eid("l0"), tick: 1, type: "lapCompleted", playerId: them, lap: 2 }])).toEqual([]);
  });

  it("clashes on a lap, and calls the final ascent when only one is left", () => {
    expect(aliases([{ id: eid("l1"), tick: 1, type: "lapCompleted", playerId: me, lap: 1 }])).toEqual([
      "sfx.lap",
      "sfx.lapClash",
    ]);
    expect(aliases([{ id: eid("l2"), tick: 1, type: "lapCompleted", playerId: me, lap: 2 }])).toEqual([
      "sfx.lap",
      "sfx.lapClash",
      "vo.finalAscent",
    ]);
  });

  it("ends the race like a match: the fanfare, the crowd, GAME, and the winner's name", () => {
    const cues = cuesForEvents([{ id: eid("f1"), tick: 1, type: "raceFinished", winnerId: me }], them, room);
    expect(cues.map((cue) => cue.alias)).toEqual([
      "sfx.finish",
      "sfx.crowdCheer",
      "vo.game",
      "vo.winnerIs",
      // Second seat: cyan.
      "vo.blue",
    ]);
    const at = (alias: string): number => cues.find((cue) => cue.alias === alias)!.delayMs ?? 0;
    expect(at("vo.game")).toBeLessThan(at("vo.winnerIs"));
    expect(at("vo.winnerIs")).toBeLessThan(at("vo.blue"));
    expect(cues.filter((cue) => cue.alias.startsWith("vo.")).every((cue) => cue.bus === "voice")).toBe(true);
  });

  it("calls the winner by their own colour, not their seat", () => {
    const recoloured = { players: [{ id: them, colour: "scarlet" as const }, { id: me, colour: "violet" as const }], lapCount: 3 };
    const cues = cuesForEvents([{ id: eid("f9"), tick: 1, type: "raceFinished", winnerId: me }], them, recoloured);
    expect(cues.map((cue) => cue.alias)).toContain("vo.purple");
  });

  it("calls GAME without a name when the winner has no seat", () => {
    const cues = aliases([{ id: eid("f2"), tick: 1, type: "raceFinished", winnerId: "p-gone" as PlayerId }]);
    expect(cues).toContain("vo.game");
    expect(cues).not.toContain("vo.winnerIs");
  });

  it("gives every layer of one event its own identity, so each is heard once and none is lost", () => {
    const cues = cuesForEvents([{ id: eid("f3"), tick: 1, type: "raceFinished", winnerId: me }], me, room);
    const ids = cues.map((cue) => cue.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("f3"))).toBe(true);
  });
});

describe("landings", () => {
  it("pairs each drafted landing with a clash of the same register", () => {
    expect([0, 1, 2, 3].map(landingCueFor)).toEqual(["sfx.landLow", "sfx.landMid", "sfx.landHigh", "sfx.landLow"]);
    expect([0, 1, 2, 3].map(clashCueFor)).toEqual(["sfx.clashLow", "sfx.clashMid", "sfx.clashHigh", "sfx.clashLow"]);
  });
});

describe("the countdown", () => {
  it("calls three, two, one and CLIMB a second apart, landing CLIMB on the start", () => {
    const cues = countdownCues("room:600", 3_000);
    const voice = cues.filter((cue) => cue.bus === "voice");
    expect(voice.map((cue) => [cue.alias, cue.delayMs])).toEqual([
      ["vo.three", 0],
      ["vo.two", 1_000],
      ["vo.one", 2_000],
      ["vo.climb", 3_000],
    ]);
    expect(cues.filter((cue) => cue.delayMs === 3_000).map((cue) => cue.alias)).toEqual(
      expect.arrayContaining(["sfx.countdownGo", "sfx.unsheath", "vo.climb"]),
    );
  });

  it("drops the numbers already past when joined late, and keeps CLIMB on time", () => {
    const cues = countdownCues("room:600", 1_400);
    expect(cues.filter((cue) => cue.bus === "voice").map((cue) => [cue.alias, cue.delayMs])).toEqual([
      ["vo.one", 400],
      ["vo.climb", 1_400],
    ]);
  });

  it("still calls three when the count was first seen a few frames after it began", () => {
    const cues = countdownCues("room:600", 2_950);
    expect(cues.filter((cue) => cue.bus === "voice").map((cue) => [cue.alias, cue.delayMs])).toEqual([
      ["vo.three", 0],
      ["vo.two", 950],
      ["vo.one", 1_950],
      ["vo.climb", 2_950],
    ]);
  });

  it("names every cue after the countdown it belongs to, so a replayed snapshot calls it once", () => {
    const ids = countdownCues("room:600", 3_000).map((cue) => cue.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("room:600"))).toBe(true);
  });
});

describe("the fast-fall whoosh", () => {
  it("sounds on the press, not while held, and not twice inside its repeat gap", () => {
    let now = 0;
    let played = 0;
    const whoosh = new FastFallWhoosh(() => (played += 1), () => now);
    const press = (fastFall: boolean, at: number) => {
      now = at;
      whoosh.observe({ fastFall });
    };
    press(true, 0);
    press(true, 16);
    press(true, 32);
    expect(played).toBe(1);
    press(false, 48);
    press(true, 64); // hammered inside the gap
    expect(played).toBe(1);
    press(false, 300);
    press(true, 316);
    expect(played).toBe(2);
  });
});

const stage = (ambienceAlias?: string): StageContent => ({
  id: asContentId("snow-shrine"),
  displayName: "Snow Shrine",
  platformAlias: "world.platform",
  courseTuning: {},
  theme: {
    backdropAlias: "menu.backdrop",
    layers: [{ alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" }],
    ambienceAlias,
  },
});

describe("the bed under a stage", () => {
  it("is the one the stage names", () => {
    expect(bedForStage(stage("ambience.snowShrine"))).toBe("ambience.snowShrine");
  });
  it("is Rooftops' where the stage names none, or there is no stage", () => {
    expect(bedForStage(stage())).toBe("ambience.rooftop");
    expect(bedForStage(undefined)).toBe("ambience.rooftop");
  });
});

describe("the landing ladder", () => {
  const semitones = (rate: number): number => Math.round(12 * Math.log2(rate) * 1000) / 1000;

  it("plays the first floor as drafted and the top floor an octave up", () => {
    for (const index of [0, 1, 2]) expect(landingRateFor(index, 50)).toBe(1);
    expect(semitones(landingRateFor(49, 50))).toBe(12);
  });

  it("only ever rises with height", () => {
    // Per variant, since the three variants are already a figure of their own.
    for (const variant of [0, 1, 2]) {
      let previous = 0;
      for (let index = variant; index < 50; index += 3) {
        const rate = landingRateFor(index, 50);
        expect(rate).toBeGreaterThanOrEqual(previous);
        previous = rate;
      }
    }
  });

  it("stays in the drafted scale on every floor", () => {
    // Minor pentatonic: every shifted note is a whole number of semitones,
    // and lands on a degree of the scale above the variant's own note.
    const drafted = [0, 5, 10];
    const scale = new Set([0, 3, 5, 7, 10]);
    for (let index = 0; index < 50; index += 1) {
      const note = drafted[index % 3]! + semitones(landingRateFor(index, 50));
      expect(Number.isInteger(note)).toBe(true);
      expect(scale.has(note % 12)).toBe(true);
    }
  });

  it("drops back with the racer, because it reads the floor rather than a count", () => {
    expect(landingRateFor(3, 50)).toBe(landingRateFor(3, 50));
    expect(landingRateFor(3, 50)).toBeLessThan(landingRateFor(48, 50));
  });

  it("plays as drafted when the course height is unknown", () => {
    expect(landingRateFor(30, undefined)).toBe(1);
  });
});

describe("placing a racer between the speakers", () => {
  it("centres the middle of the course and leans toward a wall, short of it", () => {
    expect(panFor(0, 400)).toBe(0);
    expect(panFor(-400, 400)).toBeLessThan(-0.3);
    expect(panFor(400, 400)).toBeGreaterThan(0.3);
    expect(Math.abs(panFor(9_000, 400))).toBeLessThan(1);
    expect(panFor(undefined, 400)).toBe(0);
  });
});

describe("placing a racer above or below", () => {
  it("is near on the player's own floor and full distance FAR_FLOORS away, either way", () => {
    expect(distanceFor(100, 100, 50)).toBe(0);
    expect(distanceFor(100 + 50 * FAR_FLOORS, 100, 50)).toBe(1);
    expect(distanceFor(100 - 50 * FAR_FLOORS * 3, 100, 50)).toBe(1);
    expect(distanceFor(100 - 50 * (FAR_FLOORS / 2), 100, 50)).toBeCloseTo(0.5, 6);
  });

  it("is near when either height or the floor's gap is unknown", () => {
    expect(distanceFor(undefined, 100, 50)).toBe(0);
    expect(distanceFor(100, undefined, 50)).toBe(0);
    expect(distanceFor(100, 900, undefined)).toBe(0);
  });

  it("places a rival's landing by how far below the player they are", () => {
    const placed = {
      ...room,
      floorCount: 50,
      floorGap: 50,
      players: [{ id: them, colour: "scarlet" as const, x: 0, y: 0 }, { id: me, colour: "cyan" as const, x: 0, y: 50 * FAR_FLOORS }],
    };
    const [rival] = cuesForEvents([{ id: eid("d1"), tick: 1, type: "floorLanded", playerId: them, floorId: "floor-0", floorIndex: 0 }], me, placed);
    expect(rival!.distance).toBe(1);
  });

  it("places a rival's bounce too", () => {
    expect(juiceSound("bounce", { rival: true, floorIndex: 3, floorCount: 50, distance: 0.4 })?.distance).toBe(0.4);
    expect(juiceSound("bounce", { rival: false, floorIndex: 3, floorCount: 50 })?.distance).toBeUndefined();
  });
});

describe("landing sounds", () => {
  it("pitches the thump and the blade together, and varies them", () => {
    const sounds = landingSounds(49, { floorCount: 50, pan: -0.2 });
    expect(sounds.map((sound) => sound.alias)).toEqual([landingCueFor(49), clashCueFor(49)]);
    for (const sound of sounds) {
      expect(sound.rate).toBeCloseTo(2, 5);
      expect(sound.vary).toBe(true);
      expect(sound.pan).toBe(-0.2);
    }
  });

  it("hears a rival's landing quietly, from where they are, and never the player's own", () => {
    const placed = { ...room, floorCount: 50, halfWidth: 400, players: [{ id: them, colour: "scarlet" as const, x: -400 }, { id: me, colour: "cyan" as const, x: 0 }] };
    const rival = cuesForEvents([{ id: eid("a1"), tick: 1, type: "floorLanded", playerId: them, floorId: "floor-4", floorIndex: 4 }], me, placed);
    expect(rival.map((cue) => cue.alias)).toEqual([landingCueFor(4)]);
    expect(rival[0]!.gain).toBeLessThan(landingSounds(4, {})[0]!.gain! * RIVAL_LANDING_SHARE + 1e-9);
    expect(rival[0]!.pan).toBeLessThan(0);
    expect(rival[0]!.eventId).toBe(`a1/${landingCueFor(4)}`);

    const own = cuesForEvents([{ id: eid("a2"), tick: 1, type: "floorLanded", playerId: me, floorId: "floor-4", floorIndex: 4 }], me, placed);
    expect(own).toEqual([]);
  });
});

describe("the music under the moments", () => {
  const cue = (events: RaceEvent[], alias: string, local: PlayerId = me) =>
    cuesForEvents(events, local, room).find((entry) => entry.alias === alias)!;

  it("dips under a lap and a reset", () => {
    expect(cue([{ id: eid("d1"), tick: 1, type: "lapCompleted", playerId: me, lap: 2 }], "sfx.lap").duck!.level).toBeLessThan(1);
    expect(cue([{ id: eid("d2"), tick: 1, type: "playerReset", playerId: me, reason: "manual" }], "sfx.reset").duck!.level).toBeLessThan(1);
  });

  it("leaves the announcer's lines to the voice bus's own duck (polish spec §8.3)", () => {
    const final = cue([{ id: eid("d1"), tick: 1, type: "lapCompleted", playerId: me, lap: 2 }], "vo.finalAscent");
    const lines = [final, ...countdownCues("c", 3_000).filter((entry) => entry.bus === "voice")];
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.bus).toBe("voice");
      expect(line.duck).toBeUndefined();
    }
  });

  it("goes silent for the finish's fanfare, then comes back", () => {
    const fanfare = cue([{ id: eid("d3"), tick: 1, type: "raceFinished", winnerId: me }], "sfx.finish", them);
    expect(fanfare.duck!.level).toBe(0);
    expect(fanfare.duck!.holdMs).toBeGreaterThan(200);
    expect(fanfare.duck!.holdMs).toBeLessThan(800);
  });

  it("muffles the music on a fall, and not on a reset the player chose", () => {
    expect(cue([{ id: eid("d4"), tick: 1, type: "playerReset", playerId: me, reason: "fall" }], "sfx.fallOff").muffle).toBe(true);
    expect(cue([{ id: eid("d5"), tick: 1, type: "playerReset", playerId: me, reason: "manual" }], "sfx.rewind").muffle).toBeUndefined();
  });
});

describe("the drone under Infinite's last stretch (audit remediation D-R1)", () => {
  const at = (ticksLeft: number) => climbDrone({}, { ticksLeft });

  it("is silent in a finite race, however high the racer", () => {
    expect(climbDrone({ lap: 3, progress: 1 }).level).toBe(0);
  });

  it("is silent with more than the stretch left", () => {
    expect(at(CLIMB_DRONE_ENDLESS_TICKS + 1).level).toBe(0);
    expect(at(10_000).level).toBe(0);
  });

  it("comes in at the stretch, swells, and bends up toward 0:00", () => {
    expect(at(CLIMB_DRONE_ENDLESS_TICKS).level).toBeCloseTo(CLIMB_DRONE.floor);
    expect(at(CLIMB_DRONE_ENDLESS_TICKS).rate).toBe(1);
    expect(at(CLIMB_DRONE_ENDLESS_TICKS / 2).level).toBeGreaterThan(at(CLIMB_DRONE_ENDLESS_TICKS - 60).level);
    expect(at(1).level).toBe(1);
    expect(at(1).rate).toBeGreaterThan(at(CLIMB_DRONE_ENDLESS_TICKS / 2).rate);
    expect(at(0).rate).toBeCloseTo(2 ** (CLIMB_DRONE.riseCents / 1200));
  });

  it("is silent without a racer", () => {
    expect(climbDrone(undefined, { ticksLeft: 60 }).level).toBe(0);
  });
});

describe("the landing ladder's height (race-options spec §5.5)", () => {
  it("is the course's height on a finite course", () => {
    expect(ladderHeight({ floorCount: 50, tuning: { COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 0 } as never })).toBe(50);
  });

  it("is the starting height on an endless course, however tall it has grown", () => {
    expect(ladderHeight({ floorCount: 137, tuning: { COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 } as never })).toBe(50);
  });
});

describe("the juice's sounds (Wonder spec §3.2)", () => {
  it("plays a slam at one and a half landings, never at full gain", () => {
    expect(SLAM_GAIN).toBeCloseTo(LANDING_GAIN * 1.5, 6);
    expect(juiceSound("slam", { rival: false, floorIndex: 3, floorCount: 50 })).toMatchObject({ alias: "sfx.slam", bus: "effects", gain: SLAM_GAIN });
  });

  it("gives a rival no slam and no wrap, only a quiet bounce", () => {
    expect(juiceSound("slam", { rival: true, floorIndex: 3, floorCount: 50 })).toBeUndefined();
    expect(juiceSound("wrap", { rival: true, floorIndex: 3, floorCount: 50 })).toBeUndefined();
    expect(juiceSound("bounce", { rival: true, floorIndex: 3, floorCount: 50 })?.gain).toBeCloseTo(BOUNCE_GAIN * RIVAL_LANDING_SHARE, 6);
  });

  it("pitches a bounce with its floor's landing, and varies it", () => {
    const sound = juiceSound("bounce", { rival: false, floorIndex: 49, floorCount: 50 })!;
    expect(sound).toMatchObject({ alias: "sfx.bounce", gain: BOUNCE_GAIN, vary: true });
    expect(sound.rate).toBeCloseTo(landingRateFor(49, 50), 6);
  });
});

describe("the lava's sizzle (lava spec §5)", () => {
  it("is the drafted sizzle, under the landings' level", () => {
    expect(SIZZLE_CUE).toBe("sfx.sizzle");
    expect(SIZZLE_GAIN).toBeGreaterThan(0);
    expect(SIZZLE_GAIN).toBeLessThan(0.5);
  });
});

it("shows a recovery explanation while the missed floor remains below, and clears it after descent", async () => {
  const stage = fakeStage();
  const hud = new RaceHudView(stage);
  try {
    hud.setRecoveryHint(true);
    flushSync();
    expect(stage.overlay.querySelector('[data-testid="missed-floor-help"]')?.textContent).toMatch(/drop back to collect/i);
    hud.setRecoveryHint(false);
    flushSync();
    // The reminder falls out first, so it is a beat before it is gone.
    await vi.waitFor(() => expect(stage.overlay.querySelector('[data-testid="missed-floor-help"]')).toBeNull());
  } finally { hud.destroy(); }
});

it("does not rearm a missed-floor cue when render frames repeat the same reset event, and rearms for a new round", async () => {
  const game = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
  try {
    const sample = snapshotAt(24, {
      phase: "racing", players: [playerSnapshot({ id: LOCAL_ID, y: 1000 })],
      platforms: [{ id: "miss", x: 0, y: 0, direction: 1, collectedBy: [] }],
      events: [{ id: "reset-24", tick: 24, type: "playerReset", playerId: LOCAL_ID, reason: "manual" } as RaceEvent],
    });
    game.network.emitSnapshot(sample);
    game.screen.draw(1000 / 60);
    const scene = game.screen["scene"]!;
    game.audio.calls.length = 0;
    // A new ascent warns once; redrawing that same authoritative event must not rearm it.
    for (let frame = 0; frame < 20; frame++) scene.draw({ ...sample, round: 2 }, 1000 / 144);
    expect(game.audio.calls.filter((call) => call.startsWith("cue:sfx.floorMissed:"))).toHaveLength(1);
    scene.draw({ ...sample, round: 3 }, 1000 / 144);
    expect(game.audio.calls.filter((call) => call.startsWith("cue:sfx.floorMissed:"))).toHaveLength(2);
  } finally { game.screen.exit(); }
});
