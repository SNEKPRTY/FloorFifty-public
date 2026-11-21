/**
 * `pnpm demos:encode`: turns the frames `demo-capture.spec.ts` wrote (`evidence/demos/<slide>/NNNN.png`, a
 * frame every fourth tick of sixty) into the Instructions carousel's clips and stills, and writes their rows
 * into the art manifest. Run by hand; nothing in a build or in CI runs it (story-mode spec, "How the demos
 * are made"). Each clip gets an even share of the set's budget, or its own budget if that is smaller.
 * `DEMO_SLIDE=<slide>` encodes that slide alone and keeps the other rows and files as they are; its
 * clip then gets whatever the set's budget leaves after the others.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_CLIP_BYTES, DEMO_SET_BYTES, RECORDED_SLIDES, DEMO_STILL_BYTES } from "../../packages/asset-contract/src/validate-assets";
import { DEMO_SLIDE_PLANS } from "../../tests/e2e/support/demo-slides";

const ROOT = resolve(import.meta.dirname, "../..");
const FRAMES = resolve(ROOT, "evidence/demos");
const ASSETS = resolve(ROOT, "packages/asset-contract/assets");
const OUT = resolve(ASSETS, "production/demos");
const WIDTH = 480;
const HEIGHT = 270;
const FPS = 15;
/** Steps tried in order until a file fits its budget: the quality first, then fewer frames a second at the same speed. */
const STEPS: readonly { quality: number; fps: number }[] = [
  ...[75, 62, 50, 40, 30, 22].map((quality) => ({ quality, fps: FPS })),
  ...[22, 15, 10].map((quality) => ({ quality, fps: 12 })),
  ...[15, 10, 5].map((quality) => ({ quality, fps: 10 })),
];

const ffmpeg = (args: string[]): void => void execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const scaleAt = (fps: number): string => `fps=${fps},scale=${WIDTH}:${HEIGHT}:flags=lanczos`;

function fit(make: (step: { quality: number; fps: number }) => void, file: string, limit: number): { quality: number; fps: number; bytes: number } {
  for (const step of STEPS) {
    make(step);
    const bytes = statSync(file).size;
    if (bytes <= limit) return { ...step, bytes };
  }
  return { ...STEPS.at(-1)!, bytes: statSync(file).size };
}

const slideFile = (slide: string): string => slide;
mkdirSync(OUT, { recursive: true });
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const manifestPath = resolve(ASSETS, "art-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const only = process.env["DEMO_SLIDE"];
if (only !== undefined && !(RECORDED_SLIDES as readonly string[]).includes(only)) throw new Error(`DEMO_SLIDE=${only} is not a slide`);
const slides = only === undefined ? RECORDED_SLIDES : [only];
/** The rows kept as they are: every other slide's, when one slide is encoded alone. */
const kept = (manifest.bundles.demos as { alias: string; file: string; kind: string }[]).filter(
  (row) => only !== undefined && row.alias !== `demo.${only}` && row.alias !== `demo.${only}Still`,
);
let clips = kept.filter((row) => row.kind === "clip").reduce((sum, row) => sum + statSync(resolve(ASSETS, row.file)).size, 0);
const fresh = new Map<string, unknown[]>();

for (const slide of slides) {
  const dir = resolve(FRAMES, slide);
  const frames = readdirSync(dir).filter((name) => name.endsWith(".png")).sort();
  const plan = DEMO_SLIDE_PLANS.find((candidate) => candidate.slide === slide);
  const clip = resolve(OUT, `${slideFile(slide)}.webp`);
  const still = resolve(OUT, `${slideFile(slide)}-still.webp`);
  // The whole set shares its budget evenly; one slide alone gets what the others leave.
  const limit = Math.floor(only === undefined ? Math.min(DEMO_CLIP_BYTES, DEMO_SET_BYTES / RECORDED_SLIDES.length) : Math.min(DEMO_CLIP_BYTES, DEMO_SET_BYTES - clips));
  const clipFit = fit(({ quality, fps }) => ffmpeg(["-framerate", String(FPS), "-i", resolve(dir, "%04d.png"), "-vf", scaleAt(fps), "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(quality), "-compression_level", "6", "-loop", "0", clip]), clip, limit);
  const middle = resolve(dir, frames[Math.floor(frames.length * 0.4)]!);
  const stillFit = fit(({ quality }) => ffmpeg(["-i", middle, "-vf", scaleAt(FPS), "-c:v", "libwebp", "-q:v", String(quality), still]), still, DEMO_STILL_BYTES);
  clips += clipFit.bytes;
  console.log(`${slide}: ${frames.length} frames, clip ${clipFit.bytes} B (q${clipFit.quality}, ${clipFit.fps} fps), still ${stillFit.bytes} B (q${stillFit.quality})`);
  const provenance = {
    tool: "tests/e2e/demo-capture.spec.ts, tools/demos/encode.ts (ffmpeg libwebp_anim)",
    prompt:
      plan === undefined
        ? `recorded from the replay of a four-seat race on the real server (floors-20, driven by the server's test driver), ninja in scarlet watching, rivals at full colour in a closer view that follows the ninja (capture only), 15 frames a second of 60 ticks`
        : `recorded from the story scene on Rooftops, ninja in scarlet, seed ${plan.seed}, script "${slide}", 15 frames a second of 60 ticks`,
    source: `commit ${commit}`,
    license: "own work (a recording of Floor Fifty)",
  };
  fresh.set(slide, [
    { alias: `demo.${slide}`, file: `production/demos/${slideFile(slide)}.webp`, role: "demo", kind: "clip", width: WIDTH, height: HEIGHT, provenance },
    { alias: `demo.${slide}Still`, file: `production/demos/${slideFile(slide)}-still.webp`, role: "demo", kind: "still", width: WIDTH, height: HEIGHT, provenance },
  ]);
}

// In the carousel's order, the kept rows where they were.
manifest.bundles.demos = RECORDED_SLIDES.flatMap((slide) => fresh.get(slide) ?? kept.filter((row) => row.alias === `demo.${slide}` || row.alias === `demo.${slide}Still`));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`the clips ${clips} B of ${DEMO_SET_BYTES} B`);
if (clips > DEMO_SET_BYTES) process.exitCode = 1;
