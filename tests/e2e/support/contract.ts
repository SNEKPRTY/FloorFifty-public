import { expect, type Page } from "@playwright/test";
import { expectControlsFit, expectNoDocumentScroll } from "./layout";

/**
 * The screen contract (UI layout system spec §8.2), run on every state the
 * screen catalogue visits. Soft, like the sweep's checks: one screen's
 * failure must not hide the next screen's.
 *
 * 1. Every visible control and panel lies inside the visible band
 *    (`--ff-band-top`..`--ff-band-bottom`) and the viewport's width.
 * 2. Every `ScrollList` (`[data-min-rows]`) shows at least
 *    min(minRows, rowCount) whole rows (`[data-row]`).
 * 3. Nothing clips its content unless it is `[data-truncatable]` or a
 *    `ScrollList`. A bare `[data-scroll-region]` does not count: every
 *    scrollable area is a `ScrollList` (spec §2.1 rule 2).
 * 4. Every `ActionBar` (`[data-action-bar]`) keeps its items on one line.
 * 5. (Across screens, in the spec: `expectSameCorner`.)
 * 6. In a row (`[data-row]`, a HUD standings row), no two items overlap and
 *    none runs past the row's ends: a name and the pick beside it, or a climb
 *    bar and the next racer.
 * 7. Nothing is drawn over a corner control (`[data-corner-controls]`), unless
 *    a dialog is open over the screen.
 * 8. No outline or ring is cut off: an element's `outline`, or a `box-shadow`
 *    with a spread (a selected seat's ring, the winner's ink ring), stays
 *    inside every ancestor that clips its overflow.
 * 9. A button that is only an icon (no text) holds it centred, across and
 *    down, to within a pixel: a typed glyph sits off its button's middle.
 * Plus the sweep's own: controls on screen and 44 px on touch, and no
 * document scroll.
 */

export type Rect = { x: number; y: number; width: number; height: number };

type Problems = { band: string[]; rows: string[]; clipped: string[]; bars: string[]; crowded: string[]; covered: string[]; rings: string[]; icons: string[] };

