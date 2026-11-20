/**
 * The pop-up words' rules (Wonder spec §5.2–5.5): which moment says which
 * word, whose it is, how many show at once, and what each sounds like. Pure:
 * it reads what the juice answered and the room's events, and returns words
 * to show and cues to play. `WordPool` draws them.
 *
 * Every word comes from a moment's or an event's key, kept with the owner's
 * prefix, so a redelivered batch shows nothing twice and a replay's rewind
 * (a new prefix, after `clear`) shows it again.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { WordsTuning } from "@floor-fifty/shared/content/game-content";
import { STAMP_GAIN, STREAK_GAIN, WHOOPS_GAIN, WONDER_CUES, WORD_POP_GAIN } from "../race-cues";
import type { JuiceFrameResult } from "./juice-director";
import type { WordKind, WordSpec } from "./word-text";

export type WordGroup = "beat" | "position" | "skill" | "fail";

export type Word = WordSpec & {
  /** One per word on screen; the streak's is its racer's, so it updates in place. */
  readonly key: string;
  readonly group: WordGroup;
  /** The racer it pops above, or undefined for a race beat stamped in the middle. */
  readonly playerId: PlayerId | undefined;
  readonly local: boolean;
  /** When it last popped: re-set when the streak updates. */
  readonly bornMs: number;
};

export type WordCue = {
  readonly alias: string;
  readonly key: string;
  readonly bus: "effects" | "voice";
  /** The sting's level, from `race-cues.ts`; a voice line plays at the voice bus's own. */
  readonly gain?: number;
  readonly rate?: number;
  readonly delayMs?: number;
};

export type WordInput = {
  readonly nowMs: number;
  readonly tick: number;
  readonly localId: PlayerId | undefined;
  readonly juice: JuiceFrameResult;
  /** The local racer's place, or undefined before the race. */
  readonly localPlace: number | undefined;
  readonly localStatus: string | undefined;
  readonly localLap: number;
  readonly lapCount: number;
  /** Floors the local racer has collected this lap. */
  readonly localFloors: number;
  /** The floors to the goal, or undefined in Infinite, which has none. */
  readonly goalFloors: number | undefined;
  /** The frame-budget gate's stress (Wonder spec §6.6): fill every slot, change a word's text each time, silently. */
  readonly stress?: boolean;
  /** The CPUs in the race: no word pops over one (the owner), though their streaks are still counted. */
  readonly cpus?: ReadonlySet<PlayerId>;
};

export type WordFrame = {
  /** Words that started (or, for the streak, re-popped) this frame. */
  readonly started: readonly Word[];
  readonly cues: readonly WordCue[];
  /** Race beats, for the screen-reader announcer. */
  readonly announce: readonly Word[];
};

/** The announcer's place calls, first to fourth. */
export const PLACE_CALLS = ["vo.first", "vo.second", "vo.third", "vo.fourth"] as const;
const LEAD_CALL = "vo.lead";
/** The lead line is called no more often than this, however often a tie trades first place. */
const LEAD_CALL_GAP_MS = 8_000;
/** How long a heard moment's key is kept to refuse a redelivery; then it is forgotten, as the juice forgets. */
const MEMORY_MS = 10_000;
const LAST_FLOOR_CALL = "vo.lastFloor";
/** A voice line follows its stamp by this much: one moment, the stamp first. */
const VOICE_AFTER_MS = 120;
/** The finishing place is called after the finish's own calls (GAME!, the winner is…, the name), never over them. */
const PLACE_CALL_AT_MS = 3_700;
/**
 * The last session handed out on this page. The mixer never forgets a key it
 * has played, and a race's place and last-floor calls are keyed by the moment
 * alone, so each director's keys carry a session: the next race calls them
 * again (`juice-director.ts` keys its sounds the same way).
 */
let sessions = 0;

/** The pentatonic steps, in semitones, the streak's sting climbs; the last is the octave. */
const STREAK_STEPS = [0, 3, 5, 7, 10, 12] as const;

const GROUP: Readonly<Record<WordKind, WordGroup>> = {
  slam: "skill",
  streak: "skill",
  skip: "skill",
  pass: "position",
  lead: "position",
  lap: "beat",
  finalAscent: "beat",
  lastFloor: "beat",
  place: "beat",
  whoops: "fail",
  back: "fail",
};
const PRIORITY: Readonly<Record<WordGroup, number>> = { beat: 3, position: 2, skill: 1, fail: 0 };
const NOTHING: WordFrame = { started: [], cues: [], announce: [] };

