import { expect, test, type Page } from "./support/test";
import { PNG } from "pngjs";
import { openClient, openTitle, seedSettings } from "./support/room-driver";

/**
 * The connect screen against the Aquarian board, in a browser.
 *
 * Only the layout a machine can measure: where things sit, what they overlap
 * and what material they are drawn in. Whether the result looks like the board
 * is a human judgement and stays with the review doc. Plan:
 * the project's internal notes.
 */

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, `${selector} has no box`).not.toBeNull();
  return found!;
}

/**
 * Whether the page is laid out as desktop. Read from the form factor the page
 * classified itself as, not the width: a 1024-wide tablet held upright is
 * tablet portrait, and a 1280 x 480 window is phone landscape.
 */
const isDesktop = async (page: Page): Promise<boolean> =>
  (await page.locator("html").getAttribute("data-form-factor")) === "desktop";

/**
 * A tablet or a phone held upright centres its hero (D-R4), where the others
 * align it left. The phone's hero stands in the frame's column, so the ledge
 * it once ran off the left edge from no longer reaches it: centred, the
 * wordmark and the building stand together.
 */
const centresHero = async (page: Page): Promise<boolean> =>
  ["tablet-portrait", "phone-portrait"].includes((await page.locator("html").getAttribute("data-form-factor")) ?? "");

const isPhonePortrait = async (page: Page): Promise<boolean> =>
  (await page.locator("html").getAttribute("data-form-factor")) === "phone-portrait";

test.beforeEach(async ({ page }) => {
  await openClient(page, "/");
  await page.evaluate(() => document.fonts.ready);
});

test("the racers clear the ink of the wordmark's descender", async ({ page }) => {
  // Measured against the glyphs, not the line box: the wordmark's line-height
  // is under 1, so the "y" of "Fifty" hangs below its own box.
  const { inkBottom, racersTop } = await page.evaluate(() => {
    const line = document.querySelectorAll<HTMLElement>('[data-testid="menu-wordmark"] > span')[1]!;
    const style = getComputedStyle(line);
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    line.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const descent = context.measureText(line.textContent ?? "").actualBoundingBoxDescent;
    const racers = document.querySelector(".ff-ensemble")!.getBoundingClientRect();
    return { inkBottom: baseline + descent, racersTop: racers.top };
  });
  expect(racersTop, "the racers run into the descender").toBeGreaterThanOrEqual(inkBottom + 4);
});

test("the wordmark is set large and inset from the gutter", async ({ page }) => {
  test.skip(!(await isDesktop(page)), "the board's proportions are a desktop composition");
  const viewport = page.viewportSize()!;
  const wordmark = await box(page, '[data-testid="menu-wordmark"]');
  expect(wordmark.width, "wordmark narrower than a quarter of the screen").toBeGreaterThanOrEqual(viewport.width * 0.25);
  expect(wordmark.x, "wordmark pinned to the gutter").toBeGreaterThanOrEqual(viewport.width * 0.06);
});

test("the panel is solid and sits centred against the hero column", async ({ page }) => {
  const panel = page.getByTestId("create-room").locator("xpath=ancestor::*[contains(@class,'ff-aquarian-panel')][1]");
  const material = await panel.evaluate((node) => {
    const style = getComputedStyle(node);
    // An alpha is written after a slash (`color(srgb r g b / a)`) or as
    // `rgba(r, g, b, a)`'s fourth part; a solid colour is `rgb(r, g, b)`.
    const alpha = /\/\s*([\d.]+)\s*\)$|^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(style.backgroundColor)?.slice(1).find((part) => part !== undefined);
    return { blur: style.backdropFilter, alpha: alpha === undefined ? 1 : Number(alpha) };
  });
  // Solid, not glass (UI overhaul spec, "Panels": "The world shows around
  // panels, never through them").
  expect(material.blur, "the panel blurs the world behind it").toBe("none");
  expect(material.alpha, "the world shows through the panel").toBe(1);

  if (await isDesktop(page)) {
    // Checked at a taller-than-16:9 window too, where a top-pinned panel
    // left the right column visibly top-heavy.
    for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      // The hero is `MenuHero` since phase 1d; on desktop its tagline is fixed
      // in the bar, so the hero's box is the old intro column's.
      const intro = await box(page, ".ff-hero");
      const panelBox = (await panel.boundingBox())!;
      const introMiddle = intro.y + intro.height / 2;
      const panelMiddle = panelBox.y + panelBox.height / 2;
      expect(Math.abs(panelMiddle - introMiddle), `panel is off-centre at ${size.width}x${size.height}`).toBeLessThanOrEqual(16);
    }
  }
});

