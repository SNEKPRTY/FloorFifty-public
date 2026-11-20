import { expect, type Locator, type Page } from "@playwright/test";
import { VIEWS, type View } from "./screens-walk";

/**
 * Fit checks that a player's eye would make: whole words, nothing covered,
 * nothing off the screen, nothing too small to read (UI overhaul spec, "How it
 * gets checked"). They read the page as it is drawn (rects, hit tests,
 * computed sizes), never the markup, so a screen that looks wrong fails
 * whatever its CSS says.
 *
 * Each check is hard and fails with a message that names the element by its
 * nearest `data-testid` (or tag and class) and says what is wrong, so a failing
 * view reads as a list of faults, not as "expected [] to equal [...]".
 *
 * Every in-page function is self-contained: Playwright serialises it into the
 * page, so it cannot call anything declared outside it.
 */

/** The ten standalone views: one list of views, the screens walk's, not a second one. */
export const UI_VIEWS: readonly View[] = VIEWS.filter((view) => view.host === "standalone");

/** Fails with each fault on its own line, so the report lists them all. */
function expectNoFaults(faults: readonly string[], what: string): void {
  expect(faults, `${what}:\n  ${faults.join("\n  ")}`).toEqual([]);
}

/**
 * No element in `scope` clips its text, and no line break falls between two
 * letters of one word. Chinese, Japanese and Korean text is exempt from the
 * word rule: those scripts break between characters by design.
 */
export async function expectWholeWords(_page: Page, scope: Locator): Promise<void> {
  const faults = await scope.evaluate((root) => {
    const found: string[] = [];
    const label = (el: Element): string => {
      const id = el.closest("[data-testid]")?.getAttribute("data-testid");
      return id ?? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`;
    };
    const shown = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const cjk = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];

    for (const el of elements) {
      if (!shown(el)) continue;
      const own = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
      if (!own) continue;
      const style = getComputedStyle(el);
      // A one-pixel box is how `sr-only` hides a word from the eye on purpose; it is not clipped text.
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
      const clips = style.overflowX !== "visible" || style.textOverflow === "ellipsis";
      if (clips && el.scrollWidth > el.clientWidth + 1) {
        found.push(`${label(el)}: its text is clipped (${el.scrollWidth}px of text in ${el.clientWidth}px)`);
      }
    }

    // A word is whole when every one of its letters sits on one line.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent ?? "";
      if (parent === null || text.trim() === "" || !shown(parent)) continue;
      const range = document.createRange();
      for (const match of text.matchAll(/\S+/g)) {
        const word = match[0];
        const start = match.index ?? 0;
        if (word.length < 2 || cjk.test(word)) continue;
        let top: number | null = null;
        let height = 0;
        for (let i = 0; i < word.length; i += 1) {
          range.setStart(node, start + i);
          range.setEnd(node, start + i + 1);
          const rect = range.getClientRects()[0];
          if (rect === undefined || rect.width === 0) continue;
          if (top === null) {
            top = rect.top;
            height = rect.height;
          } else if (Math.abs(rect.top - top) > height / 2) {
            found.push(`${label(parent)}: the word "${word}" is broken across lines`);
            break;
          }
        }
      }
    }
    return found;
  });
  expectNoFaults(faults, "text is cut or broken");
}

/**
 * Every visible button, input and block of text in `scope` is hit, at nine
 * points, by itself or something inside or around it: nothing lies over it.
 * Points outside the part its scroll container shows are not tested, since the
 * player cannot see them either.
 */
export async function expectUncovered(_page: Page, scope: Locator): Promise<void> {
  const faults = await scope.evaluate((root) => {
    const found: string[] = [];
    const label = (el: Element): string => {
      const id = el.closest("[data-testid]")?.getAttribute("data-testid");
      return id ?? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`;
    };
    /** The rectangle the player can see of `el`: its box less every clipping ancestor and the window. */
    const visibleRect = (el: Element): DOMRect | null => {
      const box = el.getBoundingClientRect();
      let left = Math.max(box.left, 0);
      let top = Math.max(box.top, 0);
      let right = Math.min(box.right, window.innerWidth);
      let bottom = Math.min(box.bottom, window.innerHeight);
      for (let up = el.parentElement; up !== null; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = up.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      return right - left > 1 && bottom - top > 1 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    const candidates = Array.from(root.querySelectorAll("button, input, select, textarea, [role=button], a[href], p, h1, h2, h3, h4, label, li, [data-testid]"));
    for (const el of [root, ...candidates]) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.display === "inline" || style.pointerEvents === "none") continue;
      const interactive = el.matches("button, input, select, textarea, [role=button], a[href]");
      const ownsText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
      if (!interactive && !ownsText) continue;
      const rect = visibleRect(el);
      // A box a pixel or two across (zoomed) is text only a screen reader hears.
      if (rect === null || (rect.width < 3 && rect.height < 3)) continue;
      const covered: string[] = [];
      for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.1, 0.5, 0.9]) {
          const hit = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
          // A row that is itself the control (the ready room's seat) lays an empty button over
          // its own words so the whole row takes the press: that is the row, not a cover.
          const isRowButton = hit !== null && hit.matches("button") && (hit.textContent ?? "").trim() === "" && hit.parentElement?.contains(el) === true;
          if (hit !== null && !el.contains(hit) && !hit.contains(el) && !isRowButton) covered.push(label(hit));
        }
      }
      if (covered.length > 0) found.push(`${label(el)}: ${covered.length} of 9 points are under ${[...new Set(covered)].join(", ")}`);
    }
    return found;
  });
  expectNoFaults(faults, "something lies over a control or its words");
}

