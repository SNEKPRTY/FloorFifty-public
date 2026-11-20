/**
 * `pnpm assets:sounds [alias...]`.
 *
 * Generates the recorded sound set from `sound-prompts.ts`, processes it for
 * the mixer, and writes each file's measured facts into the art manifest.
 *
 * Two stages, kept apart because only the first costs money:
 *
 * 1. **Generate.** Each prompt is sent to ElevenLabs once and its MP3 kept
 *    under `assets/source/sounds/`. A source already there is not asked for
 *    again unless named on the command line -- which is how a rejected take is
 *    retried without paying for the thirty that were kept.
 * 2. **Process.** Every source goes through ffmpeg into `assets/production/`:
 *    leading silence cut so the transient lands on the frame it is asked for,
 *    peak-normalised to -1 dBFS, a few milliseconds of fade at the tail, 48 kHz
 *    mono 16-bit WAV. An announcer line that asks for it has its tail slowed
 *    (`stretchTail`), pitch kept. The looping beds stay stereo and go to AAC,
 *    because each is twenty seconds long and a codec's priming is inaudible
 *    under wind. Then its length and loudness are measured and the manifest row rewritten from them.
 *
 * Requires `ELEVENLABS_API_KEY` (or `ELEVENLAB_API_KEY`) in the environment or
 * `.env.local`, and `ffmpeg`/`ffprobe` on the path. Nothing in a build runs it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { durationMs, loudnessLufs, peakDb, round2 } from "./audio-measure";
import {
  ANNOUNCER_VOICE_ID,
  SOUND_PROMPTS,
  readElevenLabsKey,
  soundRequest,
  type SoundPrompt,
} from "./sound-prompts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const ASSETS = resolve(import.meta.dirname, "..", "assets");
const SOURCE = resolve(ASSETS, "source", "sounds");
const MANIFEST = resolve(ASSETS, "art-manifest.json");
const RATE = 48_000;
const CONCURRENCY = 4;

const isBed = (prompt: SoundPrompt): boolean => prompt.kind === "effect" && prompt.loop === true;
const sourceFile = (prompt: SoundPrompt): string => resolve(SOURCE, `${prompt.file}.mp3`);
const productionFile = (prompt: SoundPrompt): string =>
  `production/sounds/${prompt.file}.${isBed(prompt) ? "m4a" : "wav"}`;

async function generate(prompt: SoundPrompt, key: string): Promise<void> {
  const { path, body } = soundRequest(prompt);
  const response = await fetch(`https://api.elevenlabs.io/v1${path}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${prompt.alias}: ${response.status} ${await response.text()}`);
  const out = sourceFile(prompt);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  process.stdout.write(`  generated ${prompt.alias}\n`);
}

const ffmpeg = (...args: string[]): string =>
  execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Source to production file; see the module note for the chain. */
