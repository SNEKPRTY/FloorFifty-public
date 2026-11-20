import { expect, test } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { readInspection } from "./support/inspection";
import { visiblePixelShare } from "./support/pixels";
import {
  CLIENT_BOOT_MS,
  allowForBoot,
  createRoom,
  expectCanvasHasPixels,
  expectNoOverlap,
  expectScreen,
  joinRoom,
  openClient,
  openClients,
  readyAll,
  seedSettings,
} from "./support/room-driver";

/**
 * The Aquarian beauty pass, in a browser.
 *
 * Behaviour first, because the things this pass could break are behaviours: a
 * panel that no longer takes a pointer, a HUD that covers the course, a font
 * that arrives too late to be read, a shader that fails and leaves nothing on
 * screen. None of those is visible in a screenshot diff that was regenerated
 * after the change.
 *
 * The visual judgement -- whether it looks like the accepted identity -- is a
 * human one and lives in `docs/art/aquarian-beauty-pass-review.md`. These
 * assert only what a machine can.
 */
test.use({ reducedMotion: "no-preference" });
test.describe.configure({ mode: "serial" });

/**
 * The still pose the ambient clock freezes at, in seconds.
 *
 * A literal rather than an import: a browser spec that reached into the client
 * to learn what it was checking would agree with the implementation by
 * construction. The number is the spec's, and this is where it is pinned.
 */
const STILL_SECONDS = 6.75;

/** The largest active shaded area any backdrop pass may occupy. */
const BACKDROP_AREA_CAP = 518_400;

/**
 * The largest pooled capacity one intermediate surface may occupy.
 *
 * A different number from the cap above, and the reason both are asserted: a
 * texture is rounded up to a power of two per axis, so a surface inside the
 * area cap can still reserve more than twice that. A probe that checked only
 * the area would call an unbounded allocation bounded.
 */
const BACKDROP_POOL_CAP = 2_097_152;

test.beforeAll(async () => {
  await waitForServer();
});

/** Every page error, and every shader failure, for a spec to assert empty. */
function collectFaults(page: import("@playwright/test").Page): string[] {
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /shader|WebGL|GLSL|font/i.test(message.text())) {
      faults.push(message.text());
    }
  });
  return faults;
}

test("the menu renders readable text with the fonts loaded, and no faults", async ({ page }) => {
  const faults = collectFaults(page);
  await openClient(page, "/");

  // The faces are vendored, so `document.fonts` knows them by name. `check`
  // waits for the load rather than asserting a request went out: a font that
  // 404s leaves `status` at "error" and would otherwise read as rendered.
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      display: document.fonts.check('600 48px "Fraunces"'),
      ui: document.fonts.check('600 16px "FF Pixel"'),
    };
  });
  expect(loaded.display, "the wordmark face did not load").toBe(true);
  expect(loaded.ui, "the control face did not load").toBe(true);

  // Whatever the face is, the text is on screen and is not empty. A blocked
  // font falls back and still renders, which is the requirement -- blank text
  // would be the failure.
  const wordmark = page.getByRole("heading", { level: 1 });
  await expect(wordmark).toBeVisible();
  expect((await wordmark.textContent())?.trim().length ?? 0).toBeGreaterThan(0);

  await expectCanvasHasPixels(page);
  expect(faults).toEqual([]);
});

