/**
 * The screens walk's catalogue, views and file naming (`screens-walk.spec.ts`).
 *
 * The walk photographs every screen of the game on every view, so a board can
 * be built from the set and the visual audit can begin once the set is whole
 * (owner, 2026-11-14: "do not begin the visual screen audit until we have
 * EVERY view we need").
 *
 * A view is a device (or window) in one orientation, either standalone or
 * framed by the Ruken host. The walk is in one language, so runs in different
 * languages never mix: each view writes
 * `evidence/screens/<locale>/<view>/<nn>-<screen>.png`.
 * The number is the screen's place in `SCREENS`, the same on every view and on
 * every run, so `05-title.png` is the title everywhere and a screen a view
 * could not reach leaves a gap rather than renumbering the rest.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { devices, type BrowserContextOptions, type Frame, type Page } from "@playwright/test";
import { LOCALE_TAGS, isLocaleTag, type LocaleTag } from "../../../apps/client/src/features/i18n/locales";
import { evidenceDir } from "./evidence";

/** The game's own page, or its frame inside the Ruken host. Both answer the same locators. */
export type Surface = Page | Frame;

/**
 * `evaluate` and `waitForFunction` on a `Surface`. Both are generic and
 * overloaded, which TypeScript will not call through the union, so each
 * branch calls its own type's.
 */
export function evaluateIn<Result>(game: Surface, run: () => Result | Promise<Result>): Promise<Result> {
  return "mainFrame" in game ? game.evaluate(run) : game.evaluate(run);
}

export async function waitForIn(game: Surface, until: () => boolean): Promise<void> {
  if ("mainFrame" in game) await game.waitForFunction(until);
  else await game.waitForFunction(until);
}

/** The races' modes, in the catalogue's order, with the name their screens go by. */
export const MODES = [
  { id: "infinite", name: "survival" },
  { id: "floors-20", name: "floors-20" },
  { id: "floors-50", name: "floors-50" },
] as const;

const perMode = (build: (mode: string) => readonly string[]): string[] => MODES.flatMap((mode) => build(mode.name));

/**
 * Every screen, in the order it is numbered. Adding a screen means adding it
 * here, at the end, so the numbers already on a board do not move.
 */
export const SCREENS: readonly string[] = [
  // A first visit.
  "first-language",
  "photosensitivity-warning",
  "splash-loading",
  "splash-ready",
  "title",
  // The title's menus.
  "settings",
  "settings-scrolled",
  "settings-controls",
  "contact",
  "language",
  "character-from-title",
  // The lobby.
  "lobby",
  "join-failed",
  "match-gate",
  "instructions",
  "find-race-public-room",
  // The ready room.
  "ready-room-alone",
  "ready-room-cpus",
  "ready-room-rules",
  "character-from-ready-room",
  // Select, pause and the race, by mode.
  "select-stage",
  "select-roulette",
  "select-song",
  "pause",
  "pause-leave-confirm",
  ...perMode((mode) => [
    `ready-room-${mode}`,
    `race-${mode}-start`,
    `race-${mode}-hud`,
    `results-${mode}`,
    `replay-${mode}`,
    `replay-${mode}-idle`,
    `replay-${mode}-end`,
    `replay-${mode}-share`,
  ]),
  // The story: the hub, a cutscene, a chapter's first words and chip, the climb, the pause, a chapter's results, and the last card after the ending.
  "story-hub",
  "story-cutscene",
  "story-swipe-coach",
  "story-line",
  "story-playing",
  "story-paused",
  "story-results",
  "story-end",
  // What goes wrong.
  "error-server-unreachable",
  "error-boot-failed",
  "error-server-updating",
  "error-disconnected",
  "error-seat-lost",
  // The cover a phone held sideways is shown.
  "turn-upright-cover",
  // The first-visit language step once the walk's language has been picked on it.
  "first-language-chosen",
  // The story's last chapter after the lava caught her: OUT! over the climb.
  "story-caught",
];

/** The two-digit number a screen is filed under. */
export function screenNumber(screen: string): string {
  const index = SCREENS.indexOf(screen);
  if (index < 0) throw new Error(`"${screen}" is not in the screens walk's catalogue`);
  return String(index + 1).padStart(2, "0");
}