/** Every button in `scope` lies wholly inside the viewport. */
export async function expectInsideViewport(page: Page, scope: Locator, options: { scrolled?: boolean } = {}): Promise<void> {
  const size = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
  const faults = await scope.evaluate(
    (root, view) => {
      const found: string[] = [];
      for (const el of Array.from(root.querySelectorAll("button, [role=button]"))) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) continue;
        // A row of a scrolling list is reached by scrolling: with `scrolled`, a button the list
        // clips below its own foot is not a fault. The list's own box is still held to the window.
        if (view.scrolled) {
          const list = el.closest("[data-scroll-region]");
          if (list !== null && rect.top >= list.getBoundingClientRect().bottom - 0.5) continue;
        }
        if (rect.left < -0.5 || rect.top < -0.5 || rect.right > view.width + 0.5 || rect.bottom > view.height + 0.5) {
          const id = el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName.toLowerCase();
          found.push(`${id}: ${Math.round(rect.left)},${Math.round(rect.top)} to ${Math.round(rect.right)},${Math.round(rect.bottom)} is outside the ${view.width} x ${view.height} window`);
        }
      }
      return found;
    },
    { ...size, scrolled: options.scrolled === true },
  );
  expectNoFaults(faults, "a button is off the screen");
}

/**
 * No visible text under `px` CSS pixels as drawn. The shell scales a screen
 * with CSS `zoom`, which the computed font size does not include, so each
 * size is multiplied by the zoom of every ancestor.
 */
export async function expectMinText(_page: Page, scope: Locator, px: number): Promise<void> {
  const faults = await scope.evaluate((root, min) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = (node.textContent ?? "").trim();
      if (parent === null || text === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      const style = getComputedStyle(parent);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      let zoom = 1;
      for (let up: Element | null = parent; up !== null; up = up.parentElement) zoom *= Number.parseFloat(getComputedStyle(up).zoom || "1") || 1;
      const drawn = Number.parseFloat(style.fontSize) * zoom;
      if (drawn < min - 0.01) {
        const id = parent.closest("[data-testid]")?.getAttribute("data-testid") ?? parent.tagName.toLowerCase();
        found.push(`${id}: "${text.slice(0, 24)}" is ${Math.round(drawn * 10) / 10}px`);
      }
    }
    return found;
  }, px);
  expectNoFaults(faults, `text is under ${px}px`);
}

/**
 * Every word set in the pixel face is drawn at a whole multiple of 12 CSS px,
 * the font's own grid: only those draw crisp (the shell's zoom is counted, as in
 * `expectMinText`). The wordmark is Fraunces and is left alone.
 */
export async function expectTextOnPixelGrid(scope: Locator): Promise<void> {
  const faults = await scope.evaluate((root) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = (node.textContent ?? "").trim();
      if (parent === null || text === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      const style = getComputedStyle(parent);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      if (/^"?Fraunces/.test(style.fontFamily)) continue;
      let zoom = 1;
      for (let up: Element | null = parent; up !== null; up = up.parentElement) zoom *= Number.parseFloat(getComputedStyle(up).zoom || "1") || 1;
      const drawn = Number.parseFloat(style.fontSize) * zoom;
      if (Math.abs(drawn / 12 - Math.round(drawn / 12)) > 0.01) {
        const id = parent.closest("[data-testid]")?.getAttribute("data-testid") ?? parent.tagName.toLowerCase();
        found.push(`${id}: "${text.slice(0, 24)}" is ${Math.round(drawn * 100) / 100}px`);
      }
    }
    return found;
  });
  expectNoFaults(faults, "text is off the 12 px pixel grid");
}

/**
 * Every visible button has words of its own (spec: "every button has a word"),
 * except the close × and the pause ≡, which the player knows by their shape.
 * A word only a screen reader hears does not count.
 */
export async function expectWordedButtons(_page: Page, scope: Locator): Promise<void> {
  const faults = await scope.evaluate((root) => {
    const found: string[] = [];
    for (const el of Array.from(root.querySelectorAll("button, [role=button]"))) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      const id = el.getAttribute("data-testid") ?? "";
      if (id.endsWith("close") || id === "pause") continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = false;
      for (let node = walker.nextNode(); node !== null && !seen; node = walker.nextNode()) {
        const parent = node.parentElement;
        if ((node.textContent ?? "").trim() === "" || parent === null) continue;
        // `sr-only` text sits in a one-pixel clipped box (its own range is full size, the box that
        // clips it is not): a sighted player never reads it. Every box from the text up to the
        // button must be big enough to show a word.
        seen = true;
        for (let up: Element | null = parent; up !== null && seen; up = up === el ? null : up.parentElement) {
          const box = up.getBoundingClientRect();
          seen = box.width > 2 && box.height > 2 && getComputedStyle(up).visibility !== "hidden";
        }
      }
      if (!seen) found.push(`${id || el.tagName.toLowerCase()}: no visible word`);
    }
    return found;
  });
  expectNoFaults(faults, "a button has no word");
}