test("the interactive targets clear the 44px floor", async ({ page }) => {
  await openClient(page, "/");

  // The code row's button is Create room until a code is typed, then Join room.
  for (const [id, code] of [["find-race", ""], ["create-room", ""], ["join-room", "ABC123"]] as const) {
    await page.getByTestId("code-input").fill(code);
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} has no box`).not.toBeNull();
    expect(box!.width, `${id} is too narrow`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${id} is too short`).toBeGreaterThanOrEqual(44);
    const viewport = page.viewportSize()!;
    if (viewport.width > viewport.height && viewport.height < 480) {
      expect(box!.y, `${id} starts below the short landscape viewport`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${id} ends below the short landscape viewport`).toBeLessThanOrEqual(viewport.height);
    }
  }
});

test("the HUD does not take the pointer, and the race still has one HUD", async ({ page }) => {
  const faults = collectFaults(page);
  await openClient(page, "/");
  await createRoom(page, "Kite");
  await readyAll([page]);

  await expectScreen(page, "gameplay", 30_000);

  // Exactly one, and it cannot intercept: this sits over the same canvas the
  // touch controls use, and a chip that swallowed a pointer would take a
  // movement with it.
  await expect(page.getByTestId("race-hud")).toHaveCount(1);
  const intercepts = await page.getByTestId("race-hud").evaluate((node) =>
    getComputedStyle(node).pointerEvents,
  );
  expect(intercepts).toBe("none");

  const viewport = page.viewportSize()!;
  const metrics = await page.getByTestId("hud-floors").boundingBox();
  if (viewport.height > viewport.width) {
    expect(metrics?.y, "portrait HUD did not move into the upper scenery").toBeLessThan(viewport.height / 4);
  }

  // What the screen resolved and what the scenery is actually drawing through.
  // The target's size is the whole reason the refraction is affordable, so it
  // is read from the client rather than inferred from a frame time.
  const inspection = await readInspection(page);
  expect(inspection.profile, "the stage did not resolve to the Aquarian composition").toBe("aquarian");
  expect(inspection.refraction, "the sky's refraction or the city's glass is not in its chain").toBe("sky+city");
  expect(inspection.target, "the scenery is drawing unbounded").not.toBeNull();
  expect(
    inspection.target!.width * inspection.target!.height,
    "the bounded target exceeded the area cap",
  ).toBeLessThanOrEqual(BACKDROP_AREA_CAP);
  expect(
    inspection.target!.pooled,
    "the target's pooled allocation exceeded its own cap",
  ).toBeLessThanOrEqual(BACKDROP_POOL_CAP);

  // At 844 x 390 the compact roster and the touch controls share a small screen,
  // and a roster that reached into a thumb corner would take a movement with it.
  // Asserted only where the controls exist, since a fine pointer gets none.
  // A phone held upright collapses the roster to one standings line; a
  // tablet held upright keeps the named roster as a band (responsive parity
  // spec §5.4), so the choice is the form factor's, not the aspect's.
  if ((await page.getByTestId("touch-controls").count()) > 0) {
    const factor = await page.locator("html").getAttribute("data-form-factor");
    const height = page.viewportSize()?.height ?? 0;
    const roster = factor === "phone-portrait" ? "hud-standings-line" : height < 340 ? "hud-standings-pill" : "hud-roster";
    await expectNoOverlap(page, `[data-testid="${roster}"]`, '[data-testid="touch-controls"]');
  }

  const canvas = await page.locator("#app > canvas").boundingBox();
  expect(canvas).not.toBeNull();
  const sky = await page.screenshot({
    clip: {
      x: canvas!.x + canvas!.width * 0.25,
      y: canvas!.y + canvas!.height * 0.18,
      width: canvas!.width * 0.5,
      height: canvas!.height * 0.16,
    },
  });
  expect(visiblePixelShare(sky), "the filtered gameplay sky remained black").toBeGreaterThan(0.5);

  await expectCanvasHasPixels(page);
  expect(faults).toEqual([]);
});

test("a second client joining keeps every seat identifiable", async ({ browser }) => {
  const pages = await openClients(browser, 2);
  const host = pages[0]!;
  const guest = pages[1]!;
  await createRoom(host, "Kite");
  const code = (await host.getByTestId("room-code").textContent()) ?? "";
  await joinRoom(guest, code, "Ninja Two");

  await expect(host.getByTestId("seat")).toHaveCount(4);
  // Seat identity is three independent channels, so a player is identifiable
  // without reading a colour: the number, the name and the marker.
  await expect(host.getByTestId("seat-name").first()).not.toBeEmpty();
  await expect(host.getByTestId("seat-number").first()).not.toBeEmpty();
  await expect(host.getByTestId("seat-you")).toHaveCount(1);
  await expect(host.getByTestId("seat-host")).toHaveCount(1);

  await host.close();
  await guest.close();
});

test("reduced motion freezes the scenery rather than removing it", async ({ page }) => {
  // The comfort boundary: the picture must arrive, not disappear. Asserted as
  // "still drawing" rather than as "not moving", because a frame comparison
  // here would be measuring the racers, which must keep moving.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const faults = collectFaults(page);
  await openClient(page, "/");
  await createRoom(page, "Kite");
  await readyAll([page]);
  await expectScreen(page, "gameplay", 30_000);

  // The presentation clock, read through the test-only hook. It is the one
  // thing here that can be asserted as frozen without also asserting that the
  // racers stopped, which is why it is read rather than photographed.
  const frozen = await readInspection(page);
  expect(frozen.clockSeconds, "the ambient clock did not take the still pose").toBe(
    STILL_SECONDS,
  );

  await page.waitForTimeout(500);
  expect(
    (await readInspection(page)).clockSeconds,
    "the ambient clock advanced under reduced motion",
  ).toBe(STILL_SECONDS);

  await expectCanvasHasPixels(page);
  expect(faults).toEqual([]);
});

test("when the self-hosted fonts never arrive the game says so and Try again recovers", async ({ page }) => {
  // Since the loading rule (M2.1g, #60) a font that fails to load is a load
  // failure like a missing picture: the client shows "Could not load the game"
  // with Try again and never falls back to another face. A half-styled screen
  // is what the rule rules out, so this checks for the failure and for the
  // absence of any screen that rendered without its faces.
  //
  // A returning player, so the failure is the splash's own and not the
  // language step's or the warning's (which wait for their fonts the same way).
  //
  // Two boots of allowance: the first load, and the one Try again starts.
  allowForBoot();
  allowForBoot();
  await seedSettings(page.context(), { seen: { photosensitivity: true }, locale: "en" });
  await page.route("**/fonts/**", (route) => route.abort());

  await page.goto("/");

  const failure = page.getByTestId("error-view");
  await expect(failure, "a blocked font ends in the failure screen").toBeVisible({ timeout: CLIENT_BOOT_MS });
  await expect(failure).toContainText("Could not load the game");
  await expect(failure.getByTestId("error-retry")).toBeVisible();

  // No fallback face: nothing that needs the fonts was shown without them.
  await expect(page.getByTestId("splash")).toBeHidden();
  await expect(page.getByTestId("language-first")).toHaveCount(0);
  await expect(page.getByTestId("photosensitivity-warning")).toHaveCount(0);

  // The fonts come back, and Try again gets the player to the splash.
  await page.unroute("**/fonts/**");
  await failure.getByTestId("error-retry").click();
  await expect(page.getByTestId("splash").getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", {
    timeout: CLIENT_BOOT_MS,
  });
  await expect(failure).toHaveCount(0);
});

test("200% page zoom leaves the menu usable and unclipped", async ({ page }) => {
  // Emulated the way a browser actually zooms: the same physical window, half
  // the CSS viewport. Chrome's Ctrl+Plus scales layout through the device scale
  // factor, so a page laid out for 1280 x 720 sees 640 x 360 -- and that is
  // where a fixed two-column panel starts to overflow.
  await page.setViewportSize({ width: 640, height: 360 });
  const faults = collectFaults(page);
  await openClient(page, "/");

  for (const id of ["name-input", "find-race", "create-room"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} has no box at 200% zoom`).not.toBeNull();
    expect(box!.x, `${id} starts left of the zoomed viewport`).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `${id} runs past the right edge of the zoomed viewport`,
    ).toBeLessThanOrEqual(640);
  }

  // The panel collapsed to the single column the spec asks for, so the page
  // fits the zoomed viewport instead of scrolling sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    "the page scrolls sideways at 200% zoom",
  ).toBeLessThanOrEqual(641);

  await expectCanvasHasPixels(page);
  expect(faults).toEqual([]);
});
