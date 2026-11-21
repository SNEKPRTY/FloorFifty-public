/**
 * The story's feel (story mode v2 spec, "Feel"): each story event, played
 * through the race's own paths -- the juice's dust, hit-stop and kick, the
 * feel layer's shake and punch, and the mixer's cues. No new sound file.
 *
 * The table is the spec's, row for row. Every row also names the cue a player
 * sees with the sound off (`seen`), and the layer and the HUD draw that cue;
 * a test holds each row to it. Under reduced motion the scene drops the
 * shake, the punch, the kick and the hit-stop itself; the dust, the words and
 * the sounds stay.
 */

import type { DustSpec } from "@floor-fifty/shared/content/game-content";
import type { StoryFeelMoment } from "../race/race-scene";
import type { StoryEvent } from "./director";

/** A sound a moment plays. */
export type StoryCue = { readonly alias: string; readonly gain?: number; readonly rate?: number; readonly delayMs?: number };

/** What a player sees of a moment with the sound off. */
export type SeenCue = "glimFlies" | "lampBursts" | "lampBlinks" | "floorsDust" | "rescueBurst" | "safeRing" | "windChip" | "lavaGlow" | "outBanner" | "finishBurst" | "spawnBurst";

export type FeelRow = {
  readonly hitStopMs?: number;
  readonly shake?: number;
  readonly punch?: number;
  readonly kickUnits?: number;
  readonly dust?: DustSpec;
  readonly cues: readonly StoryCue[];
  readonly seen: SeenCue;
};

const GLIM_DUST: DustSpec = { count: 8, spread: 10, rise: 4, lifeMs: 360, sparks: 2 };

/** The spec's feel table. */
export const STORY_FEEL = {
  glim: { dust: GLIM_DUST, cues: [{ alias: "ui.pop" }], seen: "glimFlies" },
  lampOpen: {
    hitStopMs: 60,
    shake: 0.35,
    punch: 0.02,
    kickUnits: 10,
    dust: { count: 24, spread: 28, rise: 9, lifeMs: 560, sparks: 6 },
    cues: [{ alias: "sfx.slam" }, { alias: "sfx.unsheath", delayMs: 90 }],
    seen: "lampBursts",
  },
  lampRattle: { cues: [{ alias: "sfx.wallScuff" }], seen: "lampBlinks" },
  quake: {
    /** A full quake's (strength 1) only: chapter 3's turn. */
    hitStopMs: 80,
    shake: 0.8,
    punch: 0.045,
    dust: { count: 12, spread: 40, rise: 3, lifeMs: 700 },
    cues: [{ alias: "sfx.fallOff", rate: 0.5 }, { alias: "sfx.sizzle", delayMs: 120 }],
    seen: "floorsDust",
  },
  rescue: {
    hitStopMs: 80,
    shake: 0.6,
    punch: 0.045,
    kickUnits: 8,
    dust: { count: 40, spread: 34, rise: 10, lifeMs: 640, ring: true, sparks: 12 },
    cues: [{ alias: "sfx.stamp" }, { alias: "sfx.crowdCheer", gain: 0.2, delayMs: 60 }],
    seen: "rescueBurst",
  },
  safeSpot: { dust: { count: 10, spread: 30, rise: 2, lifeMs: 480, ring: true }, cues: [{ alias: "ui.ready" }], seen: "safeRing" },
  gustWarning: { cues: [{ alias: "sfx.fastFall", rate: 0.5, gain: 0.7 }], seen: "windChip" },
  lavaClose: { shake: 0.15, cues: [{ alias: "sfx.sizzle", gain: 0.6 }], seen: "lavaGlow" },
  caught: { shake: 0.5, cues: [{ alias: "sfx.fallOff" }], seen: "outBanner" },
  done: {
    hitStopMs: 80,
    shake: 0.6,
    punch: 0.045,
    dust: { count: 36, spread: 30, rise: 12, lifeMs: 900, sparks: 10 },
    cues: [{ alias: "sfx.finish" }, { alias: "sfx.crowdCheer", delayMs: 120 }],
    seen: "finishBurst",
  },
  placed: { dust: { count: 14, spread: 18, rise: 6, lifeMs: 420, sparks: 3 }, cues: [], seen: "spawnBurst" },
} as const satisfies Record<string, FeelRow>;

export type FeelKind = keyof typeof STORY_FEEL;

/** `ui.pop` a little higher for each glim in a row (rate 1 + 0.06 a glim, capped at 1.6). */
export const glimRate = (streak: number): number => Math.min(1.6, 1 + 0.06 * Math.max(0, streak - 1));

/** Where the feel plays: the scene's paths, and the mixer. */
export type StoryFeelDeps = {
  readonly play: (moment: StoryFeelMoment) => void;
  readonly cue: (alias: string, options: { gain?: number; rate?: number; delayMs?: number; eventId: string }) => void;
  /** The player's racer now, for a moment with no place of its own. */
  readonly player: () => { readonly x: number; readonly y: number };
  /** The tops of the floors on screen now, for the quake's dust. */
  readonly floorsOnScreen: () => readonly { readonly x: number; readonly y: number }[];
};

/** The feel row a story event plays, or undefined for one that plays none. */
export function feelOf(event: StoryEvent): FeelKind | undefined {
  switch (event.kind) {
    case "glim":
    case "lampOpen":
    case "lampRattle":
    case "quake":
    case "rescue":
    case "safeSpot":
    case "gustWarning":
    case "lavaClose":
    case "caught":
    case "done":
    case "placed":
      return event.kind;
    default:
      return undefined;
  }
}

export class StoryFeel {
  private count = 0;

  constructor(private readonly deps: StoryFeelDeps) {}

  /** Plays one tick's story events. */
  play(events: readonly StoryEvent[]): void {
    for (const event of events) {
      const kind = feelOf(event);
      if (kind === undefined) continue;
      const row: FeelRow = STORY_FEEL[kind];
      const at = "at" in event ? event.at : this.deps.player();
      const key = `story:${(this.count += 1)}`;
      if (kind === "quake") {
        // The whole building shakes: dust off every floor in sight.
        for (const floor of this.deps.floorsOnScreen()) this.deps.play({ at: floor, dust: row.dust! });
        const strength = event.kind === "quake" ? event.strength : 1;
        this.deps.play({ shake: row.shake! * strength, punch: row.punch!, ...(strength >= 1 ? { hitStopMs: row.hitStopMs! } : {}) });
      } else {
        this.deps.play({
          at,
          ...(row.dust === undefined ? {} : { dust: row.dust }),
          ...(row.hitStopMs === undefined ? {} : { hitStopMs: row.hitStopMs }),
          ...(row.kickUnits === undefined ? {} : { kickUnits: row.kickUnits }),
          ...(row.shake === undefined ? {} : { shake: row.shake }),
          ...(row.punch === undefined ? {} : { punch: row.punch }),
        });
      }
      row.cues.forEach((cue, index) => {
        const rate = kind === "glim" && event.kind === "glim" ? glimRate(event.streak) : cue.rate;
        this.deps.cue(cue.alias, {
          eventId: `${key}:${index}`,
          ...(cue.gain === undefined ? {} : { gain: cue.gain }),
          ...(rate === undefined ? {} : { rate }),
          ...(cue.delayMs === undefined ? {} : { delayMs: cue.delayMs }),
        });
      });
    }
  }
}