export async function expectScreenContract(page: Page, options: { screen?: string; touch?: boolean } = {}): Promise<void> {
  const label = options.screen ?? "screen";
  const found = await page.evaluate((): Problems => {
    const out: Problems = { band: [], rows: [], clipped: [], bars: [], crowded: [], covered: [], rings: [], icons: [] };
    const root = getComputedStyle(document.documentElement);
    const px = (name: string, fallback: number): number => {
      const value = parseFloat(root.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const top = px("--ff-band-top", 0);
    const bottom = px("--ff-band-bottom", innerHeight);
    const name = (node: Element): string => {
      const html = node as HTMLElement;
      return html.dataset?.["testid"] ?? ((html.textContent ?? "").trim().slice(0, 24) || node.tagName.toLowerCase());
    };
    const shown = (node: Element): boolean => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      // Visually hidden text (`sr-only`: a 1 px box that clips) is for
      // assistive technology, not on screen. 2 px, not 1: under a tablet's
      // shell zoom (`--ff-ui-zoom`) the 1 px box measures 1.2 to 1.4.
      if (rect.width <= 2 && rect.height <= 2) return false;
      if (node.closest("[inert], [aria-hidden='true']") !== null) return false;
      for (let at: Element | null = node; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      }
      return true;
    };

    // 1. Inside the band. A control inside a scroll list is judged by its list.
    const banded = "button, input, [role='button'], [role='dialog'], [data-action-bar], [data-scroll-region], [data-screen-frame] > *";
    for (const node of document.querySelectorAll(banded)) {
      if (!shown(node)) continue;
      if (node.parentElement?.closest("[data-scroll-region]") != null) continue;
      const rect = node.getBoundingClientRect();
      if (rect.top < top - 0.5 || rect.bottom > bottom + 0.5 || rect.left < -0.5 || rect.right > innerWidth + 0.5) {
        out.band.push(
          `${name(node)} spans ${Math.round(rect.top)}-${Math.round(rect.bottom)} x ${Math.round(rect.left)}-${Math.round(rect.right)}, band ${Math.round(top)}-${Math.round(bottom)} x 0-${innerWidth}`,
        );
      }
    }

    // 2. Minimum whole rows. An action bar's `[data-row="visible"]` is not a list row.
    for (const list of document.querySelectorAll<HTMLElement>("[data-min-rows]")) {
      if (!shown(list)) continue;
      const rows = [...list.querySelectorAll<HTMLElement>('[data-row]:not([data-row="visible"])')];
      const want = Math.min(Number(list.dataset["minRows"]), rows.length);
      const box = list.getBoundingClientRect();
      const whole = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
      }).length;
      if (whole < want) out.rows.push(`${name(list)} shows ${whole} whole rows of ${rows.length}, needs ${want}`);
    }

    // 3. Hidden clipping.
    const skip = new Set(["HTML", "BODY", "INPUT", "TEXTAREA", "SELECT", "CANVAS", "svg", "SCRIPT", "STYLE"]);
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      if (skip.has(node.tagName) || !shown(node)) continue;
      const style = getComputedStyle(node);
      const clips = /(hidden|clip|auto|scroll)/.test(style.overflowX + style.overflowY) || style.textOverflow === "ellipsis";
      if (!clips) continue;
      if (node.closest("[data-truncatable], [data-min-rows]") !== null) continue;
      // `#app` clips the overlay on purpose: the overlay tracks the 16:9 field,
      // which overhangs a screen wider than 16:9, and the clip keeps that
      // overhang from scrolling the page (styles.css).
      if (node.id === "app") continue;
      const wide = node.scrollWidth > node.clientWidth + 1;
      const tall = node.scrollHeight > node.clientHeight + 1;
      if (wide || tall) {
        out.clipped.push(
          `${name(node)} clips ${wide ? `${node.scrollWidth - node.clientWidth}px wide` : ""}${wide && tall ? ", " : ""}${tall ? `${node.scrollHeight - node.clientHeight}px tall` : ""}`,
        );
      }
    }

    // 4. One-row action bars. The buttons sit in the bar's visible row
    // (`[data-row="visible"]`, Task 2a); the bar's other children are its
    // hidden measuring rows, which are never on screen.
    for (const bar of document.querySelectorAll<HTMLElement>("[data-action-bar]")) {
      if (!shown(bar)) continue;
      const row = bar.querySelector<HTMLElement>(':scope > [data-row="visible"]') ?? bar;
      const tops = [...row.children].filter(shown).map((item) => item.getBoundingClientRect().top);
      if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 2) {
        out.bars.push(`${name(bar)} wraps (${new Set(tops.map(Math.round)).size} lines)`);
      }
    }
    // 6. A row's items keep apart and inside it. An action bar's
    // `[data-row="visible"]` is not a list row. What is drawn counts, so an
    // `aria-hidden` climb bar or dot does too; a control laid over the whole
    // row (the ready room's `seat-change`) is out of the row's flow.
    const drawn = (node: Element): boolean => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      for (let at: Element | null = node; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    for (const row of document.querySelectorAll<HTMLElement>('[data-row]:not([data-row="visible"]), [data-testid="hud-row"]')) {
      if (!drawn(row) || row.closest("[inert]") !== null) continue;
      const box = row.getBoundingClientRect();
      const items = [...row.children]
        .filter((item) => drawn(item) && getComputedStyle(item).position !== "absolute")
        .map((item) => ({ item, rect: item.getBoundingClientRect() }));
      for (const { item, rect } of items) {
        if (rect.left < box.left - 1 || rect.right > box.right + 1) {
          out.crowded.push(`${name(item)} runs past its row (${Math.round(rect.left)}-${Math.round(rect.right)} in ${Math.round(box.left)}-${Math.round(box.right)})`);
        }
      }
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i]!.rect;
          const b = items[j]!.rect;
          const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (across > 1 && down > 1) out.crowded.push(`${name(items[i]!.item)} overlaps ${name(items[j]!.item)} in ${name(row)}`);
        }
      }
    }

    // 7. The corner controls are on top: what is drawn at each one's centre
    // is that control. A dialog open over the screen covers them on purpose.
    const dialogOpen = [...document.querySelectorAll("[role='dialog']")].some(
      (dialog) => shown(dialog) && dialog.querySelector("[data-corner-controls]") === null,
    );
    if (!dialogOpen) {
      for (const control of document.querySelectorAll<HTMLElement>("[data-corner-controls] button")) {
        if (!shown(control)) continue;
        const rect = control.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (hit !== null && !control.contains(hit)) out.covered.push(`${name(control)} is under ${name(hit)}`);
      }
    }

    // 8. Rings drawn whole. How far each element paints past its border box:
    // its outline, and each box-shadow's spread and offset (blur is a soft
    // edge, not a line, so it may fade into a clip).
    const reach = (node: Element): { top: number; right: number; bottom: number; left: number } | undefined => {
      const style = getComputedStyle(node);
      const out = { top: 0, right: 0, bottom: 0, left: 0 };
      const outline = style.outlineStyle !== "none" ? parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset || "0") : 0;
      if (outline > 0.5) {
        out.top = out.right = out.bottom = out.left = outline;
      }
      if (style.boxShadow !== "none") {
        // Each shadow: [inset] x y blur spread colour; colours may hold commas.
        for (const shadow of style.boxShadow.split(/,(?![^(]*\))/)) {
          if (/\binset\b/.test(shadow)) continue;
          const lengths = [...shadow.replace(/rgba?\([^)]*\)|#[0-9a-f]+|[a-z-]+\([^)]*\)/gi, "").matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
          const [x = 0, y = 0, , spread = 0] = lengths;
          if (spread <= 0.5) continue;
          out.top = Math.max(out.top, spread - y);
          out.bottom = Math.max(out.bottom, spread + y);
          out.left = Math.max(out.left, spread - x);
          out.right = Math.max(out.right, spread + x);
        }
      }
      return out.top + out.right + out.bottom + out.left > 0 ? out : undefined;
    };
    const ringCut = (node: HTMLElement, far: { top: number; right: number; bottom: number; left: number }): string | undefined => {
      const rect = node.getBoundingClientRect();
      const paint = { top: rect.top - far.top, right: rect.right + far.right, bottom: rect.bottom + far.bottom, left: rect.left - far.left };
      for (let at = node.parentElement; at !== null && at !== document.body; at = at.parentElement) {
        const style = getComputedStyle(at);
        const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX);
        const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        // The clip is the padding box: the border box less the borders.
        const box = at.getBoundingClientRect();
        const inner = {
          top: box.top + parseFloat(style.borderTopWidth),
          bottom: box.bottom - parseFloat(style.borderBottomWidth),
          left: box.left + parseFloat(style.borderLeftWidth),
          right: box.right - parseFloat(style.borderRightWidth),
        };
        // Only a ring the clip cuts where the element itself is in view: a row
        // scrolled out of a list is cut whole, which is scrolling, not a clip.
        const visible = rect.bottom > inner.top && rect.top < inner.bottom && rect.right > inner.left && rect.left < inner.right;
        if (!visible) break;
        // A list that scrolls brings a part-hidden control wholly into view
        // when it takes focus, clear of its scroll padding, so only a control
        // already there has its ring judged here.
        const scrolls = /(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight + 1;
        const padTop = parseFloat(style.scrollPaddingTop) || 0;
        const padBottom = parseFloat(style.scrollPaddingBottom) || 0;
        const whole = rect.top >= inner.top + padTop - 0.5 && rect.bottom <= inner.bottom - padBottom + 0.5;
        if (scrolls && !whole) break;
        const cut =
          (clipsY && (paint.top < inner.top - 0.5 || paint.bottom > inner.bottom + 0.5)) ||
          (clipsX && (paint.left < inner.left - 0.5 || paint.right > inner.right + 0.5));
        if (cut) return name(at);
      }
      return undefined;
    };
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      if (!drawn(node)) continue;
      const far = reach(node);
      if (far === undefined) continue;
      const by = ringCut(node, far);
      if (by !== undefined) out.rings.push(`${name(node)}'s ring is cut by ${by}`);
    }
    // 9. Icons centred in their buttons.
    for (const button of document.querySelectorAll<HTMLElement>("button")) {
      if (!shown(button) || (button.textContent ?? "").trim() !== "") continue;
      const icon = button.querySelector("svg");
      if (icon === null) continue;
      const a = button.getBoundingClientRect();
      const b = icon.getBoundingClientRect();
      const across = b.left + b.width / 2 - (a.left + a.width / 2);
      const down = b.top + b.height / 2 - (a.top + a.height / 2);
      if (Math.abs(across) > 1 || Math.abs(down) > 1) out.icons.push(`${name(button)}'s icon is ${across.toFixed(1)}px across, ${down.toFixed(1)}px down off centre`);
    }

    // The focus ring, as a keyboard or controller draws it: each control is
    // focused in turn without scrolling, measured, and focus put back.
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1']), a[href]";
    for (const control of document.querySelectorAll<HTMLElement>(focusable)) {
      if (!shown(control) || control.closest("[inert]") !== null) continue;
      (control.focus as (options: object) => void)({ preventScroll: true, focusVisible: true });
      if (document.activeElement !== control) continue;
      const far = reach(control);
      const by = far === undefined ? undefined : ringCut(control, far);
      if (by !== undefined) out.rings.push(`${name(control)}'s focus ring is cut by ${by}`);
    }
    // Nothing focused is the body, and focusing the body leaves the last
    // control focused: blur it instead, so no ring is left for a screenshot.
    if (before !== undefined && before !== document.body) before.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur();

    return out;
  });

  expect.soft(found.band, `${label}: outside the visible band`).toEqual([]);
  expect.soft(found.rows, `${label}: lists below their minimum rows`).toEqual([]);
  expect.soft(found.clipped, `${label}: clipped content`).toEqual([]);
  expect.soft(found.bars, `${label}: action bars that wrap`).toEqual([]);
  expect.soft(found.crowded, `${label}: row items that overlap or overrun`).toEqual([]);
  expect.soft(found.covered, `${label}: corner controls drawn over`).toEqual([]);
  expect.soft(found.rings, `${label}: outlines and rings cut off`).toEqual([]);
  expect.soft(found.icons, `${label}: icons off their buttons' centres`).toEqual([]);
  await expectControlsFit(page, options.touch === true ? 44 : 0);
  await expectNoDocumentScroll(page);
}

