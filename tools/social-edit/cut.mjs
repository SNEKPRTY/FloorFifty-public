/**
 * Builds the gameplay cut: one 9:16 punch-in per shot, black filler for the
 * gaps, joined into a single stream exactly the length of the accent layer's
 * timeline.
 *
 * Every segment is emitted at an exact whole number of frames, because the
 * concat demuxer cannot split a frame: rounded-up segments drift, and half a
 * second of drift puts the graphics out of step with the picture they sit on.
 * The boundaries in `shots.json` and `timeline.json` are all whole frames at
 * 30 fps (0.40, 2.60, 5.00, 12.50, 13.32), so nothing is lost by rounding.
 *
 * A shot names a take and a moment inside it either as `frac` (a share of the
 * take) or `fromEnd` (seconds back from the finish) — fractions rather than
 * seconds, because a take is a whole race and its length varies with the mode.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const OUT = resolve("evidence/social-2026-10-05");
const RAW = `${OUT}/raw`;
const plan = JSON.parse(await readFile("tools/social-edit/shots.json", "utf8"));
const W = plan.shotWidth;
const FPS = plan.fps;
const toFrames = (seconds) => Math.round(seconds * FPS);

await mkdir(`${OUT}/shots`, { recursive: true });

const durationOf = (path) =>
  Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], {
      encoding: "utf8",
    }),
  );

/** Locates a shot's take: `raw/<take>.<ext>`, whichever container it recorded in. */
function takeOf(name) {
  for (const ext of ["mp4", "webm"]) {
    const path = `${RAW}/${name}.${ext}`;
    try {
      durationOf(path);
      return path;
    } catch {
      // Try the next container.
    }
  }
  throw new Error(`no take for ${name}`);
}

/** A shot's in point in its take: a fraction of it, or seconds back from the end. */
function startOf(shot, duration) {
  if (shot.fromEnd !== null && shot.fromEnd !== undefined) {
    return Math.max(0, duration - shot.for - shot.fromEnd);
  }
  const centred = shot.frac * duration - shot.for / 2;
  return Math.min(Math.max(0, centred), Math.max(0, duration - shot.for));
}

/** A silent black segment of exactly `frames`, so the timeline stays 1:1. */
function filler(frames, out) {
  const seconds = frames / FPS;
  execFileSync("ffmpeg", [
    "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=black:s=1080x1920:r=${FPS}:d=${seconds}`,
    "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${seconds}`,
    "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest", out,
  ]);
}

const shots = [...plan.shots].sort((a, b) => a.at - b.at);
const gameplayEnd = toFrames(plan.gameplayEnd);
const total = toFrames(plan.duration);
const parts = [];
// The position actually reached by the frames already emitted, not the shot's
// nominal `at`: rounding a shot's length up moves everything after it, and the
// tail must be sized against what really happened or the cut misses the
// accent layer's 400-frame timeline.
let running = 0;

for (const [index, shot] of shots.entries()) {
  const atFrames = toFrames(shot.at);
  const shotFrames = toFrames(shot.for);
  if (atFrames + shotFrames > gameplayEnd) throw new Error(`shot ${index} runs past the gameplay window`);
  const gapFrames = Math.max(0, atFrames - running);
  if (gapFrames > 0) {
    const gap = `${OUT}/shots/gap-${index}.mp4`;
    filler(gapFrames, gap);
    parts.push(gap);
  }
  const take = takeOf(shot.take);
  const duration = durationOf(take);
  const start = startOf(shot, duration);
  const out = `${OUT}/shots/${String(index).padStart(2, "0")}.mp4`;
  // The crop walks from x0 to x1 across the shot, so the action stays in frame.
  const crop = shot.x0 === shot.x1
    ? `crop=${W}:1080:${shot.x0}:0`
    : `crop=${W}:1080:'${shot.x0}+(${shot.x1}-${shot.x0})*t/${shot.for}':0`;
  execFileSync("ffmpeg", [
    "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(start), "-t", String(shotFrames / FPS), "-i", take,
    "-vf", `${crop},scale=1080:1920:flags=lanczos,setsar=1,fps=${FPS}`,
    "-frames:v", String(shotFrames),
    "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", out,
  ]);
  parts.push(out);
  running += gapFrames + shotFrames;
  console.log(
    `shot ${String(index).padStart(2, "0")}  ${shot.take}  from ${start.toFixed(2)}s of ${duration.toFixed(1)}s  ->  frame ${running - shotFrames}  (${shotFrames} frames)`,
  );
}

if (running > total) throw new Error(`the cut is ${running} frames, past the ${total}-frame timeline`);
if (total > running) {
  const tail = `${OUT}/shots/tail.mp4`;
  filler(total - running, tail);
  parts.push(tail);
}

const listing = `${OUT}/shots/list.txt`;
await writeFile(listing, parts.map((part) => `file '${part}'\n`).join(""));
execFileSync("ffmpeg", [
  "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", `${OUT}/cut.mp4`,
]);
console.log(`Cut ${shots.length} shots into ${OUT}/cut.mp4 — ${total} frames, ${running} filled`);
