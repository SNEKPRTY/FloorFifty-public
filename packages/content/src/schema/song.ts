/**
 * A song file.
 *
 * Beat and loop metadata are presentation, not gameplay. Nothing in the
 * simulation reads them, and none of them reaches `rulesetRevision`: music
 * amplifies the climb without judging the player against it, so the same
 * inputs produce the same race whether a song is playing, muted, late to
 * unlock, or absent. `packages/content/src/revisions.ts` is where that
 * partition is actually enforced, and `tests/shared/simulation/music-presentation.test.ts`
 * is what keeps it true.
 *
 * An earlier revision of this comment claimed the opposite -- that every field
 * below the display name fed the ruleset. It never did; the code below it and
 * the hash beside it always agreed with the design, and only the prose was
 * wrong.
 *
 * The loop relationship is checked here rather than in validation because it is
 * a property of the file alone, not of the tree around it.
 */

import { z } from "zod";
import { asContentId } from "@floor-fifty/shared/content/game-content";
import { contentIdSchema } from "./catalog";
import { DISPLAY_NAME_MAX_LENGTH } from "./character";

export const songSchema = z
  .object({
    id: contentIdSchema.transform(asContentId),
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    bpm: z.number().finite().positive(),
    beatOffsetTicks: z.number().int().min(0),
    loopStartMs: z.number().int().min(0),
    loopEndMs: z.number().int().positive(),
    /**
     * The stretch the song step previews (cut to `<id>-preview.m4a` by
     * `pnpm intake:song --preview`) and the unlock banner plays, or nothing.
     * Chosen by ear apart from the results window.
     */
    previewStartMs: z.number().int().min(0).optional(),
    previewEndMs: z.number().int().positive().optional(),
    /**
     * The stretch the results screen plays once, or nothing. Authored as a
     * pair per song: the race loops the song, and the "[name] wins" screen
     * plays this and stops.
     */
    resultsStartMs: z.number().int().min(0).optional(),
    resultsEndMs: z.number().int().positive().optional(),
    audioAlias: z.string().min(1),
    /** The jukebox cover: this alias at 192 px, plus `Large` at 640 px and plus `Full` at 1200 px. */
    coverAlias: z.string().min(1).optional(),
    /** A condition in `unlocks.toml` that earns this song; absent when open. */
    unlock: contentIdSchema.transform(asContentId).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.loopStartMs >= value.loopEndMs)
      ctx.addIssue({
        code: "custom",
        path: ["loopEndMs"],
        message: "must be greater than loopStartMs",
      });
    for (const name of ["preview", "results"] as const) {
      const startKey = `${name}StartMs` as const;
      const endKey = `${name}EndMs` as const;
      const start = value[startKey];
      const end = value[endKey];
      if ((start === undefined) !== (end === undefined))
        ctx.addIssue({
          code: "custom",
          path: [start === undefined ? startKey : endKey],
          message: `${startKey} and ${endKey} are authored together`,
        });
      else if (start !== undefined && end !== undefined && start >= end)
        ctx.addIssue({
          code: "custom",
          path: [endKey],
          message: `must be greater than ${startKey}`,
        });
    }
  });
