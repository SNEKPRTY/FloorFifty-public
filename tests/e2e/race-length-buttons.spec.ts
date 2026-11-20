/**
 * The ready room's race length buttons stay readable (screens audit
 * 2026-11-14, L1): on an iPhone SE held upright the Survival button's badge
 * broke mid-word ("FEATU / RED") and the 20 and 50 buttons stacked their
 * digits ("2" over "0"). `.ff-aq-control` lets a word break anywhere
 * (`overflow-wrap: anywhere`), which also lets a flex item shrink below its
 * own text, so a row that did not fit squeezed the buttons instead of wrapping.
 *
 * The check is the way a player meets it, line by line: every piece of text in
 * the race options (the Floors group's label, each button's label and the
 * Survival badge, and the Minutes group beside it) lays out on a single line,
 * a button's parts sit side by side, no button runs off the screen and none
 * clips its own text. It runs in the four languages with the longest
 * words and on every phone, tablet and desktop size the audit walked.
 */

import { devices, expect, test, type BrowserContextOptions, type Page } from "./support/test";
import { LOCALE_TAGS, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { createRoom, openClients } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

type View = { name: string; context: BrowserContextOptions };

const phone = (name: string, width: number, height: number): View[] => [
  { name: `${name}-portrait`, context: { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: `${name}-landscape`, context: { viewport: { width: height, height: width }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];

/** Playwright's "iPhone SE" is the first generation, 320 × 568: the size the audit's pictures were taken at. */
const FIRST_GEN_SE = devices["iPhone SE"]!.viewport!;

export const VIEWS: readonly View[] = [
  ...phone("iphone-se", 375, 667),
  ...phone("iphone-se-1st-gen", FIRST_GEN_SE.width, FIRST_GEN_SE.height),
  ...phone("iphone-large", 430, 932),
  ...phone("pixel-7", 412, 915),
  ...phone("ipad", 820, 1180).map((view) => ({ ...view, context: { ...view.context, isMobile: false } })),
  { name: "desktop-1280x800", context: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { name: "desktop-1920x1080", context: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 } },
];

/** The four languages the task names: the longest measured (es-419), then pt-BR, zh-Hans and English. */
export const LOCALES: readonly LocaleTag[] = LOCALE_TAGS.filter((tag) => ["en", "es-419", "pt-BR", "zh-Hans"].includes(tag));

/**
 * Lines and sides, measured in the page. A text node's client rects are its
 * line boxes: two rects at different heights are a wrapped line, and a word
 * broken mid-word is exactly that. The parts of a button (its text, the icon,
 * the badge) must share one line too, so a badge dropped under its label fails.
 */
export async function measureFloorsGroup(page: Page): Promise<{ wrapped: string[]; stacked: string[]; outside: string[]; cutOff: string[]; covered: string[] }> {
  return page.getByTestId("mode-chooser").evaluate((group) => {
    const wrapped: string[] = [];
    const stacked: string[] = [];
    const outside: string[] = [];
    const cutOff: string[] = [];
    const covered: string[] = [];
    // Every race option: the Floors group, and the Minutes (or Laps) group beside it.
    const options = group.closest("[data-testid=race-options]") ?? group;
    const lines = (rects: DOMRectList | DOMRect[]): number => {
      const tops: number[] = [];
      for (const rect of Array.from(rects)) {
        if (rect.width < 1 || rect.height < 1) continue;
        if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top);
      }
      return tops.length;
    };
    const textNodes = (root: Node): Text[] => {
      const found: Text[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() !== "") found.push(node as Text);
      }
      return found;
    };
    for (const node of textNodes(options)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const count = lines(range.getClientRects());
      if (count > 1) wrapped.push(`"${(node.textContent ?? "").trim()}" takes ${count} lines`);
    }
    for (const button of Array.from(options.querySelectorAll("button"))) {
      const name = button.getAttribute("data-testid") ?? "button";
      const parts: DOMRect[] = [];
      for (const node of textNodes(button)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        parts.push(range.getBoundingClientRect());
      }
      for (const icon of Array.from(button.querySelectorAll(".ff-option__icon, .ff-option__badge"))) parts.push(icon.getBoundingClientRect());
      if (lines(parts) > 1) stacked.push(`${name}: its parts sit on ${lines(parts)} lines`);
      const box = button.getBoundingClientRect();
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5) outside.push(`${name} runs off the screen (${Math.round(box.left)}..${Math.round(box.right)} of ${window.innerWidth})`);
    }
    // Cut off: a box that clips its own text. Every race option counts, the
    // Minutes group beside Floors included.
    for (const el of [options, ...Array.from(options.querySelectorAll("*"))]) {
      // A 1 px box is text only a screen reader hears, not text cut off.
      if (el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") cutOff.push(`${el.getAttribute("data-testid") ?? el.tagName} clips its text sideways`);
    }
    // The options are plain rows, not a scroller, so no "more" line exists to
    // cover a button; and nothing else may sit over one (the status line,
    // Ready, Leave room), nor may the rows run into the line after them.
    if (options.closest(".ff-scroll-list") !== null) covered.push("the race options are inside a scroll list");
    if (document.querySelector("[data-testid=ready-room] [data-testid=scroll-more]") !== null) covered.push("a more line is showing in the ready room");
    for (const button of Array.from(options.querySelectorAll("button"))) {
      const name = button.getAttribute("data-testid") ?? "button";
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (top !== null && top !== button && !button.contains(top)) covered.push(`${name} is under ${top.getAttribute("data-testid") ?? top.tagName}`);
      if (box.top < -0.5 || box.bottom > window.innerHeight + 0.5) outside.push(`${name} is off the screen vertically (${Math.round(box.top)}..${Math.round(box.bottom)} of ${window.innerHeight})`);
    }
    const next = document.querySelector("[data-testid=race-options-status]")?.getBoundingClientRect();
    if (next !== undefined && options.getBoundingClientRect().bottom > next.top + 1) covered.push("the race options run into the line after them");
    return { wrapped, stacked, outside, cutOff, covered };
  });
}

/** The pictures the audit keeps: every view in es-419, and the two small portrait phones in all four languages. */
const SHOT_VIEWS = new Set(VIEWS.map((view) => view.name));
const SHOT_ALL_LOCALES = new Set(["iphone-se-portrait", "iphone-se-1st-gen-portrait"]);

for (const view of VIEWS) {
  for (const locale of LOCALES) {
    test(`${locale} on ${view.name}: the race length buttons each sit on one line`, async ({ browser }) => {
      test.slow();
      const [page] = await openClients(browser, 1, { locale, seen: { swipeCoach: true } }, { context: { reducedMotion: "reduce", ...view.context } });
      await createRoom(page!, "Nana");
      const group = page!.getByTestId("mode-chooser");
      await expect(group).toBeVisible();
      // Fonts and the room's first snapshot settle before the lines are read.
      await page!.evaluate(() => document.fonts.ready);
      // `SHOT_DIR` and `SHOT_PREFIX` (before/after) save the audit's pictures; a
      // picture is taken before anything is asserted, so a red run still has one.
      const shotDir = process.env["SHOT_DIR"];
      if (shotDir !== undefined && SHOT_VIEWS.has(view.name) && (locale === "es-419" || SHOT_ALL_LOCALES.has(view.name))) {
        await page!.screenshot({ path: `${shotDir}/${process.env["SHOT_PREFIX"] ?? "after"}-${view.name}-${locale}.png` });
      }
      if (process.env["SHOT_ONLY"] === "1") return;
      const found = await measureFloorsGroup(page!);
      expect.soft(found.wrapped, `${locale} ${view.name}: text that wraps`).toEqual([]);
      expect.soft(found.stacked, `${locale} ${view.name}: parts of a button on separate lines`).toEqual([]);
      expect.soft(found.outside, `${locale} ${view.name}: buttons off the screen`).toEqual([]);
      expect.soft(found.cutOff, `${locale} ${view.name}: text cut off inside its own button`).toEqual([]);
      expect.soft(found.covered, `${locale} ${view.name}: a button covered, or the rows run into the next line`).toEqual([]);
    });
  }
}
