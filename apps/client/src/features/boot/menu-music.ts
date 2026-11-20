/**
 * The menu track the splash, the title and the lobby share.
 *
 * Claimed through the carry-over, as the backdrop is, so moving between them
 * keeps the song where it was rather than starting it over. The splash claims
 * it first, so the song is already going -- or downloaded and waiting in
 * memory for the player's first touch -- by the time the title appears.
 *
 * The first time it plays it starts at `MENU_MUSIC_START_MS`; after that it
 * resumes wherever it was when it last stopped.
 *
 * Most browsers will not start sound before a gesture, and nothing here can
 * make them. On a fresh page the song starts at once where autoplay is
 * allowed, and otherwise on the first touch or key -- the splash's skip, if
 * the player takes it. Back from a race the graph is running and it starts
 * at once.
 *
 * Letting go stops only this track. The lobby hands over to the race, and the
 * carry-over settles after the race has entered, by which time the race has
 * started its own song in the same slot -- a plain stop would silence it.
 *
 * The menu's ambient bed is claimed apart (`claimMenuBed`), by the title and
 * the lobby but not the splash: the splash is the song alone.
 */

import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { DEFAULT_GAINS, MUSIC_CUTOFF_OPEN_HZ } from "../audio";
import { MENU_BED, MENU_BED_GAIN, MENU_MUSIC } from "../audio/menu-cues";
import { songTimings } from "../audio/song-timings";
import { playingSongBeat, type SongBeat } from "../render/music-pulse";
import type { ScreenContext } from "../screen/screen";

export { MENU_MUSIC };

/**
 * Where the song first starts: 3:40, the point the title is meant to open
 * on. Only the first pass starts here; the loop runs the whole file, so the
 * second pass begins at the top.
 */
export const MENU_MUSIC_START_MS = 220_000;

const NO_SONGS: readonly never[] = [];

/**
 * Where the menu's music is in its beats: the theme, a song's preview in the
 * song step, or a song's opening at its reveal. Undefined while nothing plays
 * whose beat is known.
 */
export const menuSongBeat = (context: Pick<ScreenContext, "audio" | "content">): SongBeat | undefined =>
  playingSongBeat(context.audio, songTimings(context.content.current()?.content.songs ?? NO_SONGS));

/** The select steps whose own audio holds the music slot: the previews, the song's opening, the song loading. */
const SONG_STEPS: ReadonlySet<string> = new Set(["song", "songReveal", "loading"]);

/**
 * Whether the menu theme must stay quiet: the room is in the song step or
 * after it, the stage countdown included. The first preview ends the theme
 * (spec §6.4); a claim made again by a reload must not start it under the
 * preview, nor for the moment before the Lobby hands the count to the race
 * (race-flow spec §3).
 */
export function menuMusicQuiet(snapshot: RoomSnapshot | undefined): boolean {
  if (snapshot?.phase === "countdown") return true;
  return snapshot?.phase === "select" && snapshot.select !== undefined && SONG_STEPS.has(snapshot.select.step);
}

/** The events a browser may count as the gesture that lets sound start. */
const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

export function claimMenuMusic(context: ScreenContext): () => void {
  const lease = context.carryOver.claim("menu-music", () => {
    const { audio } = context;
    let stopped = false;

    // Asked for at once, not on a gesture. Where the browser allows sound
    // without one -- a site the player uses, an installed app -- this is what
    // starts the song under the splash. Where it does not, it still builds the
    // graph, and the song (downloaded whole by the splash and played from
    // memory, `MenuStream`) waits there, so the first touch or key only has
    // to resume it.
    //
    // Settles only once the graph is running -- a resume the browser refuses
    // stays pending until one it honours -- so that is when listening ends.
    const unlock = (): void =>
      void audio
        .unlock()
        .then(removeGesture)
        .catch(() => undefined);

    // Unlocked on a gesture as well, from inside it, which is the one call a
    // browser that blocks autoplay will honour. Every gesture asks, not just
    // the first: which events count differs by browser -- Chrome on a phone
    // ignores a touch's `pointerdown` and honours its `pointerup` -- and one
    // that did not count must not use up the only ask.
    const onGesture = (): void => unlock();
    const removeGesture = (): void => {
      for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
    };
    // Capture, so a control that stops propagation still counts as the gesture.
    for (const type of GESTURES) window.addEventListener(type, onGesture, true);
    unlock();

    // Played once the manifest is in: an alias asked for before it resolves
    // names no file, and stays silent. The song itself may still be arriving
    // (the splash's download); it starts the moment its bytes are in, from
    // this offset. A graph still waiting for its gesture holds it at its
    // first sample until then.
    void audio
      .load("audio")
      .catch(() => undefined)
      .then(() => {
        if (stopped || menuMusicQuiet(context.network.latestSnapshot())) return;
        // The race closes the music's filter with its momentum and leaves it
        // wherever the finish was; the menu plays open, at the mix's own level.
        audio.setMusicGain(DEFAULT_GAINS.music);
        audio.setMusicCutoff(MUSIC_CUTOFF_OPEN_HZ);
        // Where it was when the race took the slot, so coming back to the
        // menu carries on the song rather than starting it again.
        audio.play(MENU_MUSIC, audio.positionOf(MENU_MUSIC) ?? MENU_MUSIC_START_MS);
      });

    return {
      destroy: () => {
        stopped = true;
        removeGesture();
        audio.stop(MENU_MUSIC);
      },
    };
  });
  return lease.release;
}

/**
 * Night air under the song, from the title on and carried across the menus
 * as the song is. Letting go stops only this bed, by name: the race's may
 * already hold the slot.
 */
export function claimMenuBed(context: ScreenContext): () => void {
  const lease = context.carryOver.claim("menu-bed", () => {
    const { audio } = context;
    let stopped = false;
    // After the manifest, for the same reason as the song.
    void audio
      .load("audio")
      .catch(() => undefined)
      .then(() => {
        if (!stopped) audio.playBed?.(MENU_BED, MENU_BED_GAIN);
      });
    return {
      destroy: () => {
        stopped = true;
        audio.stopBed?.(MENU_BED);
      },
    };
  });
  return lease.release;
}
