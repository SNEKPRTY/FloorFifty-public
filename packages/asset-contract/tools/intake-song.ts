/**
 * Song intake (stage, song and character select spec §8). `intake-song-cli.ts`
 * is the command; this module is what it runs, importable by tests.
 *
 *   pnpm intake:song <master.wav> <id> --title <title> [--unlock <condition>] [--force] [--reencode]
 *   pnpm intake:song <master.wav> <id> --preview
 *   pnpm intake:song <master.wav> <id> --propose
 *
 * Takes a master from `_CommericalSongs/` and:
 * - refuses anything but a 48 kHz stereo WAV;
 * - encodes the shipped m4a (AAC-LC, 256 kbps average bitrate at the
 *   encoder's best quality, the smallest file at that rate) with `afconvert`; an m4a
 *   already in place is kept unless `--reencode`;
 * - decodes the m4a back and refuses it unless it has the master's frame
 *   count at zero sample offset, so the measurements below describe the file
 *   that ships (the check the slice review made for Chrome in the Rain);
 * - measures integrated loudness (`loudness.ts`), tempo and first beat
 *   (`beat-grid.ts`) from the master;
 * - writes `content/songs/<id>.toml` with a whole-file loop (the owner's
 *   choice for Chrome in the Rain, 2026-09-24) and no preview or results
 *   window, which are chosen by ear and written by hand;
 * - upserts the song's audio row in the `song-<id>` bundle;
 * - prints proposed windows, each moved onto a beat: a results window, the
 *   loudest 16 s, and a preview window, the loudest 16 s clear of it.
 *
 * `afconvert` is macOS-only, so the intake runs on the Mac.
 *
 * A TOML someone has edited -- its intake hash no longer matches -- is never
 * overwritten without `--force`.
 *
 * `--preview` runs after the preview window is written: it cuts that window
 * from the master, encodes `<id>-preview.m4a`, checks it the same way, and
 * upserts `music.<camel>Preview` in the `shell` bundle. The song step previews
 * these clips rather than windows of the full songs.
 *
 * `--propose` writes nothing: it measures the master and prints the proposed
 * windows, the preview one clear of the TOML's results window when it has one,
 * so a song whose TOML is already hand-edited gets proposals without --force.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { downbeatMs, estimateBpm, msToTicks, onsetEnvelope } from "./beat-grid";
import { integratedLoudness, loudestWindowMs } from "./loudness";
import { channelSamples, monoSamples, readWav, sampleOffset, writeWav, type Wav } from "./wav";

const ROOT = resolve(import.meta.dirname, "../../..");
const ASSETS = resolve(import.meta.dirname, "../assets");
const MANIFEST = resolve(ASSETS, "art-manifest.json");
const SONGS = resolve(ROOT, "content/songs");
const HASH_LINE = /^# intake-hash: ([0-9a-f]{16})\n/m;
const AAC_BITRATE = "256000";
/** ABR (`-s 1`) holds the target bitrate; CBR and constrained VBR land larger. */
const AAC_ARGS = ["-f", "m4af", "-d", "aac", "-b", AAC_BITRATE, "-s", "1", "-q", "127"];
/** The proposed results window's length. */
const WINDOW_MS = 16_000;
/** A preview loops, so each end of the cut fades over this long rather than clicking. */
const PREVIEW_EDGE_MS = 10;

export type IntakeMeasure = { bpm: number; beatOffsetTicks: number; durationMs: number; loudnessLufs: number };
export type SongIdentity = { id: string; title: string; unlock?: string | undefined };
export type IntakeArgs = {
  master: string;
  id: string;
  title?: string | undefined;
  unlock?: string | undefined;
  force: boolean;
  reencode: boolean;
  preview: boolean;
  propose: boolean;
};

const USAGE =
  "usage: pnpm intake:song <master.wav> <id> --title <title> [--unlock <condition>] [--force] [--reencode]\n" +
  "       pnpm intake:song <master.wav> <id> --preview\n" +
  "       pnpm intake:song <master.wav> <id> --propose";

export function parseIntakeArgs(args: readonly string[]): IntakeArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--title" || arg === "--unlock") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value\n${USAGE}`);
      values.set(arg, value);
      i += 1;
    } else if (arg.startsWith("--")) {
      if (!["--force", "--reencode", "--preview", "--propose"].includes(arg)) throw new Error(`unknown flag ${arg}\n${USAGE}`);
      flags.add(arg);
    } else positional.push(arg);
  }
  const [master, id] = positional;
  if (master === undefined || id === undefined || positional.length > 2 || !/^[a-z0-9-]+$/.test(id)) throw new Error(USAGE);
  const preview = flags.has("--preview");
  const propose = flags.has("--propose");
  if (preview && propose) throw new Error(USAGE);
  if (!preview && !propose && values.get("--title") === undefined) throw new Error(`--title is required\n${USAGE}`);
  return {
    master,
    id,
    title: values.get("--title"),
    unlock: values.get("--unlock"),
    force: flags.has("--force"),
    reencode: flags.has("--reencode"),
    preview,
    propose,
  };
}

