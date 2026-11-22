/**
 * Race events, heard.
 *
 * The server has been sending `snapshot.events` since the protocol was written
 * and the client has never read them. Everything drawn until now came from
 * comparing one snapshot's state against the last, which is enough to move a
 * sprite and not enough to sound a landing: a state difference tells you where
 * a racer is, an event tells you that something happened, and only the second
 * can be played once.
 *
 * Each event carries an ID the server built from the tick, the kind, the player
 * and the subject. That ID is what the mixer de-duplicates on, so a snapshot
 * replayed after a reconnect re-delivers the same landing and the player hears
 * one. Deciding sameness here from timing instead would be guessing at
 * something authority already knows.
 *
 * Nothing in this module can reach the simulation. It reads events and asks for
 * sounds; a muted tab, a failed unlock or a missing cue changes what a player
 * hears and nothing about the race.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { StageContent } from "@floor-fifty/shared/content/game-content";
import { SEAT_CALLS } from "../../lib/constants";
import type { Bus, CueOptions, MusicDuck } from "../audio";
// The scale the landings were drafted in and climb through; see `pentatonic.ts`.
import { rateFor, semitonesOf } from "../audio/pentatonic";

/** One sound to ask the mixer for: what to play, and how. */
export type Sound = CueOptions & { readonly alias: string };

export type Cue = Sound & {
  /**
   * The event's own ID, suffixed by the layer. One event sounds several files
   * -- a drafted tone under a recorded clash, a fanfare under a crowd -- and the
   * mixer de-duplicates on this, so each layer needs its own name or only the
   * first would ever be heard.
   */
  readonly eventId: string;
};

/**
 * What the room tells a cue beyond the event: who races in which colour and
 * where they are, how long the race is, and how tall and wide the course is.
 * The last two are optional so a caller with no course to hand still hears
 * every cue, centred and unclimbed.
 */
export type RoomFacts = {
  readonly players: readonly { readonly id: PlayerId; readonly colour: SeatColour; readonly x?: number; readonly y?: number }[];
  readonly lapCount: number;
  readonly floorCount?: number;
  /** Half the course's width in world units, from its centre to a wall. */
  readonly halfWidth?: number;
  /** One floor's height in world units, which a rival's distance is counted in. */
  readonly floorGap?: number;
};

/**
 * The landing variants, in the order a climb cycles them.
 *
 * Three, chosen by floor rather than at random. One sound twenty times up a
 * climb stops being information and becomes a metronome; three keep it reading
 * as the same action. By floor and not by chance because the same floor should
 * sound the same on every client and in every replay of the race.
 */
const LANDINGS = ["sfx.landLow", "sfx.landMid", "sfx.landHigh"] as const;

/** The recorded blade tap under each drafted landing, register for register. */
const CLASHES = ["sfx.clashLow", "sfx.clashMid", "sfx.clashHigh"] as const;

/**
 * How loud a landing sits against the rest of the mix.
 *
 * Well under the cues that report something rarer. A climb is fifty-seven
 * landings in forty seconds -- more than one a second -- and a sound at that
 * rate stops being information and becomes a texture whether it is designed as
 * one or not. It is mixed as a footstep: present, placing the player on a
 * surface, and not asking to be noticed each time.
 */
export const LANDING_GAIN = 0.32;

/** The clash under it quieter still: the ring the hall gives it is most of what it adds. */
export const CLASH_GAIN = 0.2;

/** The Wonder cues the juice and the words play (Wonder spec §3.2, §3.4). */
export const WONDER_CUES = {
  bounce: "sfx.bounce",
  wordPop: "sfx.wordPop",
  streakStep: "sfx.streakStep",
  stamp: "sfx.stamp",
  whoops: "sfx.whoops",
} as const;

/** Survival's lava sizzle (lava spec §5): soft, under a landing, once per dip. */
export const FLOOR_POP_CUE = "ui.pop";

export const SIZZLE_CUE = "sfx.sizzle";
export const SIZZLE_GAIN = 0.35;

/** The landing variant a floor sounds, by its index up the course. */
export const landingCueFor = (floorIndex: number): string =>
  LANDINGS[floorIndex % LANDINGS.length]!;

/** The clash layered under that landing. */
export const clashCueFor = (floorIndex: number): string => CLASHES[floorIndex % CLASHES.length]!;


/** The degree each landing variant was drafted on, in `LANDINGS` order. */
const LANDING_DEGREES = [0, 2, 4] as const;

/**
 * How many scale degrees the landings climb over a whole ascent. Five is the
 * octave: the low-mid-high figure a climb already plays rises with the racer,
 * and the top floor plays it an octave above the first. No further, because
 * a drafted thump sped up past an octave stops sounding like the same thump.
 */
