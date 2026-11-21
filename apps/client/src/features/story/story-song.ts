/**
 * The first chapter's song, and getting it ready ahead of the story.
 *
 * A whole song takes about 20 s to decode on an iPad (WebKit). The story starts
 * its song with the first frame, so the decode is started while the player is
 * still on the title. If the player gets there first, the music deck plays the
 * song from the network until the decode lands, so it is never silent either
 * way (`SongBridge`).
 */

import { raceSong, type SongLike } from "../audio";
import type { ScreenContext } from "../screen/screen";

/** The song chapter `index` plays: its own, or the race's for a stale artifact that carries no story. */
export function storySongOf(context: Pick<ScreenContext, "content">, index: number): SongLike | undefined {
  const content = context.content.current();
  const authored = (content?.content.story as Partial<{ chapters: readonly { song: SongLike }[] }> | undefined)?.chapters?.[index]?.song;
  return authored ?? raceSong(content, undefined);
}

/**
 * Starts the decode of the first chapter's song for a player who has not been
 * shown how. One who has is unlikely to open the story again, and a whole decoded
 * song is tens of megabytes an iPad needs for the race. Not waited on: a song
 * that will not decode is not a reason to hold the title.
 */
export function warmStorySong(context: Pick<ScreenContext, "content" | "audio" | "settings">): void {
  if (context.settings.value.seen.tutorial) return;
  const song = storySongOf(context, 0);
  if (song === undefined) return;
  void context.audio
    .load(`song-${song.id}`)
    .then(() => context.audio.preload?.(song.audioAlias))
    .catch(() => undefined);
}
