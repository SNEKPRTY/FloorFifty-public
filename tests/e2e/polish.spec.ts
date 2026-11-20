/**
 * Polish (polish spec §10.1): lobby → ready → race → results in both motions
 * with no console error; the input rule; `confirm` keeping its width; and a
 * four-player race plus ten transitions leaving every counter where it began.
 */

import { expect, test, type Page } from "./support/test";
import { LOCALE_TAGS, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { forceSetPiece, liveParticles, liveWords, readCounters, stressJuice, widestWord } from "./support/inspection";
import { raceToResults, settledCounters } from "./support/race";
import {
  createRoom,
  enterLobby,
  expectScreen,
  joinRoom,
  openClients,
  openTitle,
  passSelect,
  pickStage,
  readyOnly,
} from "./support/room-driver";
import type { Browser } from "./support/test";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

/** Console errors from here on. */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Ms from a click on `opener` until `target` takes a click: present, not
 * inert, not `pointer-events: none` (polish spec §5.3, the input rule). Read
 * in turns of the event loop, not frames (below).
 */
async function inputLatency(page: Page, opener: string, target: string): Promise<number> {
  return page.evaluate(
    async ([openerId, targetId]) => {
      const started = performance.now();
      document.querySelector<HTMLElement>(`[data-testid='${openerId}']`)!.click();
      for (;;) {
        const live = [...document.querySelectorAll<HTMLElement>(`[data-testid='${targetId}']`)].find(
          (node) => node.closest("[inert]") === null && getComputedStyle(node).pointerEvents !== "none",
        );
        if (live !== undefined) return performance.now() - started;
        // A turn of the event loop, not a frame: the rule is about when the
        // control takes input, and a page drawing eight frames a second would
        // measure its frame gap (focused run 37970750279 read 121.1 ms for a
        // Close that was live in the first turn). A page that is busy for longer
        // than the rule still reads long, since nothing else runs in its turns.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [opener, target] as const,
  );
}

/** Back to the title from Results, as a player does. */
async function returnToTitle(page: Page): Promise<void> {
  await page.getByTestId("return-to-menu").click();
  await expectScreen(page, "title", 20_000);
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`lobby to results, ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test("walks with no console error, and holds the input rule on the way back", async ({ browser }) => {
      test.slow();
      const opened = await openClients(browser, 2);
      const errors = opened.map(consoleErrors);
      const { pages } = await raceToResults(browser, 2, opened);
      for (const page of pages) await expect(page.getByTestId("winner")).toBeVisible();
      await returnToTitle(pages[0]!);
      expect(await inputLatency(pages[0]!, "title-settings", "modal-close"), "Close takes input within 120 ms").toBeLessThan(120);
      expect(errors.flat()).toEqual([]);
    });
  });
}

test.describe("confirm keeps its width", () => {
  // Every locale (plan Task 12 Step 4): the two labels share one cell, so the
  // button is as wide as its longer label in whatever language is showing.
  for (const locale of LOCALE_TAGS) {
    test(`${locale}: pressing Copy swaps to Copied without moving the room code or changing the button's width`, async ({ browser }) => {
      const [page] = await openClients(browser, 1, { locale });
      await expect(page!.locator("html")).toHaveAttribute("lang", locale);
      await createRoom(page!, "Alpha");
      const copy = page!.getByTestId("copy-code");
      const code = page!.getByTestId("room-code");
      const before = { button: (await copy.boundingBox())!, code: (await code.boundingBox())! };
      expect(before.button.width).toBeGreaterThan(0);
      await copy.click();
      await expect(copy).toHaveAttribute("data-copied", "true");
      const after = { button: (await copy.boundingBox())!, code: (await code.boundingBox())! };
      expect(after.button.width, "the button's width").toBe(before.button.width);
      expect(after.code.x, "the room code beside it").toBe(before.code.x);
      // And back, after CONFIRM_MS.
      await expect(copy).toHaveAttribute("data-copied", "false", { timeout: 5_000 });
      expect((await copy.boundingBox())!.width).toBe(before.button.width);
    });
  }
});