/**
 * Screen numbers and ranges (`"26"`, `"16-20"`) or `"all"`, as the catalogue
 * names them; the look list and `SCREENS_ONLY` both take this.
 */
export function parseScreens(items: string | readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const item of typeof items === "string" ? [items] : items) {
    const text = item.trim();
    if (text === "all") {
      for (const screen of SCREENS) wanted.add(screen);
      continue;
    }
    const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
    if (match === null) throw new Error(`"${text}" is not a screen number, a range like 16-20, or "all"`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    for (let number = first; number <= last; number += 1) {
      const screen = SCREENS[number - 1];
      if (screen === undefined) throw new Error(`screen number ${number} is not in the screens walk's catalogue (1 to ${SCREENS.length})`);
      wanted.add(screen);
    }
  }
  return SCREENS.filter((screen) => wanted.has(screen));
}

/** The screens this run is asked for (`SCREENS_ONLY`, comma separated); undefined means all of them. */
export function wantedScreens(env: NodeJS.ProcessEnv = process.env): readonly string[] | undefined {
  const only = (env["SCREENS_ONLY"] ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
  return only.length === 0 ? undefined : parseScreens(only);
}

/** The shots' file type: `SCREENS_FORMAT=webp` for the CI look, `jpeg` on request, PNG otherwise. */
export function shotExtension(env: NodeJS.ProcessEnv = process.env): "png" | "jpg" | "webp" {
  const format = env["SCREENS_FORMAT"] ?? "";
  return format === "webp" ? "webp" : format === "jpeg" ? "jpg" : "png";
}

/** WebP quality: text and pills read plainly at 80, at 56% of a JPEG at 80 (30 game shots, 2026-11-19). */
export const WEBP_QUALITY = 80;

/**
 * Writes a screenshot of the page's viewport. Playwright writes only PNG and JPEG, so a
 * WebP comes from Chromium's own capture. Without a clip that capture is in CSS pixels
 * (a Pixel 7 sideways came out 863x360 instead of 2265x945, 2026-11-19), so the clip
 * asks for the view's device scale, as Playwright's own shots have.
 */
export async function writeShot(page: Page, path: string, extension = shotExtension()): Promise<void> {
  if (extension === "webp") {
    const { width, height, scale } = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
    }));
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: WEBP_QUALITY,
        clip: { x: 0, y: 0, width, height, scale },
      });
      writeFileSync(path, Buffer.from(data, "base64"));
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } else if (extension === "jpg") await page.screenshot({ path, type: "jpeg", quality: 80 });
  else await page.screenshot({ path });
}

export type Host = "standalone" | "ruken";

export type View = {
  /** The folder the view's screens go in. */
  readonly key: string;
  /** The device or window, as a browser context takes it. */
  readonly options: BrowserContextOptions;
  readonly host: Host;
  /** A finger, not a mouse: the swipe coach and the on-screen controls belong to it. */
  readonly touch: boolean;
  /** A phone held sideways: the one view the "turn upright" cover belongs to. */
  readonly phoneLandscape: boolean;
};

/** A Playwright device as a context's options. The browser is the project's, so its own is dropped. */
function device(name: string): BrowserContextOptions {
  const found = devices[name];
  if (found === undefined) throw new Error(`Playwright has no device named "${name}"`);
  const options: Record<string, unknown> = { ...found };
  delete options["defaultBrowserType"];
  return options as BrowserContextOptions;
}

type Base = { key: string; options: BrowserContextOptions; phoneLandscape?: boolean };