type Candidate = WordSpec & { readonly source: string; readonly playerId: PlayerId | undefined };
type Racer = { streak: number; lastFloor: number | undefined; resetAtMs: number | undefined; run: number };
type Ranked = { readonly id: PlayerId; readonly lap: number; readonly progress: number; readonly bestFloor: number };

/**
 * A racer's place (the audit): the server's standings once it has placed
 * them; in Infinite, by best floor, past where progress saturates; otherwise
 * by lap, then progress, so a racer a lap ahead stays ahead. A tie shares it.
 */
export function racePlace(
  race: { readonly players: readonly Ranked[]; readonly standings: readonly PlayerId[]; readonly endless: boolean },
  id: PlayerId,
): number | undefined {
  const placed = race.standings.indexOf(id);
  if (placed >= 0) return placed + 1;
  const self = race.players.find((racer) => racer.id === id);
  if (self === undefined) return undefined;
  const ahead = race.endless
    ? race.players.filter((racer) => racer.bestFloor > self.bestFloor)
    : race.players.filter((racer) => racer.lap > self.lap || (racer.lap === self.lap && racer.progress > self.progress));
  return 1 + ahead.length;
}

/** A racer's place by progress: one more than those ahead, so a tie shares it (`standingsSummary`'s rule). */
export function placeIn(racers: readonly { readonly id: PlayerId; readonly progress: number }[], id: PlayerId): number | undefined {
  const self = racers.find((racer) => racer.id === id);
  if (self === undefined) return undefined;
  return 1 + racers.filter((racer) => racer.progress > self.progress).length;
}

export class WordDirector {
  private words: Word[] = [];
  /** Each heard moment's key, with when it was heard. */
  private readonly seen = new Map<string, number>();
  private leadCalledMs = Number.NEGATIVE_INFINITY;
  private readonly lastSaid = new Map<string, number>();
  private readonly racers = new Map<PlayerId, Racer>();
  private lastPlace: number | undefined;
  private lastLocalId: PlayerId | undefined;
  /** The stress hook's running count, so each of its words reads differently. */
  private stressCount = 0;
  private lastStatus: string | undefined;
  private saidLastFloor = false;
  /** This director's session, renewed by `clear`. */
  private session = ++sessions;

  constructor(
    private readonly tuning: () => WordsTuning | undefined,
    private readonly keyPrefix: () => string = () => "",
  ) {}

  frame(input: WordInput): WordFrame {
    const words = this.tuning();
    if (words === undefined) return NOTHING;
    this.words = this.words.filter((word) => input.nowMs - word.bornMs <= words.lifeMs);
    for (const [key, heardMs] of this.seen) if (input.nowMs - heardMs > MEMORY_MS) this.seen.delete(key);

    // A new racer to follow (a replay's follow switch) starts the baselines
    // over, saying nothing: their place and status are where they are, not news.
    if (input.localId !== this.lastLocalId && this.lastLocalId !== undefined) {
      this.lastLocalId = input.localId;
      this.lastPlace = input.localPlace;
      this.lastStatus = input.localStatus;
      this.saidLastFloor = input.goalFloors !== undefined && input.localLap >= input.lapCount && input.localFloors === input.goalFloors - 1;
    }
    this.lastLocalId = input.localId;
    if (input.stress === true) return this.stressFrame(input, words);

    const candidates: Candidate[] = [];
    const prefix = this.keyPrefix();
    const fresh = (source: string): boolean => {
      const key = `${prefix}${source}`;
      if (this.seen.has(key)) return false;
      this.seen.set(key, input.nowMs);
      return true;
    };

    for (const moment of input.juice.moments) {
      if (moment.kind === "slam" && fresh(moment.key)) candidates.push({ kind: "slam", source: moment.key, playerId: moment.playerId });
    }
    for (const event of input.juice.reached) {
      if (!fresh(event.id)) continue;
      this.hear(event, input, words, candidates);
    }
    this.position(input, candidates);
    if (!this.saidLastFloor && input.goalFloors !== undefined && input.localLap >= input.lapCount && input.localFloors === input.goalFloors - 1) {
      this.saidLastFloor = true;
      candidates.push({ kind: "lastFloor", source: "lastFloor", playerId: undefined });
    }
    if (input.localStatus === "finished" && this.lastStatus !== undefined && this.lastStatus !== "finished" && input.localPlace !== undefined) {
      candidates.push({ kind: "place", place: input.localPlace, source: "place", playerId: undefined });
    }
    this.lastStatus = input.localStatus;

    const started: Word[] = [];
    const cues: WordCue[] = [];
    for (const candidate of candidates) {
      const word = this.admit(candidate, input, words, prefix);
      if (word === undefined) continue;
      started.push(word);
      cues.push(...this.cuesOf(word, words));
    }
    // The race announcer already says each lap; the words add the last floor and the place.
    return { started, cues, announce: started.filter((word) => word.kind === "lastFloor" || word.kind === "place") };
  }

