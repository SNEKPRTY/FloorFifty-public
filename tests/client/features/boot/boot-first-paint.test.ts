/**
 * The boot loader from the first paint (Ruken loading plan, Task 2).
 *
 * Inside Ruken the host lifts its own cover the moment the game says hello,
 * so what the page shows then is the only thing standing between the player
 * and a bare frame: the loader must be on screen from the first paint, not
 * fading in 540 ms later, and the game must say hello only once it is.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOOT_LOADER_FADE_MS,
  afterFirstPaint,
  bootProgressValue,
  reportBootStep,
  resetBootProgress,
  wordBootLoader,
} from "../../../../apps/client/src/features/boot/boot-loader";
import { SLOW_MS } from "../../../../apps/client/src/lib/load-meter";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";
import { ManualTimers } from "../../support/manual-timers";

const INDEX = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/index.html"), "utf8");

/** The declarations of the first rule for `selector` in the page's inline style. */
function ruleFor(selector: string): string {
  const style = /<style>([\s\S]*?)<\/style>/.exec(INDEX)?.[1] ?? "";
  const escaped = selector.replace(/[.#]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(style);
  if (match === null) throw new Error(`index.html has no rule for ${selector}`);
  return match[1]!;
}

describe("index.html's loader", () => {
  it("is on screen from the first paint: no delay, no fade-in, no opacity to wait out", () => {
    const rule = ruleFor("#ff-boot-loader");
    expect(rule).not.toMatch(/opacity:\s*0/);
    expect(rule).not.toMatch(/animation:/);
    // It still fades out when the splash shows (`ff-boot-loader--gone`).
    expect(ruleFor("#ff-boot-loader.ff-boot-loader--gone")).toMatch(/opacity:\s*0/);
  });

  it("comes before the app and the script in the body, so the first paint has it", () => {
    const loader = INDEX.indexOf('id="ff-boot-loader"');
    expect(loader).toBeGreaterThan(INDEX.indexOf("<body>"));
    expect(loader).toBeLessThan(INDEX.indexOf('id="app"'));
    expect(loader).toBeLessThan(INDEX.indexOf('<script type="module"'));
  });

  it("holds a progress bar and a slow line, and the slow line waits the slow time before it shows", () => {
    expect(INDEX).toContain('data-testid="boot-progress"');
    expect(INDEX).toContain('data-testid="boot-slow"');
    // CSS alone, so it works while the script is still downloading.
    expect(ruleFor(".ff-boot-loader__slow")).toMatch(new RegExp(`animation:[^;]*\\s${SLOW_MS / 1000}s\\b`));
    expect(ruleFor(".ff-boot-loader__slow")).toMatch(/opacity:\s*0/);
  });
});

describe("the loader's progress", () => {
  const plant = (): HTMLElement => {
    document.body.innerHTML = INDEX.slice(INDEX.indexOf('<div id="ff-boot-loader"'), INDEX.indexOf('<div id="app"'));
    return document.getElementById("ff-boot-loader")!;
  };
  const bar = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="boot-progress"]')!;

  beforeEach(() => resetBootProgress());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts hidden and shows a bar that follows real steps, never backwards", () => {
    plant();
    expect(bar().hidden).toBe(true);
    reportBootStep("host", 1);
    expect(bar().hidden).toBe(false);
    const afterHost = Number(bar().getAttribute("aria-valuenow"));
    expect(afterHost).toBeGreaterThan(0);

    reportBootStep("content", 0.5);
    const midContent = Number(bar().getAttribute("aria-valuenow"));
    expect(midContent).toBeGreaterThan(afterHost);
    // A step reporting less than it already did changes nothing.
    reportBootStep("content", 0.1);
    expect(Number(bar().getAttribute("aria-valuenow"))).toBe(midContent);
    expect(bar().querySelector<HTMLElement>(".ff-boot-loader__fill")!.style.width).toBe(`${midContent}%`);
  });

  it("reaches 100 only when every step has", () => {
    plant();
    for (const step of ["host", "content", "manifest", "fonts"] as const) reportBootStep(step, 1);
    expect(bootProgressValue()).toBeLessThan(1);
    reportBootStep("art", 1);
    expect(bootProgressValue()).toBe(1);
    expect(bar().getAttribute("aria-valuenow")).toBe("100");
  });

  it("is quiet when the loader is already gone", () => {
    expect(() => reportBootStep("host", 1)).not.toThrow();
  });

  it("says its words in the player's language once it is known, the slow line included", () => {
    plant();
    const undo = installLocaleStrategy(new SettingsStore(memoryStorage()), () => ["ja-JP"]);
    try {
      wordBootLoader();
      expect(document.querySelector('[data-testid="boot-slow"]')!.textContent).toBe("まだ読み込み中です。少し時間がかかることがあります。");
    } finally {
      undo();
    }
  });

  it("keeps its fade as long as the splash's cover takes to lift", () => {
    expect(BOOT_LOADER_FADE_MS).toBe(320);
  });
});

describe("saying hello only once the loader is painted", () => {
  it("waits for a frame, and then for the turn after it, which is when that frame is on screen", async () => {
    const timers = new ManualTimers();
    const frames: FrameRequestCallback[] = [];
    let painted = false;
    void afterFirstPaint({ requestFrame: (callback) => frames.push(callback), timers }).then(() => (painted = true));

    await timers.advance(100);
    expect(painted).toBe(false);

    frames[0]!(16);
    await Promise.resolve();
    expect(painted).toBe(false);
    await timers.advance(0);
    expect(painted).toBe(true);
  });

  it("does not hold the boot for a page that never gets a frame (a hidden iframe)", async () => {
    const timers = new ManualTimers();
    let painted = false;
    void afterFirstPaint({ requestFrame: () => undefined, timers }).then(() => (painted = true));
    await timers.advance(249);
    expect(painted).toBe(false);
    await timers.advance(1);
    expect(painted).toBe(true);
    expect(timers.waiting).toBe(0);
  });
});