test("the buttons read label-left, arrow-right, and the primary is the flat green face", async ({ page }) => {
  // The code row's button is Create room until a code is typed, then Join room.
  for (const [id, code] of [["find-race", ""], ["create-room", ""], ["join-room", "ABC123"]] as const) {
    await page.getByTestId("code-input").fill(code);
    const button = await box(page, `[data-testid="${id}"]`);
    const arrow = await box(page, `[data-testid="${id}"] span[aria-hidden="true"]`);
    const labelLeft = await page.getByTestId(id).evaluate((node) => {
      const range = document.createRange();
      const text = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim() !== "")!;
      range.selectNodeContents(text);
      return range.getBoundingClientRect().left;
    });
    expect(button.x + button.width - (arrow.x + arrow.width), `${id} arrow is not at the far right`).toBeLessThanOrEqual(28);
    expect(labelLeft - button.x, `${id} label is not at the left`).toBeLessThanOrEqual(28);
  }
  await page.getByTestId("code-input").fill("");
  // Flat button faces (UI overhaul spec, "Buttons"): the step forward is
  // Deep Pine, #165a4c, with no gradient over it.
  const primary = await page.getByTestId("find-race").evaluate((node) => {
    const style = getComputedStyle(node);
    return { image: style.backgroundImage, colour: style.backgroundColor };
  });
  expect(primary).toEqual({ image: "none", colour: "rgb(22, 90, 76)" });
});

test("the room code is tracked tightly enough to read as one code", async ({ page }) => {
  const { spacing, size } = await page.getByTestId("code-input").evaluate((node) => {
    const style = getComputedStyle(node);
    return { spacing: parseFloat(style.letterSpacing) || 0, size: parseFloat(style.fontSize) };
  });
  expect(spacing / size).toBeLessThanOrEqual(0.12);
});

test("the landscape connect sheet fits its contents at rest", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await seedSettings(page.context(), { seen: { tutorial: false } });
  await openTitle(page);
  await page.getByTestId("title-play").click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
  const sheet = page.getByTestId("menu-sheet");
  await expect.poll(() => sheet.evaluate((node) => node.scrollHeight - node.clientHeight), {
    message: "the connect form must fit without scrolling at rest",
  }).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath("connect-sheet.png") });
});

test("the keys sit in one row at the panel's foot", async ({ page }) => {
  test.skip(!(await isDesktop(page)), "a coarse pointer shows the touch help instead");
  const panel = await box(page, ".ff-connect__card");
  const legend = await box(page, ".ff-help");
  expect(legend.x, "legend is outside the panel").toBeGreaterThanOrEqual(panel.x);
  expect(legend.x + legend.width, "legend is outside the panel").toBeLessThanOrEqual(panel.x + panel.width);
  expect(legend.y + legend.height, "legend is not at the panel's foot").toBeLessThanOrEqual(panel.y + panel.height);
  expect(panel.y + panel.height - (legend.y + legend.height), "legend is not at the panel's foot").toBeLessThanOrEqual(32);
  const rows = await page.locator(".ff-help dl > div").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(rows).toHaveLength(2);
  expect(new Set(rows).size, "legend keys are not one row").toBe(1);
});

test("the racers stand centred on a plinth, planters past the last racer", async ({ page }) => {
  test.skip(!(await isDesktop(page)), "the plinth is part of the desktop composition");
  const ledge = await box(page, '[data-testid="menu-ledge"]');
  const racers = await page.getByTestId("menu-racer").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.closest(".ff-menu-racer-frame")!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
  );
  const first = Math.min(...racers.map((racer) => racer.left));
  const last = Math.max(...racers.map((racer) => racer.right));
  // The planters are the art's right-hand slice, about a hundred pixels wide;
  // the last racer stands short of it, and the plinth reaches as far past the
  // first racer, so the racers stand centred on it.
  expect(last, "a planter sits between the racers").toBeLessThanOrEqual(ledge.x + ledge.width - 64);
  expect(Math.abs(first - ledge.x - (ledge.x + ledge.width - last)), "the racers are off the plinth's centre").toBeLessThanOrEqual(24);
});

