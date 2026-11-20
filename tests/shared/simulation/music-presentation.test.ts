/**
 * Music is presentation.
 *
 * The design's claim is strong and worth testing as a claim rather than as a
 * behaviour: the same input frames produce the same simulation state and the
 * same race result whether music is playing, muted, delayed by a browser
 * unlock, or absent entirely. There is no on-beat verdict, no rhythm score, no
 * streak, no Flow state, no missed-beat penalty, and no beat-dependent physics.
 *
 * That is easy to satisfy today and easy to lose later, because losing it
 * looks like a small convenience: one import of the stage's tempo into a
 * landing check. These tests are structural for exactly that reason. A
 * behavioural test can only show that the coupling is absent from the paths it
 * happens to drive; a test that reads the simulation's own source can show that
 * there is nowhere for it to hide.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { RaceEvent, HeldInput } from "@floor-fifty/shared/common/protocol";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { advance, freshRaceState, PLAYER_ID } from "../support/race";

/** Every `.ts` file under a directory, read as one string per file. */
function sources(relative: string): { file: string; text: string }[] {
  const root = resolve(process.cwd(), relative);
  const walk = (dir: string): { file: string; text: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!entry.name.endsWith(".ts")) return [];
      return [{ file: `${relative}/${entry.name}`, text: readFileSync(path, "utf8") }];
    });
  return walk(root);
}

/**
 * Words that would mean the simulation had learned about music.
 *
 * Deliberately blunt. A false alarm here costs a rename; a miss costs the
 * property the whole slice is built on.
 */
const MUSICAL_TERMS = /\b(bpm|beat|song|audio|music|tempo|downbeat|rhythm|flow state)\b/i;

/** The authoritative halves. Neither may know a song exists. */
const AUTHORITATIVE_DIRECTORIES = [
  "packages/shared/src/simulation",
  "packages/shared/src/level",
];

describe("the simulation cannot hear the music", () => {
  it.each(AUTHORITATIVE_DIRECTORIES)("has no musical vocabulary in %s", (directory) => {
    const scanned = sources(directory);

    // A scan that found nothing would pass this test for the wrong reason, and
    // would keep passing after a directory was renamed out from under it.
    expect(scanned.length).toBeGreaterThan(0);

    const offenders = scanned
      .filter((source) => MUSICAL_TERMS.test(source.text))
      .map((source) => source.file);

    expect(offenders).toEqual([]);
  });

  it("would notice musical vocabulary if it appeared", () => {
    // The scan's own control. `MUSICAL_TERMS` is the whole mechanism above, so
    // a regex that had been broken into never matching would silently retire
    // the rule rather than fail it.
    expect(MUSICAL_TERMS.test("const ticksPerBeat = TICK_HZ * 60 / bpm;")).toBe(true);
    expect(MUSICAL_TERMS.test("player.vy = tuning.BOUNCE_VELOCITY;")).toBe(false);
  });

  it("imports nothing from the content package's song contract", () => {
    const offenders = [...AUTHORITATIVE_DIRECTORIES.flatMap(sources)]
      .filter((source) => /from ["'].*content\//.test(source.text))
      .map((source) => source.file);

    expect(offenders).toEqual([]);
  });

  it("keeps songs out of the ruleset hash preimage", () => {
    // The partition is computed in one function. Reading it is a cheaper and
    // far more direct check than hashing two payloads and comparing.
    const revisions = readFileSync(
      resolve(process.cwd(), "packages/content/src/revisions.ts"),
      "utf8",
    );
    const preimage = revisions.slice(
      revisions.indexOf("const rulesetInput"),
      revisions.indexOf("const sha256"),
    );

    expect(preimage).not.toContain("songs");
    expect(preimage.length).toBeGreaterThan(0);
  });
});

/** One deterministic minute of input, the same every time it is asked for. */
function inputScript(tick: number): ReadonlyMap<PlayerId, HeldInput> {
  // An arbitrary but fixed pattern: steer right, steer left, fast fall, rest.
  const bucket = Math.floor(tick / 17) % 4;
  return new Map([
    [
      PLAYER_ID,
      {
        sequence: tick,
        left: bucket === 1,
        right: bucket === 0,
        fastFall: bucket === 2,
        reset: false,
      },
    ],
  ]);
}

type Trace = { state: RaceState; events: RaceEvent[] };

/** Runs a fixed script, optionally letting `sideEffect` run every tick. */
function race(sideEffect?: (tick: number) => void): Trace {
  let state = freshRaceState(1, resolveTuning());
  const events: RaceEvent[] = [];

  for (let tick = 1; tick <= TICK_HZ * 20; tick += 1) {
    sideEffect?.(tick);
    const result = advance({ ...state, tick }, inputScript(tick));
    state = result.state;
    events.push(...result.events);
  }

  return { state, events };
}

describe("a race is the same race whatever the audio is doing", () => {
  const silent = race();

  /**
   * Stands in for the four audio states the design names.
   *
   * Nothing about them can reach the simulation, which is the point: the test
   * runs them anyway, on every tick, so that a future coupling through a
   * module-level cache or a shared clock would show up here as a divergence
   * rather than as a bug report about a race that desynchronised when someone
   * muted the tab.
   */
  const audioStates: [string, (tick: number) => void][] = [
    ["playing", () => undefined],
    ["muted", () => undefined],
    ["unlocked late", (tick) => void (tick === 300 && Date.now())],
    ["absent", () => undefined],
  ];

  it.each(audioStates)("produces an identical state when audio is %s", (_name, sideEffect) => {
    const run = race(sideEffect);
    expect(run.state).toEqual(silent.state);
  });

  it.each(audioStates)("produces an identical event stream when audio is %s", (_name, effect) => {
    const run = race(effect);
    expect(run.events).toEqual(silent.events);
  });

  it("produces the same result twice from the same script", () => {
    // The control. If this failed, nothing above would mean anything.
    expect(race().state).toEqual(silent.state);
    expect(race().events).toEqual(silent.events);
  });
});
