/**
 * Renders the accent layer: one PNG per frame of the whole 13.32 s timeline,
 * with alpha, then a ProRes 4444 with alpha for the overlay.
 *
 * The scene is deterministic, so this is a pure function of the timeline; if a
 * frame is wrong it is wrong reproducibly.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TOOLS = resolve("tools/social-edit");
const OUT = resolve("evidence/social-2026-10-05/accent");

const timeline = JSON.parse(await readFile(`${TOOLS}/timeline.json`, "utf8"));
const fps = timeline.fps;
const total = Math.round(timeline.duration * fps);

await mkdir(`${OUT}/frames`, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  // The scene is opened from file:// and pulls in fonts and take stills by
  // path; without this Chromium refuses those subresources.
  args: ["--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(`${TOOLS}/scene.html`).href);
  const assetBase = `${pathToFileURL(resolve(".")).href}/`;
  const mounted = await page.evaluate(([tl, base]) => window.FF.boot(tl, base), [timeline, assetBase]);
  if (mounted !== timeline.accents.length) {
    throw new Error(`mounted ${mounted} accents, expected ${timeline.accents.length}`);
  }
  for (let i = 0; i < total; i += 1) {
    await page.evaluate(([time]) => window.FF.renderFrame(time), [i / fps]);
    const shot = await page.screenshot({ omitBackground: true });
    await writeFile(`${OUT}/frames/${String(i).padStart(6, "0")}.png`, shot);
  }
  console.log(`Rendered ${total} frames at ${fps} fps.`);
} finally {
  await browser.close();
}

execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(fps),
  "-i", `${OUT}/frames/%06d.png`,
  "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
  `${OUT}/accent.mov`,
]);
console.log(`Wrote ${OUT}/accent.mov`);