const DEVICES: readonly Base[] = [
  { key: "iphone-se-portrait", options: device("iPhone SE") },
  { key: "iphone-se-landscape", options: device("iPhone SE landscape"), phoneLandscape: true },
  { key: "iphone-15-pro-max-portrait", options: device("iPhone 15 Pro Max") },
  { key: "iphone-15-pro-max-landscape", options: device("iPhone 15 Pro Max landscape"), phoneLandscape: true },
  { key: "pixel-7-portrait", options: device("Pixel 7") },
  { key: "pixel-7-landscape", options: device("Pixel 7 landscape"), phoneLandscape: true },
  { key: "ipad-portrait", options: device("iPad (gen 7)") },
  { key: "ipad-landscape", options: device("iPad (gen 7) landscape") },
  { key: "desktop-1280x800", options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { key: "desktop-1440x900", options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
];

/** Every view: each device standalone, then each again inside the Ruken frame. */
export const VIEWS: readonly View[] = (["standalone", "ruken"] as const).flatMap((host) =>
  DEVICES.map((base) => ({
    key: host === "standalone" ? base.key : `${base.key}-ruken`,
    options: base.options,
    host,
    touch: base.options.hasTouch === true,
    phoneLandscape: base.phoneLandscape === true,
  })),
);

/**
 * The views this run walks. `SCREENS_VIEWS` takes device keys (both hosts) or
 * full view keys, comma separated; `SCREENS_HOSTS` takes `standalone`, `ruken`
 * or both. Empty means everything.
 */
export function selectedViews(env: NodeJS.ProcessEnv = process.env): View[] {
  const wanted = (env["SCREENS_VIEWS"] ?? "").split(",").map((key) => key.trim()).filter((key) => key !== "");
  const hosts = (env["SCREENS_HOSTS"] ?? "").split(",").map((host) => host.trim()).filter((host) => host !== "");
  const chosen = VIEWS.filter(
    (view) =>
      (wanted.length === 0 || wanted.includes(view.key) || wanted.includes(view.key.replace(/-ruken$/, ""))) &&
      (hosts.length === 0 || hosts.includes(view.host)),
  );
  const unknown = wanted.filter((key) => !VIEWS.some((view) => view.key === key || view.key.replace(/-ruken$/, "") === key));
  if (unknown.length > 0) throw new Error(`SCREENS_VIEWS names no view: ${unknown.join(", ")}`);
  return chosen;
}

/**
 * The language the walk is in (`SCREENS_LOCALE`, a tag the game ships in;
 * English if unset). The owner's call, 2026-11-14: audit the screens in the
 * language with the longest text, since a screen that fits in English can
 * break in another. `pnpm i18n:lengths --longest` names it. The walk sets it
 * through the game's own language setting, so it is what a player sees.
 */
export function walkLocale(env: NodeJS.ProcessEnv = process.env): LocaleTag {
  const wanted = (env["SCREENS_LOCALE"] ?? "").trim();
  if (wanted === "") return "en";
  if (!isLocaleTag(wanted)) throw new Error(`SCREENS_LOCALE "${wanted}" is not a language the game ships in (${LOCALE_TAGS.join(", ")})`);
  return wanted;
}

/** Where the walk's screenshots go: one folder per language, a folder per view in it. */
export const SCREENS_OUT = evidenceDir(`screens/${walkLocale()}`);

/**
 * Screens a view may legitimately lack, so a gap in them is listed but is not
 * a failure: a card that appears only the first time, or only where there is
 * something to scroll, or only to a finger.
 */
export function isOptional(view: View, screen: string): boolean {
  if (["splash-loading", "settings-scrolled", "story-swipe-coach"].includes(screen)) return true;
  // Inside Ruken's frame the host owns the page and its fullscreen, so the game is meant to
  // raise no cover there (S9, #113). Until that lands the cover is shown; after it, it is
  // not. The standalone phone views carry it either way, and that is where it is audited.
  if (screen === "turn-upright-cover" && view.host === "ruken") return true;
  return false;
}

/** Whether a screen belongs on a view at all. */
export function applies(view: View, screen: string): boolean {
  if (screen === "turn-upright-cover") return view.phoneLandscape;
  return true;
}

/** The screens a view must have, and the ones it may lack. `only` narrows both to the wanted screens. */
export function expectedScreens(view: View, only: readonly string[] | undefined = wantedScreens()): { required: string[]; optional: string[] } {
  const here = SCREENS.filter((screen) => applies(view, screen) && (only === undefined || only.includes(screen)));
  return {
    required: here.filter((screen) => !isOptional(view, screen)),
    optional: here.filter((screen) => isOptional(view, screen)),
  };
}

/** The parts a view's walk is made of; each writes its own notes, so a part that never ran is known. */
export function partsOf(view: View, only: readonly string[] | undefined = wantedScreens()): string[] {
  const all = ["main", "story", "errors", ...(view.phoneLandscape ? ["cover"] : [])];
  if (only === undefined) return all;
  const { required, optional } = expectedScreens(view, only);
  return all.filter((part) => [...required, ...optional].some((screen) => partOf(screen) === part));
}

/** A drawn scene has hundreds of colours, a cleared canvas one: fewer than this on the grid is a canvas that did not draw. */
export const MIN_SAMPLED_COLOURS = 32;

/** How many different colours a PNG shows at the points of a `grid` by `grid` lattice (a cheap look, not the whole image). */
export function sampledColours(screenshot: Buffer | Uint8Array, grid = 64): number {
  const png = PNG.sync.read(Buffer.from(screenshot));
  const seen = new Set<number>();
  for (let row = 0; row < grid; row += 1) {
    const y = Math.min(png.height - 1, Math.floor(((row + 0.5) * png.height) / grid));
    for (let column = 0; column < grid; column += 1) {
      const x = Math.min(png.width - 1, Math.floor(((column + 0.5) * png.width) / grid));
      const at = (y * png.width + x) * 4;
      seen.add(((png.data[at] ?? 0) << 16) | ((png.data[at + 1] ?? 0) << 8) | (png.data[at + 2] ?? 0));
    }
  }
  return seen.size;
}

/** The part of the walk that photographs a screen. */
export function partOf(screen: string): string {
  if (screen === "turn-upright-cover") return "cover";
  if (screen.startsWith("error-")) return "errors";
  if (screen.startsWith("story-")) return "story";
  return "main";
}

/** What a view's folder holds: screen name to file name. */
export function screensTaken(view: View, root: string = SCREENS_OUT): Map<string, string> {
  const dir = resolve(root, view.key);
  const taken = new Map<string, string>();
  if (!existsSync(dir)) return taken;
  for (const file of readdirSync(dir)) {
    const match = /^(\d{2})-(.+)\.(?:png|jpg|webp)$/.exec(file);
    if (match !== null) taken.set(match[2]!, file);
  }
  return taken;
}

/** What a part of a walk could not do, kept beside the screenshots. */
export class Notes {
  private readonly lines: string[] = [];

  constructor(
    private readonly view: View,
    private readonly part: string,
  ) {}

  add(line: string): void {
    console.log(`[${this.view.key}] ${this.part}: ${line}`);
    this.lines.push(line);
  }

  get all(): readonly string[] {
    return this.lines;
  }

  /** Written whether or not anything went wrong, so a missing file means the part never ran. */
  save(): void {
    const dir = resolve(SCREENS_OUT, this.view.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `_notes-${this.part}.json`), `${JSON.stringify(this.lines, null, 2)}\n`);
  }
}

export function readNotes(view: View, root: string = SCREENS_OUT): Record<string, string[]> {
  const dir = resolve(root, view.key);
  const out: Record<string, string[]> = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    const match = /^_notes-(.+)\.json$/.exec(file);
    if (match !== null) out[match[1]!] = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as string[];
  }
  return out;
}

