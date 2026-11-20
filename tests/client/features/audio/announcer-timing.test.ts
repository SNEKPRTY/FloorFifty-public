/**
 * The announcer, timed: every `vo.*` line is said when it should be, never
 * late, never over another line, and never when it should not be said at all.
 *
 * The other suites pin each line's trigger at a point or two. These sweep the
 * timings that point tests miss (however late a count is first seen, whoever
 * wins in whatever place) against the clips' real lengths from the shipped
 * manifest, so a re-recorded line that runs long fails here rather than in
 * someone's ears.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { AudioEngine, type AudioContextLike, type DecodedTrack } from "../../../../apps/client/src/features/audio";
import { SEAT_CALLS } from "../../../../apps/client/src/lib/constants";
import { countdownCues, cuesForEvents, type Cue, type RoomFacts } from "../../../../apps/client/src/features/race/race-cues";
import { PLACE_CALLS, WordDirector, type WordInput } from "../../../../apps/client/src/features/race/juice/word-director";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";

/** Each voice clip's length in milliseconds, as shipped. */
const VOICE_MS: ReadonlyMap<string, number> = (() => {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../../packages/asset-contract/assets/art-manifest.json"), "utf8"),
  );
  const found = new Map<string, number>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record["alias"] === "string" && record["alias"].startsWith("vo.") && typeof record["durationMs"] === "number") {
        found.set(record["alias"], record["durationMs"]);
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(manifest);
  return found;
})();

const lengthOf = (alias: string): number => {
  const ms = VOICE_MS.get(alias);
  if (ms === undefined) throw new Error(`no voice clip "${alias}" in the manifest`);
  return ms;
};

type Line = { readonly alias: string; readonly atMs: number; readonly maxMs?: number };
const voiceLines = (cues: readonly { alias: string; bus: string; delayMs?: number; maxMs?: number }[]): Line[] =>
  cues
    .filter((cue) => cue.bus === "voice")
    .map((cue) => ({ alias: cue.alias, atMs: cue.delayMs ?? 0, ...(cue.maxMs === undefined ? {} : { maxMs: cue.maxMs }) }));

/** How long a line sounds: its clip, or less where it is cut short. */
const soundsFor = (line: Line): number => Math.min(lengthOf(line.alias), line.maxMs ?? Number.POSITIVE_INFINITY);

/** Every line, in the order it starts, finishes before the next one starts. */
function expectNoOverlap(lines: readonly Line[], context: string): void {
  const sorted = [...lines].sort((a, b) => a.atMs - b.atMs);
  for (let index = 1; index < sorted.length; index += 1) {
    const before = sorted[index - 1]!;
    const after = sorted[index]!;
    const endsAt = before.atMs + soundsFor(before);
    expect(endsAt, `${context}: ${before.alias} (${before.atMs}–${endsAt} ms) runs into ${after.alias} at ${after.atMs} ms`).toBeLessThanOrEqual(after.atMs);
  }
}

const eid = (value: string) => value as RaceEvent["id"];
const me = "p-me" as PlayerId;
const them = "p-them" as PlayerId;
const COLOURS = Object.keys(SEAT_CALLS) as SeatColour[];

describe("the shipped voice clips", () => {
  it("include every line the announcer can say", () => {
    for (const alias of [
      "vo.three", "vo.two", "vo.one", "vo.climb", "vo.finalAscent", "vo.game", "vo.winnerIs", "vo.lead", "vo.lastFloor",
      ...PLACE_CALLS, ...Object.values(SEAT_CALLS),
    ]) {
      expect(VOICE_MS.has(alias), alias).toBe(true);
    }
  });
});