export function camelAlias(group: string, id: string): string {
  return `${group}.${id.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())}`;
}

export function intakeHashOf(text: string): string {
  return createHash("sha256").update(text.replace(HASH_LINE, "")).digest("hex").slice(0, 16);
}

export function isHandEdited(existing: string): boolean {
  const match = HASH_LINE.exec(existing);
  return match === null || match[1] !== intakeHashOf(existing);
}

export function songToml(song: SongIdentity, measure: IntakeMeasure): string {
  const body = [
    `# Measured from the master by pnpm intake:song: tempo and first beat by the`,
    `# method in docs/art/exceptional-race-slice-review.md, ${measure.loudnessLufs.toFixed(2)} LUFS integrated.`,
    `# Nothing in the simulation reads these. The whole file loops. The preview`,
    `# window (the song step and the new-song banner) and the results window`,
    `# are chosen by ear and added by hand; once this file is edited, a re-run`,
    `# needs --force.`,
    `id = ${JSON.stringify(song.id)}`,
    `displayName = ${JSON.stringify(song.title)}`,
    `bpm = ${measure.bpm.toFixed(2)}`,
    `beatOffsetTicks = ${measure.beatOffsetTicks}`,
    `loopStartMs = 0`,
    `loopEndMs = ${measure.durationMs}`,
    `audioAlias = "${camelAlias("music", song.id)}"`,
    `coverAlias = "${camelAlias("cover", song.id)}"`,
    ...(song.unlock === undefined ? [] : [`unlock = ${JSON.stringify(song.unlock)}`]),
    ``,
  ].join("\n");
  return `# intake-hash: ${intakeHashOf(body)}\n${body}`;
}

type Window = { startMs: number; endMs: number };

/** A TOML's `<name>StartMs`/`<name>EndMs` pair, read by line: this package carries no TOML parser. */
function windowIn(toml: string, name: "preview" | "results"): Window | undefined {
  const start = new RegExp(`^${name}StartMs\\s*=\\s*(\\d+)`, "m").exec(toml)?.[1];
  const end = new RegExp(`^${name}EndMs\\s*=\\s*(\\d+)`, "m").exec(toml)?.[1];
  return start === undefined || end === undefined ? undefined : { startMs: Number(start), endMs: Number(end) };
}

/** A TOML's results window: what the "[name] wins" screen plays. */
export const resultsWindow = (toml: string): Window | undefined => windowIn(toml, "results");

/** A TOML's preview window: what the song step previews and the unlock banner plays. */
export const previewWindow = (toml: string): Window | undefined => windowIn(toml, "preview");

/** A window of `WINDOW_MS` from `fromMs`, moved to the next beat, and back by whole beats if it would run past the end. */
export function windowOnBeat(fromMs: number, firstBeatMs: number, bpm: number, durationMs: number): Window {
  const beatMs = 60_000 / bpm;
  let beats = Math.ceil((fromMs - firstBeatMs) / beatMs);
  while (beats > 0 && firstBeatMs + beats * beatMs + WINDOW_MS > durationMs) beats -= 1;
  const startMs = Math.round(firstBeatMs + Math.max(0, beats) * beatMs);
  return { startMs, endMs: Math.min(durationMs, startMs + WINDOW_MS) };
}

type Row = Record<string, unknown> & { alias: string };
type Manifest = { bundles: Record<string, Row[]> };

/** Puts `row` in `bundle`, removing any row of that alias from every bundle first. */
export function upsertRow(manifest: Manifest, bundle: string, row: Row): void {
  for (const rows of Object.values(manifest.bundles)) {
    const at = rows.findIndex((entry) => entry.alias === row.alias);
    if (at >= 0) rows.splice(at, 1);
  }
  (manifest.bundles[bundle] ??= []).push(row);
}

function requireMac(): void {
  if (process.platform !== "darwin") throw new Error("the intake encodes and decodes with afconvert, which is macOS-only: run it on the Mac");
}

function encode(input: string, output: string): void {
  execFileSync("afconvert", [...AAC_ARGS, input, output]);
}

