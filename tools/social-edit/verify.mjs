/**
 * Verifies the deliverable: its shape, its loudness, that no app code moved,
 * and a contact sheet for a human to look at.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILE = resolve("docs/media/social/floor-fifty-every-screen.mp4");
const QA = resolve("evidence/social-2026-10-05/qa");
await mkdir(QA, { recursive: true });

const probe = JSON.parse(
  execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", FILE], { encoding: "utf8" }),
);
const video = probe.streams.find((s) => s.codec_type === "video");
const audio = probe.streams.find((s) => s.codec_type === "audio");
const duration = Number(probe.format.duration);
const [num, den] = video.r_frame_rate.split("/").map(Number);
const fps = num / den;

const problems = [];
if (video.width !== 1080 || video.height !== 1920) problems.push(`size ${video.width}x${video.height}`);
if (Math.abs(fps - 30) > 0.05) problems.push(`fps ${video.r_frame_rate}`);
if (audio === undefined) problems.push("no audio stream");
if (Math.abs(duration - 13.32) > 0.05) problems.push(`duration ${duration}`);

// The hard constraint: nothing under apps/ or packages/ may have moved.
const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "apps", "packages"], { encoding: "utf8" }).trim();
if (changed !== "") problems.push(`app code changed: ${changed}`);

// Loudness, for the record. ffmpeg reports to stderr, not stdout.
const { stderr } = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-i", FILE, "-af", "ebur128=peak=true", "-f", "null", "-"],
  { encoding: "utf8" },
);
const loud = stderr
  .split("\n")
  .filter((line) => /^\s+(I|Peak):/.test(line))
  .slice(-2)
  .join(" ")
  .trim();
await writeFile(`${QA}/loudness.txt`, loud + "\n");

// A contact sheet, to be looked at by a human.
execFileSync("ffmpeg", [
  "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
  "-i", FILE, "-vf", "fps=2,scale=180:-1,tile=6x5", "-frames:v", "1", `${QA}/contact-sheet.png`,
]);

if (problems.length > 0) {
  console.error("FAIL", problems);
  process.exit(1);
}
console.log(`PASS ${duration.toFixed(2)}s ${video.width}x${video.height} ${fps}fps`);
console.log(`loudness: ${loud}`);
