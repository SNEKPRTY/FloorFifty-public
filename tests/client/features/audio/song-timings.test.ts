/**
 * Every track the game plays whose beat is known, by alias: the race songs as
 * measured, each song's preview (its preview window, cut to the sample), and
 * the menu theme.
 */

import { describe, expect, it } from "vitest";
import { MENU_MUSIC } from "../../../../apps/client/src/features/audio/menu-cues";
import { MENU_MUSIC_TIMING, songTimings } from "../../../../apps/client/src/features/audio/song-timings";
import { playingSongBeat, songBeatAt } from "../../../../apps/client/src/features/render/music-pulse";

const UNSEEN = { id: "unseen", audioAlias: "music.unseen", bpm: 130.1, beatOffsetTicks: 25,
  previewStartMs: 60_154, previewEndMs: 76_154, resultsStartMs: 141_077, resultsEndMs: 157_077 };
const NO_RESULTS = { id: "plain", audioAlias: "music.plain", bpm: 120, beatOffsetTicks: 0 };

describe("the song timings", () => {
  it("has each race song as measured, and the menu theme", () => {
    const timings = songTimings([UNSEEN, NO_RESULTS]);
    expect(timings.get("music.unseen")).toEqual({ bpm: 130.1, beatOffsetTicks: 25 });
    expect(timings.get("music.plain")).toEqual({ bpm: 120, beatOffsetTicks: 0 });
    expect(timings.get(MENU_MUSIC)).toEqual(MENU_MUSIC_TIMING);
  });

  it("puts a preview on its song's beat: its first moment is the song at its preview window", () => {
    const preview = songTimings([UNSEEN]).get("music.unseenPreview")!;
    const song = songTimings([UNSEEN]).get("music.unseen")!;
    expect(songBeatAt(0, preview).beat).toBeCloseTo(songBeatAt(60_154, song).beat, 6);
    expect(songBeatAt(5_000, preview).beat).toBeCloseTo(songBeatAt(65_154, song).beat, 6);
  });

  it("has no preview for a song with no preview window, which has no clip, results window or not", () => {
    expect(songTimings([NO_RESULTS]).has("music.plainPreview")).toBe(false);
    const { previewStartMs: _s, previewEndMs: _e, ...resultsOnly } = UNSEEN;
    expect(songTimings([resultsOnly]).has("music.unseenPreview")).toBe(false);
  });
});

describe("the playing song's beat", () => {
  it("is the beat of whatever plays, where its timing is known", () => {
    const timings = songTimings([UNSEEN]);
    const playing = (alias: string, ms: number) => ({ nowPlaying: () => ({ alias, ms }) });
    expect(playingSongBeat(playing("music.unseen", 1_000), timings)).toEqual(songBeatAt(1_000, timings.get("music.unseen")!));
    expect(playingSongBeat(playing("music.unknown", 1_000), timings)).toBeUndefined();
    expect(playingSongBeat({ nowPlaying: () => undefined }, timings)).toBeUndefined();
    expect(playingSongBeat({}, timings)).toBeUndefined();
  });
});
