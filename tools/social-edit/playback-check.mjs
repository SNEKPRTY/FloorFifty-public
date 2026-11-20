/**
 * Loads the deliverable in a real browser and checks it seeks and plays.
 *
 * The page is a real file next to the video rather than `setContent`: an
 * `about:blank` page cannot load a `file://` video, so `setContent` never fires
 * `loadedmetadata` and the check hangs.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const FILE = resolve("docs/media/social/floor-fifty-every-screen.mp4");
const QA = resolve("evidence/social-2026-10-05/qa");
await mkdir(QA, { recursive: true });
const player = `${QA}/player.html`;
await writeFile(
  player,
  `<!DOCTYPE html><html><body style="margin:0;background:#111">` +
    `<video src="${pathToFileURL(FILE).href}" controls style="width:540px"></video></body></html>\n`,
);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage({ viewport: { width: 540, height: 1000 } });
  page.setDefaultTimeout(20_000);
  await page.goto(pathToFileURL(player).href);
  const result = await page.locator("video").evaluate(async (video) => {
    if (video.readyState < 1) {
      await new Promise((ok, no) => {
        video.addEventListener("loadedmetadata", ok, { once: true });
        video.addEventListener("error", () => no(new Error("load failed")), { once: true });
        setTimeout(() => no(new Error("metadata timed out")), 15_000);
      });
    }
    video.currentTime = 4;
    await new Promise((ok, no) => {
      video.addEventListener("seeked", ok, { once: true });
      video.addEventListener("error", () => no(new Error("seek failed")), { once: true });
      setTimeout(() => no(new Error("seek timed out")), 15_000);
    });
    await video.play();
    await new Promise((ok) => setTimeout(ok, 600));
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      time: video.currentTime,
      paused: video.paused,
      frames: video.getVideoPlaybackQuality().totalVideoFrames,
    };
  });
  if (result.paused || result.time <= 4.15 || result.width !== 1080 || result.height !== 1920) {
    throw new Error(JSON.stringify(result));
  }
  console.log(
    `PASS: loads, seeks and plays — ${result.width}x${result.height}, ${result.duration.toFixed(2)}s, ${result.frames} frames drawn`,
  );
} finally {
  await browser.close();
}