  /** The gate's load: every racer's slam, the local streak climbing, and a beat, each refreshed, in silence. */
  private stressFrame(input: WordInput, words: WordsTuning): WordFrame {
    const slams = input.juice.moments.filter((moment) => moment.kind === "slam");
    if (slams.length === 0) return NOTHING;
    this.stressCount += 1;
    const prefix = this.keyPrefix();
    const started: Word[] = [];
    const candidates: Candidate[] = slams.map((moment) => ({ kind: "slam", source: moment.key, playerId: moment.playerId }));
    if (input.localId !== undefined) {
      candidates.push({ kind: "streak", count: words.streakFrom + (this.stressCount % 90), source: `stress:${this.stressCount}`, playerId: input.localId });
    }
    candidates.push({ kind: "lap", lap: 2 + (this.stressCount % 2), source: `stress-beat:${this.stressCount}`, playerId: undefined });
    for (const candidate of candidates) {
      const word = this.admit(candidate, input, words, prefix, true);
      if (word !== undefined) started.push(word);
    }
    return { started, cues: [], announce: [] };
  }

  /** Moments still remembered, to refuse their redelivery. Exposed so a test can assert the memory is bounded. */
  get remembered(): number {
    return this.seen.size;
  }

  /** A racer's floors in a row since their last reset, whether or not its word still shows. */
  streakOf(id: PlayerId): number {
    return this.racers.get(id)?.streak ?? 0;
  }

  /** The words on screen now. */
  get live(): readonly Word[] {
    return this.words;
  }

  /** Forgets everything: a replay's rewind, or a new race. */
  clear(): void {
    this.session = ++sessions;
    this.words = [];
    this.seen.clear();
    this.leadCalledMs = Number.NEGATIVE_INFINITY;
    this.lastSaid.clear();
    this.racers.clear();
    this.lastPlace = undefined;
    this.lastStatus = undefined;
    this.lastLocalId = undefined;
    this.saidLastFloor = false;
  }

  /** A room event the drawn picture has reached. */
  private hear(event: RaceEvent, input: WordInput, words: WordsTuning, candidates: Candidate[]): void {
    if (event.type === "floorLanded") {
      const racer = this.racerOf(event.playerId);
      racer.streak += 1;
      if (racer.lastFloor !== undefined && event.floorIndex - racer.lastFloor >= 2) {
        candidates.push({ kind: "skip", source: event.id, playerId: event.playerId });
      }
      if (racer.resetAtMs !== undefined && input.nowMs - racer.resetAtMs <= words.backWithinMs) {
        candidates.push({ kind: "back", source: event.id, playerId: event.playerId });
        racer.resetAtMs = undefined;
      }
      racer.lastFloor = event.floorIndex;
      if (racer.streak >= words.streakFrom) {
        candidates.push({ kind: "streak", count: racer.streak, source: event.id, playerId: event.playerId });
      }
      return;
    }
    if (event.type === "playerReset") {
      const racer = this.racerOf(event.playerId);
      racer.streak = 0;
      racer.resetAtMs = input.nowMs;
      racer.run += 1;
      this.words = this.words.filter((word) => !(word.kind === "streak" && word.playerId === event.playerId));
      candidates.push({ kind: "whoops", source: event.id, playerId: event.playerId });
      return;
    }
    if (event.type === "lapCompleted" && event.playerId === input.localId) {
      if (input.lapCount === 3 && event.lap === 1) candidates.push({ kind: "lap", lap: 2, source: event.id, playerId: undefined });
      else if (input.lapCount > 1 && event.lap === input.lapCount - 1) {
        candidates.push({ kind: "finalAscent", source: event.id, playerId: undefined });
      }
    }
  }

  /** PASS! for a place gained, 1ST! for the lead: the local racer's alone, never on the first frame. */
  private position(input: WordInput, candidates: Candidate[]): void {
    const place = input.localPlace;
    const before = this.lastPlace;
    this.lastPlace = place;
    if (place === undefined || before === undefined || place >= before || input.localId === undefined) return;
    candidates.push({ kind: place === 1 ? "lead" : "pass", source: `place:${input.tick}:${place}`, playerId: input.localId });
  }

