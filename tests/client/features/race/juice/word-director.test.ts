import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { describe, expect, it } from "vitest";
import type { JuiceMoment } from "../../../../../apps/client/src/features/race/juice/motion-watch";
import { WordDirector, placeIn, racePlace, type WordInput } from "../../../../../apps/client/src/features/race/juice/word-director";
import { STAMP_GAIN, STREAK_GAIN, WHOOPS_GAIN, WORD_POP_GAIN } from "../../../../../apps/client/src/features/race/race-cues";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";

const WORDS = GENERATED_CONTENT.content.juice.words;
const id = (value: string) => value as PlayerId;

const base: WordInput = {
  nowMs: 0,
  tick: 0,
  localId: id("p1"),
  juice: { moments: [], reached: [], localSlammed: false },
  localPlace: 2,
  localStatus: "racing",
  localLap: 1,
  lapCount: 1,
  localFloors: 0,
  goalFloors: 20,
};
const slam = (player: string, tick: number): JuiceMoment => ({
  kind: "slam",
  playerId: id(player),
  x: 0,
  y: 0,
  fromX: 0,
  key: `${player}:slam:${tick}`,
});
const landed = (player: string, tick: number, floorIndex: number) =>
  ({ id: `${tick}:floorLanded:${player}:${floorIndex}`, tick, type: "floorLanded", playerId: player, floorId: `f${floorIndex}`, floorIndex }) as RaceEvent;
const reset = (player: string, tick: number) =>
  ({ id: `${tick}:playerReset:${player}`, tick, type: "playerReset", playerId: player, reason: "fall" }) as RaceEvent;
const lapped = (player: string, tick: number, lap: number) =>
  ({ id: `${tick}:lapCompleted:${player}:${lap}`, tick, type: "lapCompleted", playerId: player, lap }) as RaceEvent;
const at = (overrides: Partial<WordInput>): WordInput => ({ ...base, ...overrides });
const withJuice = (nowMs: number, moments: JuiceMoment[], reached: RaceEvent[] = []) =>
  at({ nowMs, juice: { moments, reached, localSlammed: false } });
const reaching = (nowMs: number, reached: RaceEvent[], overrides: Partial<WordInput> = {}) =>
  at({ nowMs, juice: { moments: [], reached, localSlammed: false }, ...overrides });

