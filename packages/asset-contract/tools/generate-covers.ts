/**
 * `pnpm assets:covers <song-id>…`: song covers, downscaled from the project
 * owner's masters in `_CommericalArt/` to WebP at the three sizes the select
 * screen draws (cwebp -q 90): the jukebox tile, the picker's panel, and the
 * reveal's full-frame result, just under the masters' own 1250 or so. The masters stay the source. Covers are smooth
 * UI art, not world art, so they are not palette-locked.
 *
 * It writes only the songs it is named, so a cover lands with its song: the
 * manifest declares only what content addresses. cwebp is deterministic, so
 * re-running it on a cover already committed leaves the file unchanged.
 *
 * A script with no exports, run for its effect: importing it would run it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// The masters are committed in `_CommericalArt/` at the repo root, so this
// reads the checkout it runs in, a worktree's own copy included.
const MASTERS = resolve(import.meta.dirname, "../../../_CommericalArt");
const OUT = resolve(import.meta.dirname, "../assets/production/covers");

/**
 * Which `_CommericalArt/TrackN` master is each song's. The first nine are in
 * jukebox order (spec §4.2); We Outside came later, as cover 10, though it
 * sits fifth on the jukebox. Moving On and Unseen replaced All Night and
 * Redline (2026-10-03) and wear their covers until art of their own lands.
 */
const COVER_TRACK: Readonly<Record<string, number>> = {
  "moving-on": 1,
  "farther-from-home": 2,
  "whats-next": 3,
  "chrome-in-the-rain": 4,
  "la-reina-del-mambo": 5,
  "crash-mode": 6,
  "pyramid-scheme": 7,
  "static-in-the-air": 8,
  unseen: 9,
  "we-outside": 10,
};
const COVER_SIZES = [192, 640, 1200] as const;

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => COVER_TRACK[id] === undefined);
if (wanted.length === 0 || unknown.length > 0) {
  throw new Error(
    `usage: pnpm assets:covers <song-id>…, from ${Object.keys(COVER_TRACK).join(", ")}` +
      (unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""),
  );
}

mkdirSync(OUT, { recursive: true });
for (const id of wanted) {
  const master = resolve(MASTERS, `Track${COVER_TRACK[id]}_Quantizer_LG.png`);
  for (const size of COVER_SIZES) {
    const out = resolve(OUT, `cover-${id}-${size}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "90", "-resize", String(size), String(size), master, "-o", out]);
    process.stdout.write(`  covers/cover-${id}-${size}.webp\n`);
  }
}