describe("the countdown, however late it is first seen", () => {
  const ORDER = ["vo.three", "vo.two", "vo.one", "vo.climb"];
  const BEFORE: Record<string, number> = { "vo.three": 3_000, "vo.two": 2_000, "vo.one": 1_000, "vo.climb": 0 };
  /** How late a number may land and still be said (`COUNT_LATE_MS` in race-cues). */
  const LATE_LIMIT_MS = 400;
  const sweep = Array.from({ length: 381 }, (_, index) => index * 10); // 0 ms to 3.8 s left

  it("lands CLIMB on the start, every time, and never before it", () => {
    for (const remaining of sweep) {
      const climb = voiceLines(countdownCues("c", remaining)).filter((line) => line.alias === "vo.climb");
      expect(climb, `${remaining} ms left`).toEqual([{ alias: "vo.climb", atMs: remaining }]);
    }
  });

  it("says the numbers in order, each at most once, and none after CLIMB", () => {
    for (const remaining of sweep) {
      const said = voiceLines(countdownCues("c", remaining)).sort((a, b) => a.atMs - b.atMs).map((line) => line.alias);
      expect(said.at(-1), `${remaining} ms left`).toBe("vo.climb");
      expect(new Set(said).size, `${remaining} ms left`).toBe(said.length);
      expect(said, `${remaining} ms left`).toEqual(ORDER.filter((alias) => said.includes(alias)));
    }
  });

  it("never says a number more than the late limit after its beat", () => {
    for (const remaining of sweep) {
      for (const line of voiceLines(countdownCues("c", remaining))) {
        const beat = remaining - BEFORE[line.alias]!;
        expect(line.atMs - beat, `${line.alias} with ${remaining} ms left`).toBeLessThanOrEqual(LATE_LIMIT_MS);
      }
    }
  });

  it("never says a number already a whole beat past, however much is left", () => {
    expect(voiceLines(countdownCues("c", 0)).map((line) => line.alias)).toEqual(["vo.climb"]);
    expect(voiceLines(countdownCues("c", 500)).map((line) => line.alias)).not.toContain("vo.two");
    expect(voiceLines(countdownCues("c", 1_500)).map((line) => line.alias)).not.toContain("vo.three");
  });

  it("never starts a number while the one before it is still speaking", () => {
    // The usual case: the count's first snapshot lands a round trip after it
    // began, so "Three!" is said late, at once. It must not run into "Two!".
    for (const remaining of sweep) expectNoOverlap(voiceLines(countdownCues("c", remaining)), `${remaining} ms left`);
  });

  it("cuts only a number said late, and leaves one on its beat whole", () => {
    expect(voiceLines(countdownCues("c", 3_000)).every((line) => line.maxMs === undefined)).toBe(true);
    expect(voiceLines(countdownCues("c", 2_750))[0]).toEqual({ alias: "vo.three", atMs: 0, maxMs: 750 });
  });
});

describe("the finish's calls", () => {
  const players = (winnerColour: SeatColour): RoomFacts => ({
    players: [
      { id: them, colour: winnerColour },
      { id: me, colour: winnerColour === "scarlet" ? "cyan" : "scarlet" },
    ],
    lapCount: 3,
  });
  const finished = (winner: PlayerId): RaceEvent =>
    ({ id: eid(`900:raceFinished:${winner}`), tick: 900, type: "raceFinished", winnerId: winner }) as RaceEvent;

  /** The place call the word director makes when the local racer crosses the line. */
  const placeCall = (place: number): Line => {
    const words = new WordDirector(() => GENERATED_CONTENT.content.juice.words);
    const frame = (nowMs: number, status: string): WordInput => ({
      nowMs,
      tick: 0,
      localId: me,
      juice: { moments: [], reached: [], localSlammed: false },
      localPlace: place,
      localStatus: status,
      localLap: 1,
      lapCount: 1,
      localFloors: 0,
      goalFloors: 20,
    });
    words.frame(frame(0, "racing"));
    const lines = voiceLines(words.frame(frame(16, "finished")).cues);
    expect(lines).toHaveLength(1);
    return lines[0]!;
  };

  it("says GAME, the winner is, and the winner's colour, in that order, for every colour", () => {
    for (const colour of COLOURS) {
      const lines = voiceLines(cuesForEvents([finished(them)], me, players(colour)));
      expect(lines.sort((a, b) => a.atMs - b.atMs).map((line) => line.alias)).toEqual(["vo.game", "vo.winnerIs", SEAT_CALLS[colour]]);
    }
  });

  it("never talks over itself, with the local racer's place called last, for every colour and place", () => {
    for (const colour of COLOURS) {
      for (let place = 1; place <= PLACE_CALLS.length; place += 1) {
        const lines = [...voiceLines(cuesForEvents([finished(them)], me, players(colour))), placeCall(place)];
        expectNoOverlap(lines, `${colour} wins, local racer ${place}`);
        expect(lines.sort((a, b) => a.atMs - b.atMs).at(-1)!.alias).toBe(PLACE_CALLS[place - 1]);
      }
    }
  });

  it("has said everything within five seconds of the finish", () => {
    for (const colour of COLOURS) {
      for (let place = 1; place <= PLACE_CALLS.length; place += 1) {
        const lines = [...voiceLines(cuesForEvents([finished(them)], me, players(colour))), placeCall(place)];
        for (const line of lines) expect(line.atMs + lengthOf(line.alias), line.alias).toBeLessThanOrEqual(5_000);
      }
    }
  });
});