  /** Lets a word on screen if its slot has room, or a lower word to replace; or drops it. */
  private admit(candidate: Candidate, input: WordInput, words: WordsTuning, prefix: string, stressed = false): Word | undefined {
    const group = GROUP[candidate.kind];
    const local = candidate.playerId === undefined || candidate.playerId === input.localId;
    if (!local && input.cpus?.has(candidate.playerId!) === true) return undefined;
    const playerId = group === "beat" ? undefined : candidate.playerId;

    // The streak updates in place: it re-pops with its new count.
    if (candidate.kind === "streak") {
      const live = this.words.find((word) => word.kind === "streak" && word.playerId === playerId);
      if (live !== undefined) {
        const updated: Word = { ...live, ...(candidate.count === undefined ? {} : { count: candidate.count }), bornMs: input.nowMs };
        this.words = this.words.map((word) => (word === live ? updated : word));
        return updated;
      }
    }

    const said = `${playerId ?? "beat"}:${candidate.kind}`;
    const lastMs = this.lastSaid.get(said);
    if (!stressed && candidate.kind !== "streak" && lastMs !== undefined && input.nowMs - lastMs < words.repeatGapMs) return undefined;

    const inSlot = (word: Word): boolean =>
      group === "beat" ? word.group === "beat" : word.group !== "beat" && word.playerId === playerId;
    const slot = this.words.filter(inSlot);
    const cap = group === "beat" ? words.beatCap : local ? words.localCap : 1;
    if (slot.length >= cap) {
      const lower = slot
        .filter((word) => PRIORITY[word.group] < PRIORITY[group])
        .sort((a, b) => a.bornMs - b.bornMs)[0];
      if (lower === undefined) return undefined;
      this.words = this.words.filter((word) => word !== lower);
    }

    const key =
      candidate.kind === "streak"
        ? `${prefix}${this.session}:${playerId}:streak`
        : `${prefix}${this.session}:${candidate.source}:${candidate.kind}`;
    const word: Word = {
      kind: candidate.kind,
      ...(candidate.count === undefined ? {} : { count: candidate.count }),
      ...(candidate.lap === undefined ? {} : { lap: candidate.lap }),
      ...(candidate.place === undefined ? {} : { place: candidate.place }),
      key,
      group,
      playerId,
      local,
      bornMs: input.nowMs,
    };
    this.words.push(word);
    this.lastSaid.set(said, input.nowMs);
    return word;
  }

  /** A local word's sting, and the announcer's line for the big ones (Wonder spec §5.4). Rivals are silent. */
  private cuesOf(word: Word, words: WordsTuning): WordCue[] {
    if (!word.local) return [];
    // Each streak step is its own sound, and each streak (a run between resets)
    // its own steps: the mixer hears a key once.
    const run = word.playerId === undefined ? 0 : (this.racers.get(word.playerId)?.run ?? 0);
    const key = word.kind === "streak" ? `${word.key}:${run}:${word.count}` : word.key;
    const cue = (alias: string, gain: number, extra: Partial<WordCue> = {}): WordCue => ({ alias, key: `${key}/${alias}`, bus: "effects", gain, ...extra });
    const voice = (alias: string, delayMs = VOICE_AFTER_MS): WordCue => ({ alias, key: `${key}/${alias}`, bus: "voice", delayMs });
    switch (word.group) {
      case "beat": {
        const cues = [cue(WONDER_CUES.stamp, STAMP_GAIN)];
        if (word.kind === "lastFloor") cues.push(voice(LAST_FLOOR_CALL));
        const call = word.kind === "place" && word.place !== undefined ? PLACE_CALLS[word.place - 1] : undefined;
        if (call !== undefined) cues.push(voice(call, PLACE_CALL_AT_MS));
        return cues;
      }
      case "fail":
        return [word.kind === "whoops" ? cue(WONDER_CUES.whoops, WHOOPS_GAIN) : cue(WONDER_CUES.wordPop, WORD_POP_GAIN)];
      default: {
        if (word.kind === "streak") {
          const step = STREAK_STEPS[Math.min(Math.max(0, (word.count ?? 0) - words.streakFrom), STREAK_STEPS.length - 1)]!;
          return [cue(WONDER_CUES.streakStep, STREAK_GAIN, { rate: 2 ** (step / 12) })];
        }
        const cues = [cue(WONDER_CUES.wordPop, WORD_POP_GAIN)];
        if (word.kind === "lead" && word.bornMs - this.leadCalledMs >= LEAD_CALL_GAP_MS) {
          this.leadCalledMs = word.bornMs;
          cues.push(voice(LEAD_CALL));
        }
        return cues;
      }
    }
  }

  private racerOf(id: PlayerId): Racer {
    let racer = this.racers.get(id);
    if (racer === undefined) {
      racer = { streak: 0, lastFloor: undefined, resetAtMs: undefined, run: 0 };
      this.racers.set(id, racer);
    }
    return racer;
  }
}
