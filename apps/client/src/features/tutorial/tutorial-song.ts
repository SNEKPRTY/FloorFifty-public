/**
 * The tutorial's song, and getting it ready ahead of the tutorial.
 *
 * A whole song takes about 20 s to decode on an iPad (WebKit). The tutorial
 * starts its song with the first frame, so the decode is started while the
 * player is still on the title. If the player gets there first, the music deck
 * plays the song from the network until the decode lands, so it is never
 * silent either way (`SongBridge`).
 */

import { raceSong, type SongLike } from "../audio";
import type { ScreenContext } from "../screen/screen";

/**
 * The song the tutorial plays: its own, or the race's for a stale artifact
 * whose tutorial carries none.
 */
export function tutorialSongOf(context: Pick<ScreenContext, "content">): SongLike | undefined {
  const content = context.content.current();
  const authored = content?.content.tutorial as Partial<{ song: SongLike }> | undefined;
  return authored?.song ?? raceSong(content, undefined);
}

/**
 * Starts the decode of the tutorial's song for a player who has not done the
 * tutorial. One who has is unlikely to open it again, and a whole decoded song
 * is tens of megabytes an iPad needs for the race. Not waited on: a song that
 * will not decode is not a reason to hold the title.
 */
export function warmTutorialSong(context: Pick<ScreenContext, "content" | "audio" | "settings">): void {
  if (context.settings.value.seen.tutorial) return;
  const song = tutorialSongOf(context);
  if (song === undefined) return;
  void context.audio
    .load(`song-${song.id}`)
    .then(() => context.audio.preload?.(song.audioAlias))
    .catch(() => undefined);
}