test("pressing Enter in the code field submits the join", async ({ page }) => {
  await page.getByTestId("name-input").fill("Kite");
  await page.getByTestId("code-input").fill("AB");
  await page.getByTestId("code-input").press("Enter");
  await expect(page.getByTestId("menu-status")).toContainText("room code");
});

test("the menu fills the window: the stage publishes no bar under it", async ({ page }) => {
  test.skip(!(await isDesktop(page)), "portrait never draws bars");
  // Bars are for a race (UI overhaul, Task 9). Read from the stage, not from
  // pixels: the splash's black fades on the stage's own clock, which these
  // specs hold, so a pixel at the top may still be mid-fade.
  const published = await page.evaluate(() => {
    const overlay = document.querySelector("[data-bottom-bar]") as HTMLElement;
    return { barHeight: overlay.style.getPropertyValue("--ff-bar-height"), bottomBar: overlay.dataset["bottomBar"], mode: document.documentElement.dataset["bandMode"] };
  });
  expect(published).toEqual({ barHeight: "0px", bottomBar: "none", mode: "menu" });
});

test("a portrait menu's lower canvas is city, not the flat field colour", async ({ page }) => {
  test.skip(await isDesktop(page), "only a tall canvas shows past the field");
  const viewport = page.viewportSize()!;
  if (viewport.height <= viewport.width) test.skip();
  // A strip at the very foot of the canvas, where only scenery can be.
  const shot = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: viewport.height - 8, width: 8, height: 8 } }));
  const [r, g, b] = [shot.data[0]!, shot.data[1]!, shot.data[2]!];
  // The field is the warm, pale sky-low peach. Since phase 1d the portrait
  // plates cover the canvas (responsive parity spec §5.1), so the foot is the
  // near city's own dark base -- plum or slate, not always bluer than red --
  // and the test asks for dark rather than for blue.
  expect(Math.max(r, g, b), `foot of the canvas is rgb(${r},${g},${b})`).toBeLessThan(160);
});

test("on a coarse pointer the touch help sits on its own backing", async ({ page }) => {
  // In portrait it lands on the dark city base, where bare ink disappears.
  const help = page.locator(".ff-help-touch");
  test.skip(!(await help.isVisible()), "a fine pointer gets the key legend instead");
  const background = await help.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background, "the touch help has no backing").not.toBe("rgba(0, 0, 0, 0)");
});

test("a status message sits on its own backing, so it reads over the city", async ({ page }) => {
  // The line lands at the foot of the screen, on the city's darkest base.
  await page.getByTestId("name-input").fill("Kite");
  await page.getByTestId("code-input").fill("AB");
  await page.getByTestId("code-input").press("Enter");
  const status = page.getByTestId("menu-status");
  await expect(status).toContainText("room code");
  const background = await status.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background, "the status line has no backing").not.toBe("rgba(0, 0, 0, 0)");
});

test("the wordmark sits in a soft blue glow, as the board draws it", async ({ page }) => {
  const filter = await page.getByTestId("menu-wordmark").evaluate((node) => getComputedStyle(node).filter);
  // Each drop-shadow computes to `drop-shadow(<colour> <x> <y> <blur>)`, the
  // colour as `rgb(a)(...)` or, from a colour-mix, `color(srgb r g b / a)`.
  const shadows = [...filter.matchAll(/drop-shadow\((rgba?\([^)]*\)|color\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px\)/g)].map((match) => {
    const numbers = match[1]!.match(/[\d.]+/g)!.map(Number);
    const [r, g, b] = match[1]!.startsWith("color(") ? numbers.slice(0, 3).map((n) => n * 255) : numbers.slice(0, 3);
    return { r: r!, g: g!, b: b!, x: Number(match[2]), y: Number(match[3]), blur: Number(match[4]) };
  });
  const glow = shadows.find((shadow) => shadow.x === 0 && shadow.y === 0 && shadow.blur >= 16 && shadow.b > shadow.r + 40);
  expect(glow, `no blue glow in ${filter}`).toBeDefined();
});