/** Thrown by `Shots.take` when a part has taken the last screen it was asked for, so the rest of its walk is skipped. */
export class WalkDone extends Error {}

/** The wanted screens a part could not take: each is a blank canvas, kept beside the shots. */
export function readBlank(view: View, root: string = SCREENS_OUT): string[] {
  const dir = resolve(root, view.key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^_blank-.+\.json$/.test(file))
    .flatMap((file) => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as string[]);
}

/** Every screen a view lacks, as `<view>/<nn>-<screen>`, `<view>/<nn>-<screen>: blank canvas` or `<view>: the <part> part never finished`. */
export function missingOf(view: View, root: string = SCREENS_OUT, only: readonly string[] | undefined = wantedScreens()): string[] {
  const have = screensTaken(view, root);
  const blank = readBlank(view, root);
  const notes = readNotes(view, root);
  return [
    ...expectedScreens(view, only).required.filter((screen) => !have.has(screen)).map((screen) => `${view.key}/${screenNumber(screen)}-${screen}`),
    ...blank.map((screen) => `${view.key}/${screenNumber(screen)}-${screen}: blank canvas`),
    ...partsOf(view, only).filter((part) => notes[part] === undefined).map((part) => `${view.key}: the ${part} part never finished`),
  ];
}

/** Takes the walk's photographs of one view. */
export class Shots {
  private readonly dir: string;
  private readonly touch: boolean;
  private readonly left: Set<string> | undefined;
  private readonly blank: string[] = [];