describe("what the announcer must not say", () => {
  const room: RoomFacts = { players: [{ id: them, colour: "scarlet" }, { id: me, colour: "cyan" }], lapCount: 3 };
  const everyEvent = (player: PlayerId): RaceEvent[] =>
    [
      { id: eid(`1:floorLanded:${player}:3`), tick: 1, type: "floorLanded", playerId: player, floorId: "f3", floorIndex: 3 },
      { id: eid(`2:playerReset:${player}`), tick: 2, type: "playerReset", playerId: player, reason: "fall" },
      { id: eid(`3:playerOut:${player}`), tick: 3, type: "playerOut", playerId: player },
      { id: eid(`4:lapCompleted:${player}:1`), tick: 4, type: "lapCompleted", playerId: player, lap: 1 },
      { id: eid(`5:lapCompleted:${player}:2`), tick: 5, type: "lapCompleted", playerId: player, lap: 2 },
    ] as RaceEvent[];

  it("says nothing about a rival's race, only the finish that belongs to the room", () => {
    expect(voiceLines(cuesForEvents(everyEvent(them), me, room))).toEqual([]);
  });

  it("says nothing to a viewer with no racer of their own until the finish", () => {
    expect(voiceLines(cuesForEvents(everyEvent(me), undefined, room))).toEqual([]);
  });

  it("calls the final ascent once, on the local racer's last lap but one, and never in a one-lap race", () => {
    const said = (lapCount: number) =>
      voiceLines(cuesForEvents(everyEvent(me), me, { ...room, lapCount })).map((line) => line.alias);
    expect(said(3)).toEqual(["vo.finalAscent"]);
    expect(said(2)).toEqual(["vo.finalAscent"]);
    expect(said(1)).toEqual([]);
    // Without the room's lap count it cannot know which lap is last: silence, not a guess.
    expect(voiceLines(cuesForEvents(everyEvent(me), me)).map((line) => line.alias)).toEqual([]);
  });

  it("calls the final ascent just after the lap's clash, not seconds later", () => {
    const [line] = voiceLines(cuesForEvents(everyEvent(me), me, room));
    expect(line!.atMs).toBeGreaterThan(0);
    expect(line!.atMs).toBeLessThanOrEqual(500);
  });

  describe("the word director's lines", () => {
    const WORDS = GENERATED_CONTENT.content.juice.words;
    const frame = (overrides: Partial<WordInput>): WordInput => ({
      nowMs: 0,
      tick: 0,
      localId: me,
      juice: { moments: [], reached: [], localSlammed: false },
      localPlace: 2,
      localStatus: "racing",
      localLap: 1,
      lapCount: 1,
      localFloors: 0,
      goalFloors: 20,
      ...overrides,
    });

    it("does not call a place for a race already over when the screen opened (a reload)", () => {
      const words = new WordDirector(() => WORDS);
      expect(voiceLines(words.frame(frame({ localStatus: "finished", localPlace: 1 })).cues)).toEqual([]);
      expect(voiceLines(words.frame(frame({ nowMs: 16, localStatus: "finished", localPlace: 1 })).cues)).toEqual([]);
    });

    it("does not call a place when a replay switches to a racer who has already finished", () => {
      const words = new WordDirector(() => WORDS);
      words.frame(frame({ localStatus: "racing" }));
      const switched = words.frame(frame({ nowMs: 16, localId: them, localStatus: "finished", localPlace: 1 }));
      expect(voiceLines(switched.cues)).toEqual([]);
    });

    it("calls the place once, however many frames the finish lasts", () => {
      const words = new WordDirector(() => WORDS);
      words.frame(frame({ localStatus: "racing" }));
      const said: string[] = [];
      for (let nowMs = 16; nowMs < 5_000; nowMs += 16) {
        said.push(...voiceLines(words.frame(frame({ nowMs, localStatus: "finished", localPlace: 2 })).cues).map((line) => line.alias));
      }
      expect(said).toEqual(["vo.second"]);
    });

    it("does not call the last floor in a race of many laps until the last one", () => {
      const words = new WordDirector(() => WORDS);
      for (let lap = 1; lap < 3; lap += 1) {
        expect(voiceLines(words.frame(frame({ nowMs: lap * 100, lapCount: 3, localLap: lap, localFloors: 19 })).cues), `lap ${lap}`).toEqual([]);
      }
      expect(voiceLines(words.frame(frame({ nowMs: 400, lapCount: 3, localLap: 3, localFloors: 19 })).cues).map((line) => line.alias)).toEqual([
        "vo.lastFloor",
      ]);
    });
  });
});