test("the tagline carries no glow of its own", async ({ page }) => {
  const shadow = await page.getByTestId("menu-tagline").evaluate((node) => getComputedStyle(node).textShadow);
  expect(shadow).toBe("none");
});

test("the wordmark stands centred over the racers, its lines centred on each other", async ({ page }) => {
  // Measured on the ink of each line, not the boxes: the lines are centred in
  // a box that may be wider than either.
  const centres = await page.evaluate(() => {
    const ink = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    const lines = [...document.querySelectorAll('[data-testid="menu-wordmark"] > span')].map(ink);
    const racers = document.querySelector(".ff-ensemble")!.getBoundingClientRect();
    return { lines, racers: racers.left + racers.width / 2 };
  });
  expect(Math.abs(centres.lines[0]! - centres.lines[1]!), JSON.stringify(centres)).toBeLessThanOrEqual(2);
  expect(Math.abs(centres.lines[0]! - centres.racers), JSON.stringify(centres)).toBeLessThanOrEqual(3);
});

test.describe("with motion", () => {
  // The suite runs with reduced motion, which keeps the racers still on purpose.
  test.use({ reducedMotion: "no-preference" });

  test("a tap hops a racer on a touch screen", async ({ page, hasTouch }) => {
    test.skip(!hasTouch, "a mouse hovers; the hover hop has its own unit test");
    // A touch never hovers, so the tap is what starts the hop (spec §5.8).
    const frame = page.locator(".ff-menu-racer-frame").nth(1);
    await frame.tap();
    await expect(frame).toHaveClass(/ff-menu-racer-frame--hop/);
  });
});

test("a centred hero stands the wordmark over the racers and their building", async ({ page }) => {
  test.skip(!(await centresHero(page)), "only a screen held upright centres the hero");
  // The ink, not the boxes: a centred column of flush-left text has a centred
  // box, and the building is the facade under the ledge.
  const centres = await page.evaluate(() => {
    const middle = (rect: DOMRect) => rect.left + rect.width / 2;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-testid="menu-wordmark"] > span')!);
    return {
      wordmark: middle(range.getBoundingClientRect()),
      racers: middle(document.querySelector(".ff-ensemble")!.getBoundingClientRect()),
      building: middle(document.querySelector('[data-testid="menu-facade"]')!.getBoundingClientRect()),
      screen: innerWidth / 2,
    };
  });
  expect(Math.abs(centres.wordmark - centres.screen), JSON.stringify(centres)).toBeLessThanOrEqual(12);
  expect(Math.abs(centres.racers - centres.screen), JSON.stringify(centres)).toBeLessThanOrEqual(12);
  expect(Math.abs(centres.building - centres.screen), JSON.stringify(centres)).toBeLessThanOrEqual(12);
});

test("a centred wordmark centres its two lines on each other", async ({ page }) => {
  test.skip(!(await centresHero(page)), "only a screen held upright centres the hero");
  // Measured on each line's text, not its box: a block line spans the whole
  // wordmark, so only the text's own range shows where it sits (spec §5.8).
  const centres = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="menu-wordmark"] > span')].map((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const rect = range.getBoundingClientRect();
      return rect.left + rect.width / 2;
    }),
  );
  expect(Math.abs(centres[0]! - centres[1]!), JSON.stringify(centres)).toBeLessThanOrEqual(2);
});

/**
 * The bottom letterbox bar's top edge, as the stage publishes it
 * (`data-bottom-bar` and `--ff-bar-top`). `undefined` when no bar holds the
 * tagline: a menu fills the window and has none (UI overhaul, Task 9), and
 * portrait draws none. Read from the page rather than from pixels, since the
 * dark city at a menu's foot looks like a bar to a pixel probe.
 */