const LADDER_DEGREES = 5;

/**
 * The height the landing-pitch ladder climbs (race-options spec §5.5): an
 * endless course's starting height, so the ladder tops out at floor 50 and
 * holds rather than flattening as the course grows; the course's height else.
 */
export function ladderHeight(snapshot: Pick<RoomSnapshot, "floorCount" | "tuning">): number {
  return snapshot.tuning.RACE_TIME_LIMIT_TICKS > 0 ? snapshot.tuning.COURSE_FLOOR_COUNT : snapshot.floorCount;
}

/**
 * How fast to play a floor's landing so it sounds in the register its height
 * has earned.
 *
 * By the floor's own index rather than a count kept here: a reset puts the
 * racer back on the low floors, so the ladder drops with them, and the same
 * floor sounds the same note on every client. Each variant moves by scale
 * degrees from the one it was drafted on, so the shifted note is still in the
 * scale.
 */
export function landingRateFor(floorIndex: number, floorCount: number | undefined): number {
  if (floorCount === undefined || floorCount < 2) return 1;
  const share = Math.min(1, Math.max(0, floorIndex / (floorCount - 1)));
  const register = Math.min(LADDER_DEGREES, Math.floor(share * (LADDER_DEGREES + 1)));
  const drafted = LANDING_DEGREES[floorIndex % LANDING_DEGREES.length]!;
  return rateFor(semitonesOf(drafted + register) - semitonesOf(drafted));
}

/**
 * How far to either side the race places a sound. Short of the speakers: a
 * racer at the wall should sound off to that side, not inside one ear.
 */
const PAN_WIDTH = 0.55;

/**
 * Where between the speakers a racer at `x` sounds. The camera never follows
 * sideways, so the course's centre is the screen's and this is where on
 * screen the racer is.
 */
export function panFor(x: number | undefined, halfWidth: number | undefined): number {
  if (x === undefined || halfWidth === undefined || halfWidth <= 0) return 0;
  return Math.min(1, Math.max(-1, x / halfWidth)) * PAN_WIDTH;
}

/** How many floors away a racer sounds as far as the mix places anything. */
export const FAR_FLOORS = 6;

/**
 * How far off a racer at height `y` sounds from the player at `localY`, 0 to
 * 1 (`CueOptions.distance`): by floors, above or below alike, so a rival a
 * screen below is heard down there. Near when a height is unknown.
 */
export function distanceFor(y: number | undefined, localY: number | undefined, floorGap: number | undefined): number {
  if (y === undefined || localY === undefined || floorGap === undefined || floorGap <= 0) return 0;
  return Math.min(1, Math.abs(y - localY) / (floorGap * FAR_FLOORS));
}

/**
 * A rival's landing, against the player's own. Low enough that three rivals
 * climbing are a patter to one side rather than rain: the player's own
 * landings are the ones they are timing by.
 */
export const RIVAL_LANDING_SHARE = 0.3;

/**
 * The words' stings, each set against the slam's level by its measured
 * loudness (the audit, Wonder spec §3.4): a word pop sits near the slam, the
 * streak's step under the landings it rides on, a race beat's stamp a little
 * over, and the whoops, the loudest file, well down.
 */
export const WORD_POP_GAIN = 0.6;
export const STREAK_GAIN = 0.3;
export const STAMP_GAIN = 0.65;
export const WHOOPS_GAIN = 0.12;

/** A slam over a landing: one and a half times one, never the full gain it shipped at (Wonder spec §3.2). */
export const SLAM_GAIN = LANDING_GAIN * 1.5;
/** A bounce is the quiet end of the family: half a landing, a rival's a share of that. */
export const BOUNCE_GAIN = LANDING_GAIN * 0.5;

export type JuiceSoundKind = "bounce" | "slam" | "wrap";

/**
 * What the juice's moments sound like. A rival bounces quietly and nothing
 * else: their slams and wraps are seen, not heard, as phase 6 had them.
 */
export function juiceSound(
  kind: JuiceSoundKind,
  facts: { readonly rival: boolean; readonly floorIndex: number; readonly floorCount: number; readonly distance?: number },
): Sound | undefined {
  if (kind === "bounce") {
    return {
      alias: WONDER_CUES.bounce,
      bus: "effects",
      gain: facts.rival ? BOUNCE_GAIN * RIVAL_LANDING_SHARE : BOUNCE_GAIN,
      rate: landingRateFor(facts.floorIndex, facts.floorCount),
      vary: true,
      ...(facts.rival && facts.distance !== undefined ? { distance: facts.distance } : {}),
    };
  }
  if (facts.rival) return undefined;
  return kind === "slam"
    ? { alias: "sfx.slam", bus: "effects", gain: SLAM_GAIN }
    : { alias: "sfx.wrap", bus: "effects", gain: LANDING_GAIN };
}