describe("WordDirector (Wonder spec §5)", () => {
  it("says SLAM! for anyone's slam, and stings only the local one", () => {
    const words = new WordDirector(() => WORDS);
    const out = words.frame(withJuice(0, [slam("p1", 1), slam("p2", 1)]));
    expect(out.started.map((w) => [w.kind, w.playerId, w.local])).toEqual([
      ["slam", "p1", true],
      ["slam", "p2", false],
    ]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.wordPop"]);
  });

  it("says nothing over a CPU, though it keeps the CPU's streak (the owner)", () => {
    const words = new WordDirector(() => WORDS);
    const cpus = new Set([id("p2")]);
    let out = words.frame(at({ cpus, juice: { moments: [slam("p1", 1), slam("p2", 1)], reached: [], localSlammed: false } }));
    expect(out.started.map((w) => w.playerId)).toEqual(["p1"]);
    out = words.frame(at({ nowMs: 100, cpus, stress: true, juice: { moments: [slam("p2", 2)], reached: [], localSlammed: false } }));
    expect(out.started.some((w) => w.playerId === "p2")).toBe(false);
    words.frame(reaching(200, [landed("p2", 3, 1), landed("p2", 4, 2), landed("p2", 5, 3)], { cpus }));
    expect(words.live.some((w) => w.playerId === "p2")).toBe(false);
    expect(words.streakOf(id("p2"))).toBe(3);
  });

  it("counts a streak from three, in one word that updates in place, its sting rising", () => {
    const words = new WordDirector(() => WORDS);
    let out = words.frame(reaching(0, [landed("p1", 1, 1), landed("p1", 2, 2)]));
    expect(out.started).toEqual([]);
    out = words.frame(reaching(100, [landed("p1", 3, 3)]));
    expect(out.started.map((w) => [w.kind, w.count])).toEqual([["streak", 3]]);
    const firstRate = out.cues[0]!.rate!;
    out = words.frame(reaching(200, [landed("p1", 4, 4)]));
    expect(words.live.filter((w) => w.kind === "streak")).toHaveLength(1);
    expect(words.live.find((w) => w.kind === "streak")!.count).toBe(4);
    expect(out.cues[0]!.alias).toBe("sfx.streakStep");
    expect(out.cues[0]!.rate!).toBeGreaterThan(firstRate);
  });

  it("knows each racer's streak until their reset, whether or not its word still shows (Wonder spec §6.3)", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(reaching(0, [landed("p1", 1, 1), landed("p1", 2, 2), landed("p1", 3, 3), landed("p1", 4, 4), landed("p1", 5, 5)]));
    words.frame(at({ nowMs: WORDS.lifeMs * 4 }));
    expect(words.live.some((w) => w.kind === "streak")).toBe(false);
    expect(words.streakOf(id("p1"))).toBe(5);
    words.frame(reaching(WORDS.lifeMs * 5, [reset("p1", 6)]));
    expect(words.streakOf(id("p1"))).toBe(0);
    expect(words.streakOf(id("p9"))).toBe(0);
  });

  it("caps the streak's pitch at an octave", () => {
    const words = new WordDirector(() => WORDS);
    let last = 0;
    for (let i = 1; i <= 20; i += 1) {
      const out = words.frame(reaching(i * 100, [landed("p1", i, i)]));
      const rate = out.cues.find((c) => c.alias === "sfx.streakStep")?.rate;
      if (rate !== undefined) last = rate;
    }
    expect(last).toBeCloseTo(2, 6);
  });

  it("ends a streak on a reset, says Whoops!, and BACK! on a floor within 3 s", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(reaching(0, [landed("p1", 1, 1), landed("p1", 2, 2), landed("p1", 3, 3)]));
    let out = words.frame(reaching(500, [reset("p1", 4)]));
    expect(out.started.map((w) => w.kind)).toEqual(["whoops"]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.whoops"]);
    expect(words.live.some((w) => w.kind === "streak")).toBe(false);
    out = words.frame(reaching(2_000, [landed("p1", 5, 1)]));
    expect(out.started.map((w) => w.kind)).toEqual(["back"]);
  });

  it("says nothing BACK after 3 s", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(reaching(0, [reset("p2", 1)]));
    expect(words.frame(reaching(3_500, [landed("p2", 2, 1)])).started).toEqual([]);
  });

  it("says SKIP! for a landing two or more floors above the last", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(reaching(0, [landed("p2", 1, 4)]));
    const out = words.frame(reaching(100, [landed("p2", 2, 6)]));
    expect(out.started.map((w) => w.kind)).toEqual(["skip"]);
  });

  it("says PASS! when the local racer moves up, and 1ST! with the lead line when they take it", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(at({ nowMs: 0, localPlace: 3 }));
    let out = words.frame(at({ nowMs: 16, localPlace: 2 }));
    expect(out.started.map((w) => w.kind)).toEqual(["pass"]);
    out = words.frame(at({ nowMs: 2_000, localPlace: 1 }));
    expect(out.started.map((w) => w.kind)).toEqual(["lead"]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.wordPop", "vo.lead"]);
    expect(out.cues.find((c) => c.alias === "vo.lead")).toMatchObject({ bus: "voice", delayMs: 120 });
  });

  it("says nothing about position on the first frame, or before the race", () => {
    expect(new WordDirector(() => WORDS).frame(at({ localPlace: 1 })).started).toEqual([]);
    const words = new WordDirector(() => WORDS);
    words.frame(at({ localPlace: undefined }));
    expect(words.frame(at({ nowMs: 16, localPlace: 1 })).started).toEqual([]);
  });

  it("stamps LAP 2! and FINAL ASCENT! in a three-lap race, in the middle, announced", () => {
    const words = new WordDirector(() => WORDS);
    let out = words.frame(reaching(0, [lapped("p1", 1, 1)], { lapCount: 3 }));
    expect(out.started.map((w) => [w.kind, w.lap, w.playerId])).toEqual([["lap", 2, undefined]]);
    expect(out.announce).toEqual([]); // the race announcer already says the lap
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.stamp"]);
    out = words.frame(reaching(5_000, [lapped("p1", 2, 2)], { lapCount: 3, localLap: 3 }));
    expect(out.started.map((w) => w.kind)).toEqual(["finalAscent"]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.stamp"]); // vo.finalAscent stays race-cues.ts's
  });

  it("stamps no lap for a rival, and none in a one-lap race", () => {
    const words = new WordDirector(() => WORDS);
    expect(words.frame(reaching(0, [lapped("p2", 1, 1)], { lapCount: 3 })).started).toEqual([]);
    expect(words.frame(reaching(100, [lapped("p1", 2, 1)])).started).toEqual([]);
  });

  it("stamps LAST FLOOR! once, one floor from the goal on the final lap, never in Infinite", () => {
    const words = new WordDirector(() => WORDS);
    const out = words.frame(at({ localFloors: 19, goalFloors: 20 }));
    expect(out.started.map((w) => w.kind)).toEqual(["lastFloor"]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.stamp", "vo.lastFloor"]);
    expect(words.frame(at({ nowMs: 16, localFloors: 19, goalFloors: 20 })).started).toEqual([]);
    expect(new WordDirector(() => WORDS).frame(at({ localFloors: 19, goalFloors: undefined })).started).toEqual([]);
    expect(new WordDirector(() => WORDS).frame(at({ localFloors: 19, goalFloors: 20, lapCount: 3, localLap: 1 })).started).toEqual([]);
  });

  it("stamps the local racer's place when they finish, with its call", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(at({ localStatus: "racing", localPlace: 3 }));
    const out = words.frame(at({ nowMs: 16, localStatus: "finished", localPlace: 3 }));
    expect(out.started.map((w) => [w.kind, w.place])).toEqual([["place", 3]]);
    expect(out.cues.map((c) => c.alias)).toEqual(["sfx.stamp", "vo.third"]);
    expect(out.announce.map((w) => w.kind)).toEqual(["place"]);
    // After the finish's own calls (GAME!, the winner is…, the name), never over them.
    expect(out.cues.find((c) => c.alias === "vo.third")!.delayMs).toBeGreaterThanOrEqual(3_500);
  });

  it("keeps two local words, replacing the oldest lower one", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(reaching(0, [reset("p1", 1)])); // whoops (fail)
    words.frame(withJuice(10, [slam("p1", 2)])); // slam (skill)
    words.frame(at({ nowMs: 20, localPlace: 3 }));
    words.frame(at({ nowMs: 30, localPlace: 2 })); // pass (position) replaces whoops
    expect(
      words.live
        .filter((w) => w.local && w.playerId === "p1")
        .map((w) => w.kind)
        .sort(),
    ).toEqual(["pass", "slam"]);
  });

  it("drops a lower word that finds no slot, and keeps one word per rival", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(withJuice(0, [slam("p2", 1)]));
    words.frame(reaching(10, [reset("p2", 2)]));
    expect(words.live.filter((w) => w.playerId === "p2").map((w) => w.kind)).toEqual(["slam"]);
  });

  it("does not repeat a word for a racer within the gap", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(withJuice(0, [slam("p2", 1)]));
    expect(words.frame(withJuice(1_000, [slam("p2", 60)])).started).toEqual([]);
    expect(words.frame(withJuice(1_600, [slam("p2", 96)])).started.map((w) => w.kind)).toEqual(["slam"]);
  });

  it("expires a word after its life", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(withJuice(0, [slam("p2", 1)]));
    words.frame(at({ nowMs: WORDS.lifeMs + 1 }));
    expect(words.live).toEqual([]);
  });

  it("a replayed batch shows nothing twice", () => {
    const words = new WordDirector(() => WORDS);
    const batch = at({ nowMs: 0, juice: { moments: [slam("p2", 1)], reached: [reset("p3", 1)], localSlammed: false } });
    words.frame(batch);
    expect(words.frame({ ...batch, nowMs: 2_000 }).started).toEqual([]);
  });

  it("a rewind shows it again", () => {
    let session = "a:";
    const words = new WordDirector(() => WORDS, () => session);
    words.frame(withJuice(0, [slam("p2", 1)]));
    session = "b:";
    words.clear();
    expect(words.frame(withJuice(2_000, [slam("p2", 1)])).started.map((w) => w.kind)).toEqual(["slam"]);
  });

  it("says nothing before content has loaded", () => {
    expect(new WordDirector(() => undefined).frame(withJuice(0, [slam("p1", 1)])).started).toEqual([]);
  });

  it("reads a racer's place from the racers' progress, ties sharing it", () => {
    const racers = [
      { id: id("p1"), progress: 0.5 },
      { id: id("p2"), progress: 0.7 },
      { id: id("p3"), progress: 0.5 },
    ];
    expect(placeIn(racers, id("p2"))).toBe(1);
    expect(placeIn(racers, id("p1"))).toBe(2);
    expect(placeIn(racers, id("p3"))).toBe(2);
    expect(placeIn(racers, id("p9"))).toBeUndefined();
  });

  it("forgets the moments it heard after ten seconds, so a long race holds no endless memory", () => {
    const words = new WordDirector(() => WORDS);
    for (let i = 0; i < 100; i += 1) words.frame(withJuice(i * 200, [slam("p2", i)]));
    expect(words.remembered).toBeLessThanOrEqual(51);
  });

  it("calls the lead at most once in eight seconds, however often a tie trades it", () => {
    const words = new WordDirector(() => WORDS);
    const calls: string[] = [];
    let place = 2;
    for (let t = 0; t <= 12_000; t += 1_600) {
      words.frame(at({ nowMs: t, localPlace: place }));
      place = place === 1 ? 2 : 1;
      const out = words.frame(at({ nowMs: t + 16, localPlace: place }));
      calls.push(...out.cues.filter((c) => c.alias === "vo.lead").map(() => String(t)));
    }
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("plays every sting at its own named level, never at full gain (audit)", () => {
    const words = new WordDirector(() => WORDS);
    const pop = words.frame(withJuice(0, [slam("p1", 1)])).cues[0]!;
    expect(pop.gain).toBe(WORD_POP_GAIN);
    const whoops = words.frame(reaching(100, [reset("p1", 2)])).cues[0]!;
    expect(whoops.gain).toBe(WHOOPS_GAIN);
    words.frame(reaching(200, [landed("p1", 3, 1), landed("p1", 4, 2)]));
    const streak = words.frame(reaching(300, [landed("p1", 5, 3)])).cues[0]!;
    expect(streak.gain).toBe(STREAK_GAIN);
    const stamp = words.frame(at({ nowMs: 400, localFloors: 19, goalFloors: 20 })).cues[0]!;
    expect(stamp.gain).toBe(STAMP_GAIN);
    for (const gain of [WORD_POP_GAIN, WHOOPS_GAIN, STREAK_GAIN, STAMP_GAIN]) expect(gain).toBeLessThan(1);
  });

  it("sounds a new streak's steps after a fall, under keys of its own", () => {
    const words = new WordDirector(() => WORDS);
    const keys: string[] = [];
    let t = 0;
    for (let run = 0; run < 2; run += 1) {
      for (let floor = 1; floor <= 3; floor += 1) {
        t += 100;
        keys.push(...words.frame(reaching(t, [landed("p1", t, floor + run * 10)])).cues.filter((c) => c.alias === "sfx.streakStep").map((c) => c.key));
      }
      t += 5_000;
      words.frame(reaching(t, [reset("p1", t)]));
    }
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("starts its baselines over when the followed racer changes, saying nothing", () => {
    const words = new WordDirector(() => WORDS);
    words.frame(at({ nowMs: 0, localId: id("p3"), localPlace: 3, localStatus: "racing" }));
    const switched = words.frame(at({ nowMs: 16, localId: id("p1"), localPlace: 1, localStatus: "finished" }));
    expect(switched.started).toEqual([]);
    expect(switched.cues).toEqual([]);
    // And the new racer's own moves still speak.
    words.frame(at({ nowMs: 32, localId: id("p1"), localPlace: 2, localStatus: "racing" }));
  });

  it("fills its slots under the frame-budget stress, changing a word's text each time, silently", () => {
    const words = new WordDirector(() => WORDS);
    const texts = new Set<number>();
    let most = 0;
    for (let i = 0; i < 30; i += 1) {
      const out = words.frame({ ...withJuice(i * 100, [slam("p1", i), slam("p2", i), slam("p3", i), slam("p4", i)]), stress: true });
      expect(out.cues).toEqual([]);
      most = Math.max(most, words.live.length);
      for (const word of words.live) if (word.kind === "streak") texts.add(word.count!);
    }
    expect(most).toBeGreaterThanOrEqual(WORDS.localCap + 3 + WORDS.beatCap);
    expect(texts.size).toBeGreaterThan(5);
  });
});

describe("racePlace (audit)", () => {
  const player = (playerId: string, fields: { lap?: number; progress?: number; bestFloor?: number }) => ({
    id: id(playerId),
    lap: fields.lap ?? 1,
    progress: fields.progress ?? 0,
    bestFloor: fields.bestFloor ?? 0,
  });

  it("ranks by lap, then progress, so a racer a lap ahead stays ahead", () => {
    const players = [player("p1", { lap: 2, progress: 0.05 }), player("p2", { lap: 1, progress: 0.9 })];
    expect(racePlace({ players, standings: [], endless: false }, id("p1"))).toBe(1);
    expect(racePlace({ players, standings: [], endless: false }, id("p2"))).toBe(2);
  });

  it("ranks Infinite by best floor, past where progress saturates", () => {
    const players = [player("p1", { progress: 1, bestFloor: 60 }), player("p2", { progress: 1, bestFloor: 120 })];
    expect(racePlace({ players, standings: [], endless: true }, id("p1"))).toBe(2);
  });

  it("takes a placed racer's place from the server's standings", () => {
    const players = [player("p1", { progress: 1 }), player("p2", { progress: 1 })];
    expect(racePlace({ players, standings: [id("p2"), id("p1")], endless: false }, id("p1"))).toBe(2);
  });
});
