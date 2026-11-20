/**
 * Every track the game plays whose beat is known, by alias, so whatever is
 * sounding can be kept time to: the race songs, as `pnpm intake:song`
 * measured them; each song's preview, which is its preview window cut to the
 * sample, so it is on its song's beat shifted by where that window starts;
 * and the menu theme.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { SongLike } from "./";
import { MENU_MUSIC } from "./menu-cues";

/** A track's tempo, and its first beat in ticks from the start of its file. */
export type SongTiming = { readonly bpm: number; readonly beatOffsetTicks: number };

/**
 * The theme's tempo and first beat, measured from its master
 * (`FloorFifty Theme Remastered.wav`) by the intake's own method
 * (`packages/asset-contract/tools/beat-grid.ts`), which gives the race songs
 * theirs. Steady across the whole file: the heard kicks sit on the same phase
 * of it in every minute.
 */
export const MENU_MUSIC_TIMING: SongTiming = { bpm: 131, beatOffsetTicks: 15 };

type TimedSong = Pick<SongLike, "audioAlias" | "bpm" | "beatOffsetTicks" | "previewStartMs">;

const cache = new WeakMap<readonly TimedSong[], ReadonlyMap<string, SongTiming>>();

/** The timings of `songs`, their previews and the menu theme, by alias. */
export function songTimings(songs: readonly TimedSong[]): ReadonlyMap<string, SongTiming> {
  const cached = cache.get(songs);
  if (cached !== undefined) return cached;
  const timings = new Map<string, SongTiming>([[MENU_MUSIC, MENU_MUSIC_TIMING]]);
  for (const song of songs) {
    timings.set(song.audioAlias, { bpm: song.bpm, beatOffsetTicks: song.beatOffsetTicks });
    if (song.previewStartMs !== undefined) {
      timings.set(`${song.audioAlias}Preview`, {
        bpm: song.bpm,
        beatOffsetTicks: song.beatOffsetTicks - (song.previewStartMs * TICK_HZ) / 1000,
      });
    }
  }
  cache.set(songs, timings);
  return timings;
}