describe("through the real mixer", () => {
  /** A Web Audio stand-in that records what starts, and when, and what is stopped. */
  type Started = { alias: string; at: number; duration?: number; stopped: boolean };
  function engine(): { engine: AudioEngine; started: Started[] } {
    const started: Started[] = [];
    const gain = () => ({
      gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect: () => undefined,
      disconnect: () => undefined,
    });
    const context = {
      state: "suspended" as AudioContextState,
      currentTime: 0,
      destination: {},
      async resume() {
        context.state = "running";
      },
      async suspend() {},
      createGain: gain,
      createBufferSource() {
        const node = {
          buffer: null as { alias: string } | null,
          loop: false,
          loopStart: 0,
          loopEnd: 0,
          playbackRate: { value: 1 },
          onended: null as (() => void) | null,
          connect: () => undefined,
          disconnect: () => undefined,
          record: undefined as Started | undefined,
          start(when?: number, _offset?: number, duration?: number) {
            node.record = { alias: node.buffer?.alias ?? "?", at: when ?? 0, ...(duration === undefined ? {} : { duration }), stopped: false };
            started.push(node.record);
          },
          stop() {
            if (node.record !== undefined) node.record.stopped = true;
            node.onended?.();
          },
        };
        return node;
      },
    };
    const decode = async (alias: string): Promise<DecodedTrack> => ({
      buffer: { alias, duration: (VOICE_MS.get(alias) ?? 300) / 1000 } as unknown as AudioBuffer,
      loopStartMs: 0,
      loopEndMs: 0,
    });
    return { engine: new AudioEngine({ createContext: () => context as unknown as AudioContextLike, decode }), started };
  }

  const play = async (
    target: AudioEngine,
    cues: readonly { alias: string; bus: string; key?: string; eventId?: string; delayMs?: number; maxMs?: number }[],
  ) => {
    for (const cue of cues) {
      const eventId = cue.eventId ?? cue.key;
      await target.playCue(cue.alias, {
        bus: cue.bus as Cue["bus"],
        ...(eventId === undefined ? {} : { eventId }),
        ...(cue.delayMs === undefined ? {} : { delayMs: cue.delayMs }),
        ...(cue.maxMs === undefined ? {} : { maxMs: cue.maxMs }),
      });
    }
  };

  it("cuts a late number where the next one is due, and plays one on its beat in full", async () => {
    const mixer = engine();
    await mixer.engine.unlock();
    await play(mixer.engine, countdownCues("late", 2_750));
    const three = mixer.started.find((sound) => sound.alias === "vo.three")!;
    const two = mixer.started.find((sound) => sound.alias === "vo.two")!;
    expect(three.duration).toBeCloseTo(0.75);
    expect(two.duration).toBeUndefined();
  });

  it("calls the local racer's place in every race, not just the first one the app played", async () => {
    // One mixer for the whole session; a new race scene (and word director) per race.
    const mixer = engine();
    await mixer.engine.unlock();
    for (let race = 1; race <= 2; race += 1) {
      const words = new WordDirector(() => GENERATED_CONTENT.content.juice.words);
      const base: WordInput = {
        nowMs: 0, tick: 0, localId: me, juice: { moments: [], reached: [], localSlammed: false },
        localPlace: 2, localStatus: "racing", localLap: 1, lapCount: 1, localFloors: 0, goalFloors: 20,
      };
      words.frame(base);
      await play(mixer.engine, words.frame({ ...base, nowMs: 16, localStatus: "finished" }).cues);
      expect(mixer.started.filter((sound) => sound.alias === "vo.second"), `race ${race}`).toHaveLength(race);
    }
  });

  it("calls the last floor in every race, not just the first one the app played", async () => {
    const mixer = engine();
    await mixer.engine.unlock();
    for (let race = 1; race <= 2; race += 1) {
      const words = new WordDirector(() => GENERATED_CONTENT.content.juice.words);
      await play(mixer.engine, words.frame({
        nowMs: 0, tick: 0, localId: me, juice: { moments: [], reached: [], localSlammed: false },
        localPlace: 2, localStatus: "racing", localLap: 1, lapCount: 1, localFloors: 19, goalFloors: 20,
      }).cues);
      expect(mixer.started.filter((sound) => sound.alias === "vo.lastFloor"), `race ${race}`).toHaveLength(race);
    }
  });

  it("keeps a queued finish line through a burst of effects, so the winner is still named", async () => {
    // A reconnect can deliver a batch of landings just as the finish's calls
    // are queued; the oldest sound is the one the cap stops, and a line that
    // has not started yet is not old, it is the announcer still to speak.
    const mixer = engine();
    await mixer.engine.unlock();
    const room: RoomFacts = { players: [{ id: them, colour: "scarlet" }, { id: me, colour: "cyan" }], lapCount: 1 };
    await play(mixer.engine, cuesForEvents([{ id: eid("900:raceFinished"), tick: 900, type: "raceFinished", winnerId: them } as RaceEvent], me, room));
    for (let index = 0; index < 20; index += 1) {
      await mixer.engine.playCue("sfx.landLow", { bus: "effects", eventId: `burst:${index}` });
    }
    for (const alias of ["vo.game", "vo.winnerIs", "vo.red"]) {
      expect(mixer.started.find((sound) => sound.alias === alias)?.stopped, alias).toBe(false);
    }
  });
});