test.describe("leaks", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the baseline is read after the title's call has ended", async ({ page }) => {
    // The first arrival at the title slams and calls the game's name, and those two cues are
    // in the audio count while they sound. A baseline read during them is higher than the
    // title a player comes back to from a race, which makes no call.
    await openTitle(page);
    const settled = await settledCounters(page);
    await page.waitForTimeout(4_000);
    expect((await readCounters(page)).audioSources, "the baseline was taken with the title's call still sounding").toBe(
      settled.audioSources,
    );
  });

  test("a four-player race and ten transitions leave every counter at baseline", async ({ browser }) => {
    test.slow();
    const host = await (await browser.newContext()).newPage();
    await openTitle(host);
    const before = await settledCounters(host);
    expect(before.displayObjects, "a title that drew nothing makes the comparison vacuous").toBeGreaterThan(0);

    await enterLobby(host);
    const others = await openClients(browser, 3);
    await raceToResults(browser, 4, [host, ...others]);
    await returnToTitle(host);

    // Ten shell transitions: Settings opening and closing, five times.
    for (let round = 0; round < 5; round += 1) {
      await host.getByTestId("title-settings").click();
      await expect(host.getByTestId("settings-modal")).toBeVisible();
      await host.getByTestId("modal-close").click();
      await expect(host.getByTestId("settings-modal")).toHaveCount(0);
    }

    for (const counter of ["displayObjects", "worldObjects", "audioSources"] as const) {
      await expect
        .poll(async () => (await readCounters(host))[counter], { timeout: 15_000, message: `${counter} back to baseline` })
        .toBe(before[counter]);
    }
  });
});

/** Two clients into a race on Rooftops, in `locale`; returns the host, racing. */
async function raceOnRooftops(browser: Browser, locale?: LocaleTag): Promise<{ host: Page; pages: Page[] }> {
  const pages = await openClients(browser, 2, locale === undefined ? {} : { locale });
  const host = pages[0]!;
  const code = await createRoom(host, "Kite");
  await joinRoom(pages[1]!, code, "Ninja 2");
  await readyOnly(pages);
  for (const page of pages) {
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await pickStage(page, "rooftops");
  }
  await passSelect(pages);
  await expectScreen(host, "gameplay");
  await host.bringToFront();
  return { host, pages };
}

test.describe("Wonder (Wonder spec §8)", () => {
  test("a slam says a word on screen", async ({ browser }) => {
    test.slow();
    const { host, pages } = await raceOnRooftops(browser);
    const errors = consoleErrors(host);
    try {
      await stressJuice(host, true);
      await expect.poll(() => liveWords(host), { timeout: 5_000, message: "the stress slams pop words" }).toBeGreaterThan(0);
      await stressJuice(host, false);
      expect(errors).toEqual([]);
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined);
    }
  });

  test("switching character effects off mid-race clears the words and the dust, and on brings them back", async ({ browser }) => {
    test.slow();
    const { host, pages } = await raceOnRooftops(browser);
    const errors = consoleErrors(host);
    try {
      await stressJuice(host, true);
      await expect.poll(() => liveWords(host), { timeout: 5_000, message: "the stress slams pop words" }).toBeGreaterThan(0);
      await expect.poll(() => liveParticles(host), { timeout: 5_000 }).toBeGreaterThan(0);

      await host.keyboard.press("Escape");
      await host.getByTestId("pause-settings").click();
      await host.getByTestId("settings-character-effects").uncheck();
      // The stress keeps slamming under the pause: nothing may draw for a second.
      await expect.poll(() => liveWords(host), { timeout: 2_000 }).toBe(0);
      await expect.poll(() => liveParticles(host), { timeout: 2_000 }).toBe(0);
      for (let sample = 0; sample < 4; sample += 1) {
        await host.waitForTimeout(250);
        expect(await liveWords(host)).toBe(0);
        expect(await liveParticles(host)).toBe(0);
      }

      await host.getByTestId("settings-character-effects").check();
      await expect.poll(() => liveParticles(host), { timeout: 5_000, message: "the dust comes back" }).toBeGreaterThan(0);
      await stressJuice(host, false);
      expect(errors).toEqual([]);
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined);
    }
  });

  test("a set piece plays at the gate's call", async ({ browser }) => {
    test.slow();
    const { host, pages } = await raceOnRooftops(browser);
    const errors = consoleErrors(host);
    try {
      expect(await forceSetPiece(host, 45)).toBe(true);
      expect(await forceSetPiece(host, 33)).toBe(false);
      await host.waitForTimeout(6_000);
      expect(errors).toEqual([]);
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined);
    }
  });

  // Every word at its largest fits the view in every language, with a margin.
  for (const locale of LOCALE_TAGS) {
    test(`${locale}: every word fits the view`, async ({ browser }) => {
      test.slow();
      const { host, pages } = await raceOnRooftops(browser, locale);
      try {
        const widest = await widestWord(host);
        expect(widest, "a word was laid out").toBeGreaterThan(0);
        expect(widest, `the widest ${locale} word fits 960 less a 32-unit margin`).toBeLessThan(960 - 32);
      } finally {
        for (const page of pages) await page.context().close().catch(() => undefined);
      }
    });
  }
});