  constructor(
    view: View,
    private readonly part = "main",
    root: string = SCREENS_OUT,
  ) {
    this.dir = resolve(root, view.key);
    this.touch = view.touch;
    const only = wantedScreens();
    if (only !== undefined) {
      const { required, optional } = expectedScreens(view, only);
      this.left = new Set([...required, ...optional].filter((screen) => partOf(screen) === part));
    }
  }

  /**
   * Tells the game a finger touched it, on a touch view. The game words its
   * prompts for the input method the player used last, and the walk drives
   * the tutorial and the replay with keys, which flips it to the keyboard's
   * wording; a phone player's own taps never would. So the walk puts the
   * game back in a finger's wording before it looks, as the evidence specs
   * do (`noteTouch` in `support/story.ts`). The event reaches the game's
   * own window, which is the frame's inside the Ruken host.
   *
   * Only where keys have driven the screen (the tutorial's steps and the
   * replay): the event reaches every listener the game has on its window, so
   * on the splash it would start the game, on the swipe card dismiss it, and
   * on the replay's idle bar wake it.
   */
  async noteTouch(game: Surface): Promise<void> {
    if (!this.touch) return;
    await evaluateIn(game, () => {
      window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch" }));
    }).catch(() => undefined);
  }

  /**
   * Photographs `screen`. `page` is the browser page (the whole window, the
   * host's chrome included inside the frame); `game` is where the game lives.
   * Fonts and two frames are awaited first, never a fixed time. A screen the
   * run was not asked for (`SCREENS_ONLY`) is not photographed, and the part
   * ends once its last wanted one is.
   */
  async take(page: Page, game: Surface, screen: string): Promise<void> {
    if (this.left !== undefined && !this.left.has(screen)) return;
    const name = `${screenNumber(screen)}-${screen}.${shotExtension()}`;
    mkdirSync(this.dir, { recursive: true });
    // The bars fade from the splash's black over the first frames of the title; a shot taken
    // half way showed a dim band across the top of the iPad's title.
    await game
      .locator("canvas[data-bars-fade]")
      .first()
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => console.log(`[screens] ${screen}: the letterbox fade was still running after 15 s; the shot may show a band`));
    await evaluateIn(
      game,
      () =>
        document.fonts.ready.then(() => {
          const waited = new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          // A page whose frames are stepped by hand (`FRAME_CONTROL`) draws the two frames only when told:
          // without this the wait never ends and the walk hangs until its test times out.
          (window as unknown as { __capture?: { step(count: number, ms: number): void } }).__capture?.step(2, 1000 / 60);
          return waited;
        }),
    ).catch(() => undefined);
    const path = resolve(this.dir, name);
    await writeShot(page, path);
    await this.checkDrawn(game, screen);
    if (this.left === undefined) return;
    this.left.delete(screen);
    if (this.left.size === 0) throw new WalkDone();
  }

  /** A canvas that is on screen but one flat colour did not draw: the shot is kept and the screen is recorded as blank. */
  private async checkDrawn(game: Surface, screen: string): Promise<void> {
    const canvas = game.locator("canvas").first();
    if (!(await canvas.isVisible().catch(() => false))) return;
    const picture = await canvas.screenshot().catch(() => undefined);
    if (picture === undefined || sampledColours(picture) >= MIN_SAMPLED_COLOURS) return;
    this.blank.push(screen);
    writeFileSync(resolve(this.dir, `_blank-${this.part}.json`), `${JSON.stringify(this.blank)}\n`);
  }
}