/**
 * The sounds of one landing: the thump and the blade tap under it, both
 * pitched to the floor's height, placed where the racer is, and varied a
 * little each time. A rival's is the thump alone, quieter.
 */
export function landingSounds(
  floorIndex: number,
  facts: { readonly floorCount?: number; readonly pan?: number; readonly rival?: boolean; readonly distance?: number },
): readonly Sound[] {
  const rate = landingRateFor(floorIndex, facts.floorCount);
  const shared = {
    bus: "effects" as const,
    rate,
    vary: true,
    pan: facts.pan ?? 0,
    ...(facts.distance === undefined ? {} : { distance: facts.distance }),
  };
  if (facts.rival === true) {
    return [{ alias: landingCueFor(floorIndex), ...shared, gain: LANDING_GAIN * RIVAL_LANDING_SHARE }];
  }
  return [
    { alias: landingCueFor(floorIndex), ...shared, gain: LANDING_GAIN },
    // The recorded blade tap under the drafted thump: the thump is in key,
    // the tap is the steel, and the hall rings it out.
    { alias: clashCueFor(floorIndex), ...shared, gain: CLASH_GAIN },
  ];
}

/**
 * The music under the moments that report something.
 *
 * A lap and a reset take a few decibels for as long as they ring, which is
 * what lets them punch rather than sit inside the track. The announcer's lines
 * take the voice bus's own duck (`VOICE_BUS_DUCK` in `audio.ts`), which every
 * voice cue gets. The finish takes everything: a beat of silence with
 * only the fanfare in it, then the music comes back under the call.
 */
const MOMENT_DUCK: MusicDuck = { level: 0.6 };
const FINISH_HIT_STOP: MusicDuck = { level: 0, holdMs: 450, releaseMs: 500 };

/**
 * The finish, paced like the end of a match: the fanfare and the crowd at once,
 * "GAME!" as the fanfare rings, then "the winner is..." and the name, each let
 * finish before the next.
 */
const GAME_AT_MS = 350;
const WINNER_IS_AT_MS = 1_550;
const NAME_AT_MS = 2_700;

/** The final-ascent call, just behind the lap clash rather than on top of it. */
const FINAL_ASCENT_AT_MS = 250;

/**
 * Which sounds an event makes, in the order they layer.
 *
 * `localPlayerId` decides whose events are heard. A landing is a physical fact
 * about one racer and four racers land constantly; sounding all of them turns
 * the mix into rain. The moments that belong to the whole room -- a finish --
 * sound whoever they happened to.
 */
