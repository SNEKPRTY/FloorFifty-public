/**
 * Films the five social-trailer races at 60 fps, four seat POVs each.
 *
 * Derived from the previous campaign's harness
 * (`evidence/trailers-2026-10-05/capture.ts` in the main checkout). The changes
 * here are the ones the 13 s vertical cut needs:
 *
 *   - 60 fps capture, not 30: the old takes were frame-capped, and Floor Fifty
 *     is a 60 Hz game (TICK_HZ), so a 60 fps cut is the honest target.
 *   - all four seat POVs filmed, so every seat colour reaches the screen.
 *   - every character open: earned ones by seeded progress, and the
 *     `after-hours` DLC pack (penguin, oni, witch, knight) by its entitlement.
 *   - a per-take frame-rate gate: a starved capture is refilmed, not used.
 *   - a survival race's clock pinned to its shortest, so it finishes inside the
 *     driver's tick budget.
 *
 * The ports come from `playwright.config.ts`, which derives a pair from this
 * checkout's path — importing it first publishes them on `process.env`, and
 * `server-fixture` reads them at module load. Hard-coding a port would talk to
 * another worktree's server.
 *
 * Nothing here reaches past the interface: every position and finish is the
 * server's, not the harness's.
 */
import "../../playwright.config.ts";
import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, appendFile, writeFile, readFile, rename } from "node:fs/promises";
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  passSplash,
  enterLobby,
  createRoom,
  joinRoom,
  chooseMode,
  readyOnly,
  turnPickerTo,
  passSelect,
  expectScreen,
  seedProgress,
} from "../../tests/e2e/support/room-driver";
import { driveRoom, waitForServer } from "../../tests/e2e/support/server-fixture";

type Race = { stage: string; song: string; mode: string; seats: string[] };

const OUT = resolve("evidence/social-2026-10-05");
const clientPort = process.env["E2E_CLIENT_PORT"];
if (clientPort === undefined) {
  throw new Error("E2E_CLIENT_PORT is unset — playwright.config.ts must be imported first");
}
const BASE_URL = `http://127.0.0.1:${clientPort}`;

const plan = JSON.parse(await readFile(resolve("tools/social-edit/plan.json"), "utf8")) as {
  races: Race[];
  fps: number;
};
const FPS = plan.fps;
// `SOCIAL_ONLY_RACE=<stage>-<song>` films a single race: the smoke gate before
// committing to the full shoot.
const only = process.env["SOCIAL_ONLY_RACE"];
const races = only === undefined ? plan.races : plan.races.filter((race) => `${race.stage}-${race.song}` === only);
if (races.length === 0) throw new Error(`SOCIAL_ONLY_RACE="${only}" matched no race`);
const NAMES = ["Kite", "Sable", "Wren", "Koi"];
const SONGS = [
  "moving-on", "farther-from-home", "whats-next", "chrome-in-the-rain", "we-outside",
  "la-reina-del-mambo", "crash-mode", "pyramid-scheme", "static-in-the-air", "unseen",
];
const CHARACTERS = ["ninja", "frog", "diver", "kitsune", "robo", "penguin", "oni", "witch", "knight"];

await mkdir(`${OUT}/raw`, { recursive: true });
await mkdir(`${OUT}/stills`, { recursive: true });

/** Rebuilds a streaming container's index, which MediaRecorder does not write. */
function remux(path: string): void {
  const dot = path.lastIndexOf(".");
  const indexed = `${path.slice(0, dot)}-indexed${path.slice(dot)}`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", path, "-c", "copy", indexed]);
  renameSync(indexed, path);
}

function ffprobe(args: string[]): string {
  return execFileSync("ffprobe", args, { encoding: "utf8" });
}

/** The gate. By ruling, capture is best-effort: the take is conformed to the
 * project's rate in the cut, so this only catches a capture that failed. */
function assertUsable(path: string): number {
  const frames = Number(
    /nb_read_frames=(\d+)/.exec(
      ffprobe(["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1", path]),
    )?.[1] ?? "0",
  );
  const duration = Number(ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]));
  const fps = frames / duration;
  // This machine renders the game in the high teens to mid thirties of fps
  // under capture, so a take is accepted at whatever rate it reached; the cut
  // conforms it. The floor only catches a capture that effectively failed.
  if (!(fps >= 12)) throw new Error(`Take is ${fps.toFixed(1)} fps, which is not usable: ${path}`);
  const audio = ffprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path]);
  if (audio.trim().length === 0) throw new Error(`Take has no audio: ${path}`);
  return fps;
}

await waitForServer();
console.log(`Filming against ${BASE_URL} at ${FPS} fps`);

