/**
 * What the audio tools measure, with ffmpeg and ffprobe: a file's sample
 * peak, its integrated loudness and its length. Shared by `generate-sounds.ts`,
 * which writes a row as it processes a sound, and `measure-audio.ts`, which
 * re-measures the rows every tool wrote (polish spec §8.1).
 */

import { execFileSync } from "node:child_process";

/** Runs a filter to a null sink and returns its report, which ffmpeg writes to stderr. */
function report(input: string, filter: string): string {
  return execFileSync("sh", ["-c", 'ffmpeg -hide_banner -nostats -i "$0" -af "$1" -f null - 2>&1', input, filter], {
    encoding: "utf8",
  });
}

/** The sample peak in dBFS, from `volumedetect`. */
export function peakDb(input: string): number {
  const match = /max_volume: (-?[\d.]+) dB/.exec(report(input, "volumedetect"));
  return match === null ? 0 : Number(match[1]);
}

/** Integrated loudness in LUFS, from `ebur128`. */
export function loudnessLufs(input: string): number {
  // The summary's integrated figure, the last `I:` ebur128 prints.
  const matches = [...report(input, "ebur128").matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  const value = Number(matches.at(-1)?.[1] ?? -70);
  // A clip shorter than one 400 ms gating block has no integrated loudness;
  // the schema wants a real negative number, and the floor is honest.
  return Number.isFinite(value) && value < 0 ? value : -70;
}

/** The file's length in whole milliseconds, from `ffprobe`. */
export function durationMs(input: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) * 1000);
}

/** Two decimal places, as every measured figure in the manifest is written. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;