export function cuesForEvent(event: RaceEvent, localPlayerId?: PlayerId, room?: RoomFacts): readonly Cue[] {
  const mine = "playerId" in event && event.playerId === localPlayerId;
  const layer = (alias: string, bus: Bus, extra: Omit<CueOptions, "bus" | "eventId"> = {}): Cue => ({
    alias,
    bus,
    eventId: `${event.id}/${alias}`,
    ...extra,
  });

  switch (event.type) {
    case "floorLanded": {
      // The player's own: deliberately silent here.
      //
      // A landing is the one race event this client can see coming: it
      // predicted it, which is why the racer is already standing on the floor.
      // Sounding it from the confirmation put the impact a round trip after the
      // picture, and sounding both left two transients for one landing. The
      // prediction answers a landing now; see `speculative-contact.ts`.
      //
      // A rival's has nothing to predict, and is heard from here: quietly,
      // from where on the screen they are.
      if (mine || localPlayerId === undefined) return [];
      const rival = room?.players.find((player) => player.id === event.playerId);
      const local = room?.players.find((player) => player.id === localPlayerId);
      return landingSounds(event.floorIndex, {
        ...(room?.floorCount === undefined ? {} : { floorCount: room.floorCount }),
        pan: panFor(rival?.x, room?.halfWidth),
        distance: distanceFor(rival?.y, local?.y, room?.floorGap),
        rival: true,
      }).map(({ alias, ...sound }) => ({ alias, ...sound, eventId: `${event.id}/${alias}` }));
    }
    case "playerReset":
      // A manual reset is a decision and a fall is a loss, and they cost the
      // same ascent: the drafted cue reports the cost, the recorded layer the
      // cause -- a drop into the void, or a swipe drawn back.
      // A fall also slams the music shut: the drop is heard as the world
      // going out from under the racer, then opening again.
      if (!mine) return [];
      return [
        layer("sfx.reset", "effects", { duck: MOMENT_DUCK }),
        layer(event.reason === "fall" ? "sfx.fallOff" : "sfx.rewind", "effects", {
          gain: 0.8,
          ...(event.reason === "fall" ? { muffle: true } : {}),
        }),
      ];
    case "playerOut":
      // Survival's out (survival spec §3) is a fall off the bottom with no way
      // back: the same drop, heard by the racer it happened to.
      if (!mine) return [];
      return [
        layer("sfx.reset", "effects", { duck: MOMENT_DUCK }),
        layer("sfx.fallOff", "effects", { gain: 0.8, muffle: true }),
      ];
    case "lapCompleted": {
      if (!mine) return [];
      const cues = [layer("sfx.lap", "effects", { duck: MOMENT_DUCK }), layer("sfx.lapClash", "effects", { gain: 0.75 })];
      if (room !== undefined && event.lap === room.lapCount - 1) {
        cues.push(layer("vo.finalAscent", "voice", { delayMs: FINAL_ASCENT_AT_MS }));
      }
      return cues;
    }
    case "raceFinished": {
      // The one event that belongs to the room rather than to a racer.
      const cues = [
        layer("sfx.finish", "effects", { duck: FINISH_HIT_STOP }),
        layer("sfx.crowdCheer", "effects", { gain: 0.55, delayMs: 120 }),
        layer("vo.game", "voice", { delayMs: GAME_AT_MS }),
      ];
      const scarf = room?.players.find((player) => player.id === event.winnerId)?.colour;
      if (scarf !== undefined) {
        cues.push(layer("vo.winnerIs", "voice", { delayMs: WINNER_IS_AT_MS }));
        cues.push(layer(SEAT_CALLS[scarf], "voice", { delayMs: NAME_AT_MS }));
      }
      return cues;
    }
  }
}

/** Every cue a batch of events asks for, in the order they happened. */
export function cuesForEvents(
  events: readonly RaceEvent[],
  localPlayerId?: PlayerId,
  room?: RoomFacts,
): readonly Cue[] {
  return events.flatMap((event) => cuesForEvent(event, localPlayerId, room));
}

/**
 * The countdown, called: "Three!", "Two!", "One!", "CLIMB!", a second apart,
 * with CLIMB landing on the start.
 *
 * Scheduled all at once on the graph's clock from however long is left, rather
 * than asked for a number at a time: a snapshot arrives every fifty
 * milliseconds and a frame whenever it can, and neither is a clock a count
 * should keep. A player who joins with a second and a half left hears "One!"
 * and "CLIMB!" on time and nothing already past. `id` names the countdown
 * -- the room and the tick it ends on -- so a replayed snapshot calls it once.
 */
/**
 * How late a number may be and still be called, at once, rather than dropped.
 *
 * The first snapshot of a countdown reaches the client a frame or a round trip
 * after the room started it, so "Three!" is always a little late; dropped for
 * that, every countdown started on "Two!".
 */
const COUNT_LATE_MS = 400;

export function countdownCues(id: string, remainingMs: number): readonly Cue[] {
  const calls = [
    ["vo.three", 3_000],
    ["vo.two", 2_000],
    ["vo.one", 1_000],
  ] as const;
  const cues: Cue[] = [];
  const go = Math.max(0, remainingMs);
  const said = calls.filter(([, before]) => before - remainingMs <= COUNT_LATE_MS);
  said.forEach(([alias, before], index) => {
    const delayMs = Math.max(0, remainingMs - before);
    cues.push({ alias: "sfx.countdown", bus: "effects", eventId: `${id}/${alias}/tick`, gain: 0.6, delayMs });
    // Said late, a number is still speaking when the next is due on its beat:
    // it is cut there, so "Three!" never runs into "Two!".
    const nextAt = index + 1 < said.length ? remainingMs - said[index + 1]![1] : go;
    const late = delayMs > remainingMs - before;
    cues.push({ alias, bus: "voice", eventId: `${id}/${alias}`, delayMs, ...(late ? { maxMs: nextAt - delayMs } : {}) });
  });
  cues.push({ alias: "sfx.countdownGo", bus: "effects", eventId: `${id}/go`, gain: 0.7, delayMs: go });
  cues.push({ alias: "sfx.unsheath", bus: "effects", eventId: `${id}/unsheath`, delayMs: go });
  cues.push({ alias: "vo.climb", bus: "voice", eventId: `${id}/climb`, delayMs: go });
  return cues;
}