function processSound(prompt: SoundPrompt): string {
  const input = sourceFile(prompt);
  const file = productionFile(prompt);
  const output = resolve(ASSETS, file);
  mkdirSync(dirname(output), { recursive: true });

  if (isBed(prompt)) {
    // A seamless loop keeps every sample: trimming either end is a seam.
    ffmpeg("-y", "-i", input, "-af", "loudnorm=I=-26:TP=-2", "-ar", String(RATE), "-ac", "2", "-c:a", "aac", "-b:a", "128k", output);
    return file;
  }

  const trimmed = resolve(SOURCE, `${prompt.file}.trimmed.wav`);
  ffmpeg("-y", "-i", input, "-af", "silenceremove=start_periods=1:start_threshold=-50dB", "-ar", String(RATE), "-ac", "1", trimmed);
  if (prompt.kind === "line" && prompt.stretchTail !== undefined) {
    // Split where the held word starts and slow only that, so the head of the
    // line keeps its punch and the vowel drags.
    const { fromMs, tempo } = prompt.stretchTail;
    const at = (fromMs / 1000).toFixed(3);
    const stretched = resolve(SOURCE, `${prompt.file}.stretched.wav`);
    ffmpeg(
      "-y", "-i", trimmed,
      "-filter_complex",
      `[0:a]asplit[a][b];[a]atrim=end=${at}[head];[b]atrim=start=${at},asetpts=PTS-STARTPTS,atempo=${tempo}[tail];[head][tail]concat=n=2:v=0:a=1`,
      "-ar", String(RATE), "-ac", "1", stretched,
    );
    execFileSync("mv", ["-f", stretched, trimmed]);
  }
  const gain = -1 - peakDb(trimmed);
  const length = durationMs(trimmed) / 1000;
  const fade = Math.min(0.03, length / 4);
  ffmpeg(
    "-y", "-i", trimmed,
    "-af", `volume=${gain.toFixed(2)}dB,afade=t=out:st=${Math.max(0, length - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
    "-ar", String(RATE), "-ac", "1", "-c:a", "pcm_s16le", output,
  );
  execFileSync("rm", ["-f", trimmed]);
  return file;
}

type ManifestRow = Record<string, unknown> & { alias: string };

function manifestRow(prompt: SoundPrompt, file: string): ManifestRow {
  const path = resolve(ASSETS, file);
  const bed = isBed(prompt);
  const length = durationMs(path);
  const described =
    prompt.kind === "line"
      ? `ElevenLabs text-to-speech, voice ${ANNOUNCER_VOICE_ID} (Brian), announcer read: "${prompt.text}"`
      : `ElevenLabs sound generation, ${prompt.seconds}s at prompt influence ${prompt.influence}${bed ? ", seamless loop" : ""}: "${prompt.prompt}"`;
  return {
    role: "audio",
    alias: prompt.alias,
    file,
    codec: bed ? 'audio/mp4; codecs="mp4a.40.2"' : "audio/wav",
    sampleRate: RATE,
    channels: bed ? 2 : 1,
    durationMs: length,
    loudnessLufs: round2(loudnessLufs(path)),
    // Measured on the file that ships, after the gain and the fade.
    peakDbfs: round2(peakDb(path)),
    ...(bed ? { loopStartMs: 0, loopEndMs: length } : {}),
    provenance: {
      tool: "packages/asset-contract/tools/generate-sounds.ts",
      prompt: described,
      source: `Generated as assets/source/sounds/${prompt.file}.mp3, then cut, normalised and resampled by the same tool.`,
      license: "Generated on ElevenLabs by the project owner under a plan that grants commercial use.",
    },
  };
}

/** Rewrites each generated row in the audio bundle, in place or appended. */
function writeManifest(rows: readonly ManifestRow[]): void {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { bundles: { audio: ManifestRow[] } };
  for (const row of rows) {
    const index = manifest.bundles.audio.findIndex((existing) => existing.alias === row.alias);
    if (index === -1) manifest.bundles.audio.push(row);
    else manifest.bundles.audio[index] = row;
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  const wanted = new Set(process.argv.slice(2));
  const unknown = [...wanted].filter((alias) => !SOUND_PROMPTS.some((prompt) => prompt.alias === alias));
  if (unknown.length > 0) throw new Error(`no sound named ${unknown.join(", ")}`);

  const queue = SOUND_PROMPTS.filter(
    (prompt) => wanted.has(prompt.alias) || (wanted.size === 0 && !existsSync(sourceFile(prompt))),
  );
  if (queue.length > 0) {
    const envPath = resolve(ROOT, ".env.local");
    const key = readElevenLabsKey(process.env, existsSync(envPath) ? readFileSync(envPath, "utf8") : undefined);
    if (key === undefined) throw new Error("ELEVENLABS_API_KEY is not set (environment or .env.local)");
    process.stdout.write(`generating ${queue.length} sources:\n`);
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await generate(next, key);
    });
    await Promise.all(workers);
  }

  process.stdout.write("processing:\n");
  const rows = SOUND_PROMPTS.filter((prompt) => existsSync(sourceFile(prompt))).map((prompt) => {
    const row = manifestRow(prompt, processSound(prompt));
    process.stdout.write(`  ${prompt.alias.padEnd(20)} ${String(row["durationMs"]).padStart(6)} ms ${row["loudnessLufs"]} LUFS\n`);
    return row;
  });
  writeManifest(rows);
  process.stdout.write(`wrote ${rows.length} rows into art-manifest.json\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