const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--mute-audio"] });
try {
  for (const race of races) {
    const tag = `${race.stage}-${race.song}`;
    try {
      const prior = JSON.parse(await readFile(`${OUT}/raw/${tag}.json`, "utf8")) as { takes: { path: string }[] };
      for (const take of prior.takes) {
        const bytes = await readFile(take.path);
        if (bytes.length < 500_000) throw new Error("Take must be refilmed");
      }
      console.log(`Already filmed and validated ${tag}`);
      continue;
    } catch {
      // No usable prior shoot for this race: film it.
    }

    const seats = race.seats;
    const contexts: import("@playwright/test").BrowserContext[] = [];
    const pages: Page[] = [];
    const events: Record<string, number> = {};
    console.log(`Preparing fresh four-player ${tag} (${seats.join("/")}) at ${FPS} fps`);
    try {
      for (let i = 0; i < 4; i += 1) {
        const context = await browser.newContext({
          baseURL: BASE_URL,
          viewport: i === 0 ? { width: 1920, height: 1080 } : { width: 960, height: 540 },
          deviceScaleFactor: 1,
          reducedMotion: "no-preference",
          ...(i === 0 ? { recordVideo: { dir: `${OUT}/raw`, size: { width: 1920, height: 1080 } } } : {}),
        });
        contexts.push(context);
        await seedProgress(context, {
          unlocked: ["any-match", "games-2", "share-replay", "games-3", "games-5", "games-7", "games-8", "games-10"],
          matchesFinished: 10,
          // Progress conditions carry the base-pack items; the list only keeps NEW badges off the footage.
          revealed: [...CHARACTERS.map((id) => `character:${id}`), ...SONGS.map((id) => `song:${id}`)],
        });
        // The e2e client is a production build, so `import.meta.env.DEV` is false
        // and every `?dev=` flag is inert (main.ts). The `after-hours` pack is
        // granted the only way a device is ever granted it: in its own
        // entitlement store.
        await context.addInitScript(() => {
          localStorage.setItem("floor-fifty.entitlements.v1", JSON.stringify({ version: 1, owned: ["after-hours"] }));
        });
        await context.addInitScript(() => {
          const settings = JSON.parse(localStorage.getItem("floor-fifty.settings.v1") || "{}");
          localStorage.setItem(
            "floor-fifty.settings.v1",
            JSON.stringify({
              ...settings,
              version: 2,
              locale: "en",
              // Music out: the trailer's own theme is the only bed (Task 10).
              audio: { music: 0, sfx: 0.85, announcer: 0.6, muted: false, muteUnfocused: false },
              display: { quality: "high", panel: true },
            }),
          );
          // A recording-only audio tap; the shipped game and simulation are unchanged.
          const original = AudioNode.prototype.connect;
          AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
            const result = (original as (...a: unknown[]) => unknown).apply(this, args);
            if (args[0] instanceof AudioDestinationNode) {
              const tap = (this.context as AudioContext).createMediaStreamDestination();
              (original as (...a: unknown[]) => unknown).call(this, tap);
              (window as unknown as { __shootTap: unknown }).__shootTap = tap;
            }
            return result;
          } as typeof AudioNode.prototype.connect;
        });
        const page = await context.newPage();
        page.setDefaultTimeout(25_000);
        pages.push(page);
        await page.goto("/");
        await expect(
          page.getByTestId("splash").or(page.getByTestId("language-first")).or(page.getByTestId("photosensitivity-warning")),
        ).toBeVisible({ timeout: 60_000 });
        await passSplash(page);
        await expectScreen(page, "title");
        await page.getByTestId("title-character").click();
        if (seats[i] !== "ninja") {
          await page.getByTestId("character-page").locator(`[data-testid=tile][data-id="${seats[i]}"]`).click();
        }
        await expect(page.getByTestId("character-preview-name")).toHaveText(
          seats[i]!.charAt(0).toUpperCase() + seats[i]!.slice(1),
        );
        // "Pick" is a button; a character already being worn shows a picked
        // marker instead, so either confirm it or step back to the title.
        const pick = page.locator('button[data-testid="character-pick"]');
        if ((await pick.count()) > 0) await pick.click();
        else await page.getByTestId("character-back").click();
        await expect(page.getByTestId("character-page")).toHaveCount(0);
        await enterLobby(page);
        console.log(`Prepared ${NAMES[i]} as ${seats[i]}`);
      }

      const code = await createRoom(pages[0]!, NAMES[0]!);
      for (let i = 1; i < pages.length; i += 1) await joinRoom(pages[i]!, code, NAMES[i]!);
      for (let i = 0; i < seats.length; i += 1) {
        await expect(pages[0]!.getByTestId("seat").nth(i)).toHaveAttribute("data-character", seats[i]!);
      }

      await chooseMode(pages[0]!, race.mode);
      // Survival offers clocks; pin the shortest so the race ends inside the tick budget.
      const shortestClock = pages[0]!.getByTestId("clock-60");
      if ((await shortestClock.count()) > 0) await shortestClock.click();
      events.lobby = Date.now();
      await pages[0]!.screenshot({ path: `${OUT}/stills/${tag}-lobby.png` });

      await readyOnly(pages);
      for (const page of pages) {
        await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage");
      }
      await Promise.all(pages.map((page) => turnPickerTo(page, race.stage)));
      events.stage = Date.now();
      await Promise.all(
        pages.map(async (page) => {
          if ((await page.getByTestId("select-screen").getAttribute("data-step")) === "stage") {
            await page.getByTestId("lock-in").click({ timeout: 1200 }).catch(() => {});
          }
        }),
      );
      await Promise.all(
        pages.map((page) => expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "song", { timeout: 15_000 })),
      );
      await Promise.all(pages.map((page) => turnPickerTo(page, race.song)));
      events.song = Date.now();
      await pages[0]!.screenshot({ path: `${OUT}/stills/${tag}-song.png` });
      await passSelect(pages);
      for (const page of pages) await expectScreen(page, "gameplay");
      events.gameplay = Date.now();

      const result = await driveRoom(code, { ticks: 60 * 320 });
      if (result.phase !== "finished") throw new Error(`Race did not finish: ${JSON.stringify(result)}`);
      for (const page of pages) await expectScreen(page, "game-end");
      events.results = Date.now();
      await pages[0]!.screenshot({ path: `${OUT}/stills/${tag}-results.png` });

      const recorded: {
        path: string;
        character: string;
        player: string;
        startedAt: number;
        endedAt: number;
        duration: number;
        fps: number;
        source: string;
        drift: boolean;
      }[] = [];
      const uiVideo = pages[0]!.video()!;

      // Park every client on its own paused replay before any filming starts.
      // Four clients animating at once is what the frame budget measures at
      // roughly 22 fps; only the one being filmed should be drawing at all.
      for (const page of pages) {
        await expect(page.getByTestId("watch-replay")).toBeEnabled();
        await page.getByTestId("watch-replay").click();
        await expectScreen(page, "replay");
        // The replay opens already playing: pause it and rewind, so a take that
        // starts later begins at the top of the race.
        await page.getByTestId("replay-play").click();
        await expect(page.getByTestId("replay-play")).toHaveAttribute("aria-label", "Play");
        await page.getByTestId("replay-progress").focus();
        await page.keyboard.press("Home");
      }

      // One POV at a time, through the game's own replay renderer at its real speed.
      for (let i = 0; i < 4; i += 1) {
        const page = pages[i]!;
        // Four pages share one browser: only the frontmost one is unthrottled,
        // so the page being filmed must be brought forward first.
        await page.bringToFront();
        await page.setViewportSize({ width: 1920, height: 1080 });
        // MP4/H.264 first, exactly as the shipped recorder orders it: Chromium
        // encodes H.264 in hardware, where VP9 is software and starves the
        // capture. A software VP9 encoder at 40 Mbps is what held the first
        // attempt to 39 fps.
        const mimeType = await page.evaluate(() =>
          ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((type) =>
            MediaRecorder.isTypeSupported(type),
          ),
        );
        if (mimeType === undefined) throw new Error("this browser records no video type");
        const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
        const path = `${OUT}/raw/${tag}-${seats[i]}.${extension}`;
        await writeFile(path, "");
        await page.exposeFunction("saveCaptureChunk", async (data: string) => {
          await appendFile(path, Buffer.from(data, "base64"));
        });
        // Ground truth, so a low take is read as a rendering problem or a
        // capture one rather than guessed at.
        const drawRate = await page.evaluate(
          () =>
            new Promise<number>((done) => {
              let frames = 0;
              const start = performance.now();
              const tick = (): void => {
                frames += 1;
                const elapsed = performance.now() - start;
                if (elapsed < 1000) requestAnimationFrame(tick);
                else done(frames / (elapsed / 1000));
              };
              requestAnimationFrame(tick);
            }),
        );
        console.log(`  canvas draws ~${drawRate.toFixed(1)} fps on the parked replay`);
        await page.evaluate(([chosenType, rate]: readonly [string, number]) => {
          const source = document.querySelector("#app canvas") as HTMLCanvasElement | null;
          if (!source) throw new Error("No rendered game canvas");
          const tap = (window as unknown as { __shootTap?: MediaStreamAudioDestinationNode }).__shootTap;
          if (!tap) throw new Error("No game audio tap");
          // Copy each rendered frame into a 2D canvas and capture that, exactly
          // as the shipped recorder does. A stream on the WebGL canvas is tied
          // to compositor presentation: measured at 34.6 fps drawn, it
          // delivered 9.6 fps recorded.
          const recording = document.createElement("canvas");
          recording.width = source.width;
          recording.height = source.height;
          const context = recording.getContext("2d", { alpha: false });
          if (context === null) throw new Error("no 2D context for the recording canvas");
          let copying = true;
          const copy = (): void => {
            if (!copying) return;
            context.drawImage(source, 0, 0, recording.width, recording.height);
            requestAnimationFrame(copy);
          };
          copy();
          const stream = recording.captureStream(rate);
          for (const track of tap.stream.getAudioTracks()) stream.addTrack(track.clone());
          const recorder = new MediaRecorder(stream, { mimeType: chosenType, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 });
          const writes: Promise<unknown>[] = [];
          recorder.ondataavailable = (e) => {
            if (!e.data.size) return;
            writes.push(
              new Promise<void>((ok, no) => {
                const reader = new FileReader();
                reader.onerror = () => no(new Error("chunk read failed"));
                reader.onload = () => {
                  const url = String(reader.result);
                  (window as unknown as { saveCaptureChunk: (s: string) => Promise<void> })
                    .saveCaptureChunk(url.slice(url.indexOf(";base64,") + 8))
                    .then(ok, no);
                };
                reader.readAsDataURL(e.data);
              }),
            );
          };
          (window as unknown as { __shoot: unknown }).__shoot = {
            recorder,
            stream,
            writes,
            stop: () => {
              copying = false;
            },
          };
          recorder.start(1000);
        }, [mimeType, FPS] as const);
        // The recorder is armed on the parked replay; this one click starts the
        // race from the top with the capture already running.
        await page.getByTestId("replay-play").click();
        await expect(page.getByTestId("replay-play")).toHaveAttribute("aria-label", "Pause");
        const startedAt = Date.now();
        console.log(`Filming ${tag}/${seats[i]} at 1080p/${FPS}fps, one camera at a time`);
        await page.getByTestId("replay-watch-again").waitFor({ state: "visible", timeout: 300_000 });
        const endedAt = Date.now();
        await expect(page.getByTestId("replay-drift")).toHaveCount(0);
        await page.evaluate(async () => {
          const { recorder, stream, writes, stop } = (window as unknown as {
            __shoot: { recorder: MediaRecorder; stream: MediaStream; writes: Promise<unknown>[]; stop: () => void };
          }).__shoot;
          stop();
          await new Promise<void>((ok) => {
            recorder.onstop = () => ok();
            recorder.stop();
          });
          await Promise.all(writes);
          stream.getTracks().forEach((track) => track.stop());
        });
        const bytes = await readFile(path);
        if (bytes.length < 500_000) throw new Error(`Video capture is too small: ${path}`);
        remux(path);
        const fps = assertUsable(path);
        console.log(`Captured ${tag}/${seats[i]}, ${((endedAt - startedAt) / 1000).toFixed(1)}s, ${fps.toFixed(1)} fps, no drift`);
        recorded.push({
          path,
          character: seats[i]!,
          player: NAMES[i]!,
          startedAt,
          endedAt,
          duration: (endedAt - startedAt) / 1000,
          fps,
          source: "fresh server-authoritative race replay",
          drift: false,
        });
        await contexts[i]!.close();
      }

      await rename(await uiVideo.path(), `${OUT}/raw/${tag}-ui.webm`);
      await writeFile(
        `${OUT}/raw/${tag}.json`,
        JSON.stringify(
          {
            ...race,
            shotAt: new Date().toISOString(),
            viewport: [1920, 1080],
            fps: FPS,
            characters: seats,
            playerNames: NAMES,
            events,
            result,
            takes: recorded,
            source: "All footage newly captured for the social trailer; no existing GIF or evidence footage used.",
          },
          null,
          2,
        ),
      );
    } catch (error) {
      for (let i = 0; i < pages.length; i += 1) {
        await pages[i]!.screenshot({ path: `${OUT}/stills/${tag}-error-${i}.png` }).catch(() => {});
      }
      for (const context of contexts) await context.close().catch(() => {});
      throw error;
    }
  }
} finally {
  await browser.close();
}
