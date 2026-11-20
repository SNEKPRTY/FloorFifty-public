/** The songs a lookup reads. Structural, so nothing imports the compiler. */
export type SongCatalog = { content: { songs: readonly SongLike[] } };

/**
 * The race song before the room has chosen one: Chrome in the Rain, the song
 * every race played before the song step. A song added to the catalog ahead
 * of it does not change what such a race plays.
 */
export const FALLBACK_RACE_SONG = "chrome-in-the-rain";

/** A song by ID, or nothing: no content yet, no ID, or an ID the artifact lacks. */
export function songById(content: SongCatalog | undefined, songId: string | undefined): SongLike | undefined {
  if (content === undefined || songId === undefined) return undefined;
  return content.content.songs.find((song) => song.id === songId);
}

/**
 * The song a race plays, from the generated content.
 *
 * Content decides, not this module and not the screen that calls it. The
 * room's song once the song roulette has chosen one; until then, and for an
 * artifact that lacks the room's song, Chrome in the Rain, and failing that
 * the catalog's first. Undefined only with no content or no songs, which is a
 * silent race rather than a broken one.
 */
export function raceSong(content: SongCatalog | undefined, songId: string | undefined): SongLike | undefined {
  return songById(content, songId) ?? songById(content, FALLBACK_RACE_SONG) ?? content?.content.songs[0];
}

/** The fields a caller needs off a song. */
export type SongLike = {
  readonly id: string;
  readonly audioAlias: string;
  readonly bpm: number;
  readonly beatOffsetTicks: number;
  readonly loopStartMs?: number;
  readonly loopEndMs?: number;
  /** The stretch the song step previews and the unlock banner plays; both or neither. */
  readonly previewStartMs?: number | undefined;
  readonly previewEndMs?: number | undefined;
  /** The stretch the results screen plays once; both or neither. */
  readonly resultsStartMs?: number | undefined;
  readonly resultsEndMs?: number | undefined;
};