/**
 * Where this screen's corner controls are: `CornerControls` once it exists,
 * and until then the screen's visible Mute control, so a Mute that moves from
 * screen to screen (UI audit m2) fails today rather than being skipped.
 *
 * Only a corner on screen counts. The screen under the Character page is
 * still laid out (`data-under-page` fades it to `opacity: 0`), so a corner
 * there must not stand in for the page's own.
 */
export async function cornerRect(page: Page): Promise<Rect | undefined> {
  return page.evaluate((): Rect | undefined => {
    const shown = (node: Element): boolean => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (node.closest("[inert], [aria-hidden='true']") !== null) return false;
      for (let at: Element | null = node; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const candidates = [
      ...document.querySelectorAll<HTMLElement>("[data-corner-controls]"),
      ...document.querySelectorAll<HTMLElement>("[data-testid='quick-mute'], [data-testid='mute'], [data-testid$='-mute']"),
    ];
    for (const node of candidates) {
      // A modal's own controls are not the screen's corners. The Character
      // page is a dialog too, but a whole shell screen, so its corners count.
      if (node.closest("[role='dialog']:not([data-testid='character-page'])") !== null) continue;
      if (!shown(node)) continue;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return undefined;
  });
}

/** Every shell screen at one size puts its corner controls in the same rect (spec §8.2.5). */
export function expectSameCorner(corners: ReadonlyMap<string, Rect>): void {
  const entries = [...corners];
  if (entries.length < 2) return;
  const [firstScreen, first] = entries[0]!;
  for (const [screen, rect] of entries.slice(1)) {
    const same =
      Math.abs(rect.x - first.x) <= 1 &&
      Math.abs(rect.y - first.y) <= 1 &&
      Math.abs(rect.width - first.width) <= 1 &&
      Math.abs(rect.height - first.height) <= 1;
    expect.soft(same, `corner controls on ${screen} (${JSON.stringify(rect)}) differ from ${firstScreen} (${JSON.stringify(first)})`).toBe(true);
  }
}
