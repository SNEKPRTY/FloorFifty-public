/**
 * The pop-up words as the player's language says them, and the face each is
 * set in (Wonder spec §5.1, §5.2).
 */

import type { WordsTuning } from "@floor-fifty/shared/content/game-content";
import { FONT_WORDMARK, fontUiFor } from "../../i18n/fonts";
import type { LocaleTag } from "../../i18n/locales";
import * as m from "../../../paraglide/messages.js";
import { ordinal } from "../hud-model";

export type WordKind =
  | "slam"
  | "streak"
  | "skip"
  | "pass"
  | "lead"
  | "lap"
  | "finalAscent"
  | "lastFloor"
  | "place"
  | "whoops"
  | "back";

export type WordSpec = {
  readonly kind: WordKind;
  /** The streak's floors in a row. */
  readonly count?: number;
  /** The lap being started. */
  readonly lap?: number;
  /** The finishing place, from 1. */
  readonly place?: number;
};

/** The face a word is set in: its stack, its weight, and whether it slants. */
export type WordFace = { readonly family: string; readonly weight: "900" | "600"; readonly skew: boolean };

const CJK: ReadonlySet<LocaleTag> = new Set<LocaleTag>(["ja", "ko", "zh-Hans"]);

/** A word as the player's language says it. */
export function wordText(word: WordSpec, words: WordsTuning): string {
  switch (word.kind) {
    case "slam":
      return m.race_word_slam();
    case "streak": {
      const count = word.count ?? 0;
      if (count >= words.greatFrom) return m.race_word_streak_great({ count });
      if (count >= words.niceFrom) return m.race_word_streak_nice({ count });
      return m.race_word_streak({ count });
    }
    case "skip":
      return m.race_word_skip();
    case "pass":
      return m.race_word_pass();
    case "lead":
      return m.race_word_lead();
    case "lap":
      return m.race_word_lap({ lap: word.lap ?? 2 });
    case "finalAscent":
      return m.race_word_final_ascent();
    case "lastFloor":
      return m.race_word_last_floor();
    case "place":
      return word.place === 1 ? m.race_word_lead() : ordinal(word.place ?? 0);
    case "whoops":
      return m.race_word_whoops();
    case "back":
      return m.race_word_back();
  }
}

/**
 * Fraunces at 900, slanted, for Latin; upright Fusion Pixel at 600 for CJK, which has
 * no italic and reads a slanted ideograph as a mistake (Wonder spec §5.1).
 */
export function wordFont(locale: LocaleTag): WordFace {
  return CJK.has(locale)
    ? { family: fontUiFor(locale), weight: "600", skew: false }
    : { family: FONT_WORDMARK, weight: "900", skew: true };
}