/**
 * The bed a stage plays under itself: the one its theme names
 * (`theme.ambienceAlias`), or Rooftops' wind for a stage that names none.
 */
export const bedForStage = (stage: StageContent | undefined): string =>
  stage?.theme.ambienceAlias ?? "ambience.rooftop";

/** The shortest gap between two fast-fall puffs. */
const FAST_FALL_REPEAT_MS = 180;

/**
 * The one thing the mix wants from the input: a fast-fall press, a soft puff
 * of air. On the press rather than while held -- a held fall is one dive --
 * and never twice inside `FAST_FALL_REPEAT_MS`, so a thumb hammering the
 * button is not a buzz. Fed every sample the race takes.
 */
export class FastFallWhoosh {
  private down = false;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly play: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  observe(intent: { readonly fastFall: boolean }): void {
    if (intent.fastFall && !this.down && this.now() - this.lastAt >= FAST_FALL_REPEAT_MS) {
      this.lastAt = this.now();
      this.play();
    }
    this.down = intent.fastFall;
  }
}

/**
 * How a fast-fall sounds; shared by the race and the replay. Under a landing
 * (`LANDING_GAIN`): a press made over and over is a texture, and a bright one
 * wears on the ear long before the race is over.
 */
export const FAST_FALL_CUE = { alias: "sfx.fastFall", gain: 0.3 } as const;

/**
 * Infinite's end, felt: an engine hum under the clock's last
 * `CLIMB_DRONE_ENDLESS_TICKS`, more in the body than the ear.
 *
 * It comes in under the stretch already there (`floor`), swells to full by
 * `fullAt` of the way through it, and bends up to `riseCents` sharp at 0:00,
 * so the last seconds feel like something straining. A best floor survives a
 * fall, so the clock, not the racer's height, drives it (audit remediation
 * D-R1). Only Infinite hums: a finite race keeps its finish clean.
 */
export const CLIMB_DRONE = {
  alias: "ambience.climbDrone",
  floor: 0.45,
  fullAt: 0.6,
  riseCents: 100,
} as const;

/** The stretch of an endless race's clock the hum plays under: its last 30 s. */
export const CLIMB_DRONE_ENDLESS_TICKS = 30 * TICK_HZ;

/**
 * How loud the drone is, in [0, 1], and the rate it plays at, for one racer.
 * `endless` carries the ticks left on an endless race's clock; a finite race
 * passes nothing and stays silent.
 */
export function climbDrone(
  racer: object | undefined,
  endless?: { readonly ticksLeft: number },
): { readonly level: number; readonly rate: number } {
  if (racer === undefined || endless === undefined || endless.ticksLeft > CLIMB_DRONE_ENDLESS_TICKS) {
    return { level: 0, rate: 1 };
  }
  const through = Math.min(1, Math.max(0, 1 - endless.ticksLeft / CLIMB_DRONE_ENDLESS_TICKS));
  return {
    level: CLIMB_DRONE.floor + (1 - CLIMB_DRONE.floor) * Math.min(1, through / CLIMB_DRONE.fullAt),
    rate: 2 ** ((CLIMB_DRONE.riseCents * through * through) / 1200),
  };
}

/**
 * Recovery reminder for a missed floor below; played at most once per ascent.
 */
export const MISSED_FLOOR_CUE = {
  alias: "sfx.floorMissed",
  bus: "effects" as const,
  gain: 0.4,
} as const;

export function missedFloorCue(ascentIndex = 0): Sound & { eventId: string } {
  return {
    alias: MISSED_FLOOR_CUE.alias,
    bus: MISSED_FLOOR_CUE.bus,
    gain: MISSED_FLOOR_CUE.gain,
    eventId: `floorMissed-${ascentIndex}`,
  };
}

export class MissedFloorCueTracker {
  private playedThisAscent = false;
  private ascent = 0;

  observe(newlyMissed: boolean): (Sound & { eventId: string }) | undefined {
    if (newlyMissed && !this.playedThisAscent) {
      this.playedThisAscent = true;
      return missedFloorCue(this.ascent);
    }
    return undefined;
  }

  resetAscent(): void {
    this.playedThisAscent = false;
    this.ascent += 1;
  }

  get hasPlayedThisAscent(): boolean {
    return this.playedThisAscent;
  }
}

export const WALL_SCUFF_CUE = {
  alias: "sfx.wallScuff",
  bus: "effects" as const,
  gain: 0.35,
} as const;

export function wallScuffSound(): Sound {
  return {
    alias: WALL_SCUFF_CUE.alias,
    bus: WALL_SCUFF_CUE.bus,
    gain: WALL_SCUFF_CUE.gain,
  };
}

