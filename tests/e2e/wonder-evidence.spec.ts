/**
 * Wonder's evidence (Wonder spec §8): each racing stage's set pieces, forced
 * one at a time, and the pop-up words in English and Japanese, for the owner's
 * gate. Writes to `evidence/wonder/`, which git ignores; nothing is compared.
 */
import { expect, test, type Browser, type Page } from "./support/test";
import type { LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { evidenceDir } from "./support/evidence";
import { forceSetPiece, liveWords, stressJuice } from "./support/inspection";
import { createRoom, expectScreen, joinRoom, openClients, passSelect, pickStage, readyOnly } from "./support/room-driver";

const SHOTS = evidenceDir("wonder");
const STAGES = ["rooftops", "snow-shrine", "sunken-dome"] as const;
const FLOORS = [10, 22, 34, 45, 50] as const;

/** Two clients into a race on `stage`, in `locale`; returns the host, racing. */
async function raceOn(browser: Browser, stage: string, locale?: LocaleTag): Promise<{ host: Page; pages: Page[] }> {
  const pages = await openClients(browser, 2, locale === undefined ? {} : { locale });
  const host = pages[0]!;
  const code = await createRoom(host, "Kite");
  await joinRoom(pages[1]!, code, "Ninja 2");
  await readyOnly(pages);
  for (const page of pages) {
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await pickStage(page, stage);
  }
  await passSelect(pages);
  await expectScreen(host, "gameplay");
  await host.bringToFront();
  await host.waitForTimeout(3_000);
  return { host, pages };
}

for (const stage of STAGES) {
  test(`${stage}: each set piece`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one set, on the largest viewport");
    test.slow();
    const { host, pages } = await raceOn(browser, stage);
    try {
      for (const floor of FLOORS) {
        if (!(await forceSetPiece(host, floor))) continue;
        await host.waitForTimeout(1_500);
        await host.screenshot({ path: `${SHOTS}/${stage}-${floor}.png` });
      }
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined);
    }
  });
}

for (const locale of ["en", "ja"] as const) {
  test(`${locale}: the words`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one set, on the largest viewport");
    test.slow();
    const { host, pages } = await raceOn(browser, "rooftops", locale);
    try {
      await stressJuice(host, true);
      await expect.poll(() => liveWords(host), { timeout: 5_000 }).toBeGreaterThan(0);
      await host.waitForTimeout(150);
      await host.screenshot({ path: `${SHOTS}/words-${locale}.png` });
      await stressJuice(host, false);
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined);
    }
  });
}