/**
 * Refuses an encode that does not decode to `source`'s frames at zero sample
 * offset. `afconvert` decodes through the m4a's priming and remainder, so
 * this compares what a browser plays, not the container's padded length.
 */
function checkEncode(source: Wav, encoded: string): void {
  const scratch = mkdtempSync(join(tmpdir(), "ff-intake-"));
  try {
    const decodedPath = join(scratch, "decoded.wav");
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", encoded, decodedPath]);
    const decoded = readWav(readFileSync(decodedPath));
    if (decoded.frames !== source.frames)
      throw new Error(`${encoded} decodes to ${decoded.frames} frames; its source has ${source.frames}. Re-encode with --reencode`);
    const lag = sampleOffset(source, decoded, 2048);
    if (lag !== 0) throw new Error(`${encoded} decodes ${lag} samples off its source. Re-encode with --reencode`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function provenance(master: string, note: string): Record<string, string> {
  return {
    tool: `afconvert ${AAC_ARGS.join(" ")} (packages/asset-contract/tools/intake-song.ts${note})`,
    prompt: "Suno generation by the project owner",
    source: `Supplied by the project owner as _CommericalSongs/${basename(master)}`,
    license: "Generated on Suno by the project owner under a plan that grants commercial use. Cleared for commercial release.",
  };
}

function audioRow(alias: string, file: string, master: string, measure: { durationMs: number; loudnessLufs: number }, note = ""): Row {
  return {
    alias,
    role: "audio",
    file,
    codec: 'audio/mp4; codecs="mp4a.40.2"',
    sampleRate: 48000,
    channels: 2,
    durationMs: measure.durationMs,
    loudnessLufs: measure.loudnessLufs,
    loopStartMs: 0,
    loopEndMs: measure.durationMs,
    provenance: provenance(master, note),
  };
}

function writeManifestRow(bundle: string, row: Row): void {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  upsertRow(manifest, bundle, row);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readMaster(master: string): Wav {
  const wav = readWav(readFileSync(master));
  if (wav.sampleRate !== 48000 || wav.channels !== 2)
    throw new Error(`${master}: ${wav.sampleRate} Hz, ${wav.channels} ch; a master is 48 kHz stereo`);
  return wav;
}

const stereo = (wav: Wav, from = 0, to = wav.frames): Float32Array[] => [channelSamples(wav, 0, from, to), channelSamples(wav, 1, from, to)];

/** Measures and writes one song; returns the line the command prints. */
export function intake(args: IntakeArgs): string {
  requireMac();
  const wav = readMaster(args.master);
  const tomlPath = resolve(SONGS, `${args.id}.toml`);
  if (existsSync(tomlPath) && isHandEdited(readFileSync(tomlPath, "utf8")) && !args.force)
    throw new Error(`${tomlPath} was edited by hand; pass --force to overwrite it`);

  const file = `production/${args.id}.m4a`;
  const output = resolve(ASSETS, file);
  if (!existsSync(output) || args.reencode) encode(args.master, output);
  checkEncode(wav, output);

  const { measure, firstBeatMs, channels } = measureMaster(wav);
  writeFileSync(tomlPath, songToml({ id: args.id, title: args.title!, unlock: args.unlock }, measure));
  writeManifestRow(`song-${args.id}`, audioRow(camelAlias("music", args.id), file, args.master, measure));
  return (
    `${args.id}: ${measure.bpm.toFixed(2)} BPM, first beat ${firstBeatMs.toFixed(1)} ms (${measure.beatOffsetTicks} ticks), ` +
    `${measure.durationMs} ms, ${measure.loudnessLufs.toFixed(2)} LUFS; the encode matches the master; ` +
    proposals(channels, wav.sampleRate, firstBeatMs, measure)
  );
}

function measureMaster(wav: Wav): { measure: IntakeMeasure; firstBeatMs: number; channels: Float32Array[] } {
  const channels = stereo(wav);
  const { envelope, hopSeconds, windowSeconds } = onsetEnvelope(monoSamples(wav), wav.sampleRate);
  const bpm = estimateBpm(envelope, hopSeconds);
  const firstBeatMs = downbeatMs(envelope, hopSeconds, windowSeconds, bpm);
  const measure: IntakeMeasure = {
    bpm,
    beatOffsetTicks: msToTicks(firstBeatMs),
    durationMs: Math.round((wav.frames / wav.sampleRate) * 1000),
    loudnessLufs: integratedLoudness(channels, wav.sampleRate),
  };
  return { measure, firstBeatMs, channels };
}

/** The proposed windows, as the command prints them: the preview one clear of `results`, or of the proposed results window. */
function proposals(channels: Float32Array[], sampleRate: number, firstBeatMs: number, measure: IntakeMeasure, results?: Window): string {
  const onBeat = (fromMs: number): Window => windowOnBeat(fromMs, firstBeatMs, measure.bpm, measure.durationMs);
  const proposedResults = onBeat(loudestWindowMs(channels, sampleRate, WINDOW_MS));
  const proposedPreview = onBeat(loudestWindowMs(channels, sampleRate, WINDOW_MS, results ?? proposedResults));
  return (
    `proposed preview window ${proposedPreview.startMs}-${proposedPreview.endMs}` +
    (results === undefined ? `, proposed results window ${proposedResults.startMs}-${proposedResults.endMs}` : ` (clear of the results window ${results.startMs}-${results.endMs})`)
  );
}

/** The music band's centre (polish spec §8.1): what every song and preview is held to. */
export const MUSIC_TARGET_LUFS = -16;

/** The highest sample peak a lifted preview may reach: the one-shots' ceiling. */
const PREVIEW_PEAK_CEILING_DBFS = -1;

/**
 * The linear gain that brings a preview measured at `lufs`, peaking at
 * `peakDbfs`, to the music band.
 *
 * The owner chooses a preview's window by ear, so it can measure above the
 * song it comes from or below it. Down is always taken; up stops where the
 * peak would pass -1 dBFS, so nothing this does can clip.
 */
export function previewGain(lufs: number, peakDbfs: number): number {
  const wanted = MUSIC_TARGET_LUFS - lufs;
  const db = wanted <= 0 ? wanted : Math.max(0, Math.min(wanted, PREVIEW_PEAK_CEILING_DBFS - peakDbfs));
  return 10 ** (db / 20);
}

/** The highest sample across `channels`, in dBFS. */
function samplePeakDbfs(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return 20 * Math.log10(peak);
}

/** Measures the master and prints proposed windows; writes nothing. */
export function propose(args: IntakeArgs): string {
  const wav = readMaster(args.master);
  const tomlPath = resolve(SONGS, `${args.id}.toml`);
  const results = existsSync(tomlPath) ? resultsWindow(readFileSync(tomlPath, "utf8")) : undefined;
  const { measure, firstBeatMs, channels } = measureMaster(wav);
  return `${args.id}: ${proposals(channels, wav.sampleRate, firstBeatMs, measure, results)}`;
}

/** Cuts, encodes and records one song's preview clip; returns the line the command prints. */
export function preview(args: IntakeArgs): string {
  requireMac();
  const window = previewWindow(readFileSync(resolve(SONGS, `${args.id}.toml`), "utf8"));
  if (window === undefined) throw new Error(`${args.id}.toml has no preview window yet; the owner chooses it by ear first`);
  const wav = readMaster(args.master);
  const from = Math.round((window.startMs / 1000) * wav.sampleRate);
  const to = Math.round((window.endMs / 1000) * wav.sampleRate);
  if (to > wav.frames) throw new Error(`${args.id}.toml's preview window ends past the master`);
  const channels = stereo(wav, from, to);
  const edge = Math.round((PREVIEW_EDGE_MS / 1000) * wav.sampleRate);
  for (const channel of channels)
    for (let i = 0; i < edge; i += 1) {
      channel[i]! *= i / edge;
      channel[channel.length - 1 - i]! *= i / edge;
    }
  const gain = previewGain(integratedLoudness(channels, wav.sampleRate), samplePeakDbfs(channels));
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) channel[i]! *= gain;

  const scratch = mkdtempSync(join(tmpdir(), "ff-preview-"));
  try {
    const cutPath = join(scratch, `${args.id}-preview.wav`);
    writeFileSync(cutPath, writeWav(channels, wav.sampleRate));
    const file = `production/${args.id}-preview.m4a`;
    const output = resolve(ASSETS, file);
    encode(cutPath, output);
    checkEncode(readWav(readFileSync(cutPath)), output);
    const measure = {
      durationMs: Math.round(((to - from) / wav.sampleRate) * 1000),
      loudnessLufs: integratedLoudness(channels, wav.sampleRate),
    };
    writeManifestRow("shell", audioRow(`${camelAlias("music", args.id)}Preview`, file, args.master, measure, ", --preview: the preview window"));
    return `${args.id}: preview ${window.startMs}-${window.endMs}, ${measure.durationMs} ms, ${measure.loudnessLufs.toFixed(2)} LUFS; the encode matches the cut`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function runIntake(argv: readonly string[]): string {
  const args = parseIntakeArgs(argv);
  if (args.propose) return propose(args);
  return args.preview ? preview(args) : intake(args);
}
