/**
 * Assembles the deliverable: the gameplay cut, the transparent accent layer
 * over it, and the audio mixed — the theme as the bed, the game's own SFX and
 * announcer ducked underneath.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const OUT = resolve("evidence/social-2026-10-05");
const FINAL = resolve("docs/media/social/floor-fifty-every-screen.mp4");
const DURATION = "13.32";

await mkdir(resolve("docs/media/social"), { recursive: true });

execFileSync("ffmpeg", [
  "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
  "-i", `${OUT}/cut.mp4`,             // gameplay, and the game's own audio
  "-i", `${OUT}/accent/accent.mov`,   // the transparent graphics layer
  "-i", "TrailerTheme.wav",           // the music bed
  "-filter_complex", [
    "[0:v][1:v]overlay=0:0:format=auto[v]",
    "[0:a]volume=0.55[game]",
    "[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.90[theme]",
    "[game][theme]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]",
  ].join(";"),
  "-map", "[v]", "-map", "[a]",
  "-t", DURATION, "-r", "30",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
  "-movflags", "+faststart",
  FINAL,
]);
console.log(`Wrote ${FINAL}`);
