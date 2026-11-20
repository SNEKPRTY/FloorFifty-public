/**
 * The ready room's race options, read from the catalog's modes
 * (race-options spec §3.4). Labels only: whether a choice is allowed is the
 * room's to say, and the row shows the room's answer.
 */

import type { LapCount } from "@floor-fifty/shared/common/ids";
import type { ModeContent } from "@floor-fifty/shared/content/game-content";
import { modeName as localisedModeName } from "../i18n/content";
import * as m from "../../paraglide/messages.js";

export type FloorsChoice = { id: string; label: string; name: string; icon?: "stopwatch"; badge?: string };

/** The lap counts the room's default mode offers, before a catalog has loaded. */
const DEFAULT_LAPS: readonly LapCount[] = [1, 3];

export function floorsChoices(modes: readonly ModeContent[]): FloorsChoice[] {
  return modes.map((mode) => {
    const name = localisedModeName(mode);
    return {
      id: mode.id,
      // Survival is the default mode, so it shows its name beside the stopwatch and a Featured badge; a sighted
      // player used to read "Floors: (clock) FEATURED / 20 / 50" and never its name (audit S19). The badge is a
      // message, set in capitals by the stylesheet.
      ...(mode.course === "endless"
        ? { label: name, icon: "stopwatch" as const, badge: m.ready_mode_featured() }
        : { label: String(mode.tuning.COURSE_FLOOR_COUNT ?? 20) }),
      name,
    };
  });
}


/** The clocks the selected mode offers, in seconds; none on a finite mode (survival spec §5). */
export function clockChoicesFor(modes: readonly ModeContent[], modeId: string | undefined): readonly number[] {
  return modes.find((mode) => mode.id === modeId)?.clocks ?? [];
}

/**
 * A clock choice as the ready room shows it: whole minutes, under a Minutes
 * label, so the row is as narrow as the Laps row it stands in for and the
 * options still fit beside Floors on one line; m:ss for a part minute.
 */
export function formatClockChoice(seconds: number): string {
  if (seconds % 60 === 0) return String(seconds / 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The lap counts the selected mode offers. Before any catalog has loaded the
 * room is on its default mode, which offers both; a mode the loaded catalog
 * does not know offers one, as the room's own check does.
 */
export function lapChoicesFor(modes: readonly ModeContent[], modeId: string | undefined): readonly LapCount[] {
  if (modes.length === 0) return DEFAULT_LAPS;
  return modes.find((mode) => mode.id === modeId)?.laps ?? [1];
}