async function roomyBarTop(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const overlay = document.querySelector("[data-bottom-bar]") as HTMLElement | null;
    if (overlay?.dataset["bottomBar"] !== "roomy") return undefined;
    return Number.parseFloat(overlay.style.getPropertyValue("--ff-bar-top"));
  });
}

test("the tagline is white and centred in the bottom letterbox bar", async ({ page }) => {
  const viewport = page.viewportSize()!;
  const barTop = await roomyBarTop(page);
  test.skip(barTop === undefined, "no bar tall enough to hold it here");

  const tagline = await box(page, '[data-testid="menu-tagline"]');
  const colour = await page.getByTestId("menu-tagline").evaluate((node) => getComputedStyle(node).color);
  expect(colour).toBe("rgb(255, 255, 255)");
  expect(tagline.y, "tagline starts above the bar").toBeGreaterThanOrEqual(barTop! - 1);
  expect(tagline.y + tagline.height, "tagline runs off the screen").toBeLessThanOrEqual(viewport.height);
  const barMiddle = (barTop! + viewport.height) / 2;
  expect(Math.abs(tagline.y + tagline.height / 2 - barMiddle), "tagline off the bar's middle").toBeLessThanOrEqual(2);
  expect(Math.abs(tagline.x + tagline.width / 2 - viewport.width / 2), "tagline off the screen's centre").toBeLessThanOrEqual(2);
  const align = await page.getByTestId("menu-tagline").evaluate((node) => getComputedStyle(node).textAlign);
  expect(align).toBe("center");
  const lines = await page.getByTestId("menu-tagline").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(lines, "the tagline wraps").toBe(1);
});

test("a phone held upright drops the tagline, which the connect sheet would cover", async ({ page }) => {
  test.skip(!(await isPhonePortrait(page)), "only a phone held upright drops it");
  await expect(page.getByTestId("menu-tagline")).toBeHidden();
});

test("without a bar to hold it, the tagline sits under the wordmark in ink", async ({ page }) => {
  // Phase 1d moved it into the hero (responsive parity spec §5.2): on the open
  // sky, under the wordmark and above the form, as the approved portrait and
  // phone-landscape boards set it. It used to close the menu, white, over the
  // city base, which the taller backdrop no longer puts under it.
  test.skip((await roomyBarTop(page)) !== undefined, "the bar holds it here");
  test.skip(await isPhonePortrait(page), "a phone held upright drops it");
  const tagline = await box(page, '[data-testid="menu-tagline"]');
  const wordmark = await box(page, '[data-testid="menu-wordmark"]');
  const panel = await box(page, ".ff-connect__card");
  const style = await page.getByTestId("menu-tagline").evaluate((node) => {
    const computed = getComputedStyle(node);
    return { color: computed.color, align: computed.textAlign };
  });
  // The page's ink, whatever the palette makes it.
  const ink = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--ff-text)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(style).toEqual({ color: ink, align: "center" });
  expect(tagline.y, "tagline is not under the wordmark").toBeGreaterThanOrEqual(wordmark.y + wordmark.height - 1);
  // Above the form in portrait and beside it held sideways: either way, clear of it.
  const overlaps =
    tagline.x < panel.x + panel.width &&
    panel.x < tagline.x + tagline.width &&
    tagline.y < panel.y + panel.height &&
    panel.y < tagline.y + tagline.height;
  expect(overlaps, "tagline runs into the form").toBe(false);
  // The wordmark centres over the racers, and the tagline under it.
  const middle = (b: { x: number; width: number }) => b.x + b.width / 2;
  expect(Math.abs(middle(tagline) - middle(wordmark)), "tagline is off the wordmark's centre").toBeLessThanOrEqual(8);
});

test("a status message sits in the top bar, clear of the tagline", async ({ page }) => {
  test.skip((await roomyBarTop(page)) === undefined, "no bar holds the tagline here");
  await page.getByTestId("name-input").fill("Kite");
  await page.getByTestId("code-input").fill("AB");
  await page.getByTestId("code-input").press("Enter");
  const status = await box(page, '[data-testid="menu-status"]');
  const tagline = await box(page, '[data-testid="menu-tagline"]');
  expect(status.y + status.height, "status runs into the bar").toBeLessThanOrEqual(tagline.y);
});
