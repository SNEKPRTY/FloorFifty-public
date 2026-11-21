import { expect, test } from "./support/test";
import { readRoom, waitForRoom, waitForServer } from "./support/server-fixture";
import { FRAME_CONTROL, GPU_LIKE } from "./support/frame-control";
import { enterStory, openHub, storyWords } from "./support/story";
import { buttonHands, playChapterOne, swipeHands } from "./support/story-play";
import {
  createRoom,
  roomOf,
  expectCanvasHasPixels,
  expectClearOfHud,
  expectScreen,
  joinRoom,
  openClient,
  openClients,
  openTitle,
  seedSettings,
  readyAll,
} from "./support/room-driver";

test.beforeAll(async () => {
  await waitForServer();
});

/** Puts one client into a running race, which is where the controls appear. */
async function enterGameplay(browser: import("@playwright/test").Browser, touchMode: "buttons" | "swipe" = "buttons") {
  // These are the button controls' checks; swipe is the touch default.
  const [host, guest] = await openClients(browser, 2, { input: { touchMode } });
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Ninja 2");
  await readyAll([host!, guest!]);
  await expectScreen(host!, "gameplay");
  return { host: host!, guest: guest!, code };
}

test("touch controls are visible and clear of the HUD", async ({ browser }, testInfo) => {
  test.slow();
  const { host, guest } = await enterGameplay(browser);

  const isMobile = testInfo.project.name !== "desktop";
  if (!isMobile) {
    // A fine pointer gets the keyboard; the controls should not exist at all.
    await expect(host.getByTestId("touch-controls")).toHaveCount(0);
    await host.context().close();
    await guest.context().close();
    return;
  }

  await expect(host.getByTestId("touch-left")).toBeVisible();
  await expect(host.getByTestId("touch-right")).toBeVisible();
  await expect(host.getByTestId("touch-fast-fall")).toBeVisible();

  // Controls must never cover time, lap, or roster information, all of which
  // the renderer draws along the top of the logical viewport.
  await expectClearOfHud(host);
  await expectCanvasHasPixels(host);

  await host.context().close();
  await guest.context().close();
});

test("every touch target meets the accessibility minimum", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "touch controls are mobile only");
  test.slow();
  const { host, guest } = await enterGameplay(browser);

  for (const testId of ["touch-left", "touch-right", "touch-fast-fall"]) {
    const box = await host.getByTestId(testId).boundingBox();
    expect(box, `${testId} has no box`).not.toBeNull();
    expect(box!.width, `${testId} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${testId} height`).toBeGreaterThanOrEqual(44);
  }

  await host.context().close();
  await guest.context().close();
});

test("the controls sit on the screen's lower edge, not the letterbox's", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "touch controls are mobile only");
  test.slow();
  const { host, guest } = await enterGameplay(browser);

  const viewport = host.viewportSize()!;
  const controls = await host.getByTestId("touch-controls").boundingBox();
  // Within a thumb's reach of the bottom of the device, whatever shape the
  // letterboxed game area takes above it.
  expect(controls!.y + controls!.height).toBeGreaterThan(viewport.height * 0.8);

  await host.context().close();
  await guest.context().close();
});

test("the controls stay inside the viewport with no page scroll", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "touch controls are mobile only");
  test.slow();
  const { host, guest } = await enterGameplay(browser);

  const viewport = host.viewportSize()!;
  for (const testId of ["touch-left", "touch-right", "touch-fast-fall"]) {
    const box = await host.getByTestId(testId).boundingBox();
    expect(box!.x, `${testId} clipped left`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${testId} clipped top`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${testId} clipped right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height, `${testId} clipped bottom`).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  }

  const scrolls = await host.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(scrolls, "the page scrolls horizontally").toBe(false);

  // Measured on the body, not the root: the root's `overflow: hidden` keeps its
  // own scroll size at the viewport's, so it read clean while the letterbox
  // overlay hung 42 px past a landscape phone's foot and a drag panned the page.
  const body = await host.evaluate(() => ({
    height: document.body.scrollHeight,
    width: document.body.scrollWidth,
  }));
  expect(body.height, "the page is taller than the screen").toBeLessThanOrEqual(viewport.height);
  expect(body.width, "the page is wider than the screen").toBeLessThanOrEqual(viewport.width);

  await host.context().close();
  await guest.context().close();
});

/** Native held touch input, observed only through authority; no driveRoom calls here. */
async function touchReachesAuthority(browser: import("@playwright/test").Browser, mode: "buttons" | "swipe") {
  const { host, guest } = await enterGameplay(browser, mode);
  const session = await host.context().newCDPSession(host);
  try {
    const code = roomOf(host)!;
    const initial = await waitForRoom(code, (reading) => reading.phase === "racing", { what: "GO before measuring touch displacement", ticks: 240 });
    expect(initial.seats.every((seat) => !seat.cpu), "no CPU/automatic steering in the room").toBe(true);
    const racer = initial.seats[0]!;
    expect(racer.input.left || racer.input.right).toBe(false);
    const viewport = host.viewportSize()!;
    const box = mode === "buttons" ? (await host.getByTestId("touch-right").boundingBox())! : { x: viewport.width * 0.35, y: viewport.height * 0.8, width: 1, height: 1 };
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const point = { x, y, id: 1 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    if (mode === "swipe") await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: x + 80 }] });
    const started = await waitForRoom(code, (now) => now.seats.find((seat) => seat.id === racer.id)!.input.right, { what: `${mode} touch reaches authority`, ticks: 60 });
    const moving = await waitForRoom(code, (now) => now.tick >= started.tick + 8, { what: `${mode} held movement advances`, ticks: 60 });
    const current = moving.seats.find((seat) => seat.id === racer.id)!;
    expect(moving.phase).toBe("racing");
    expect(current.input.right).toBe(true);
    // Short starting segment; account for the course seam, never require inertia to vanish.
    const displacement = ((current.x - racer.x + 480) % 960 + 960) % 960 - 480;
    expect(displacement, "held UI input moves the authoritative racer right").toBeGreaterThan(2);
    const neutral = (now: Awaited<ReturnType<typeof readRoom>>) => {
      const input = now.seats.find((seat) => seat.id === racer.id)!.input;
      return !input.left && !input.right && !input.fastFall;
    };
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitForRoom(code, neutral, { what: `${mode} release reaches neutral`, ticks: 60 });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    if (mode === "swipe") await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: x + 80 }] });
    await waitForRoom(code, (now) => now.seats.find((seat) => seat.id === racer.id)!.input.right, { what: `${mode} second hold reaches authority`, ticks: 60 });
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await waitForRoom(code, neutral, { what: `${mode} cancel reaches neutral`, ticks: 60 });
  } finally { await session.detach(); await host.context().close(); await guest.context().close(); }
}

test("holding a control sends movement to the server", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "touch controls are mobile only");
  test.slow();
  await touchReachesAuthority(browser, "buttons");
});

test("swipe steering reaches authority and release/cancel clears it", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "touch controls are mobile only");
  test.slow();
  await touchReachesAuthority(browser, "swipe");
});

test("the menu is usable and unclipped at this viewport", async ({ page }) => {
  await openClient(page, "/");

  const viewport = page.viewportSize()!;
  const box = await page.getByTestId("create-room").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  await expect(page.getByTestId("name-input")).toBeVisible();
});

/** A cutscene by a finger: a tap finishes the line, the next tap goes on, and Skip ends it. */
test("a tap goes on through the story's cutscene, and Skip ends it", async ({ page }) => {
  await seedSettings(page.context(), { seen: { tutorial: true } });
  await openTitle(page);
  await openHub(page);
  await page.getByTestId("story-play").tap();
  const advance = page.getByTestId("story-cutscene-advance");
  await expect(advance).toBeVisible({ timeout: 30_000 });
  const line = page.getByTestId("story-cutscene-line");
  await advance.tap();
  const first = await line.textContent();
  await page.waitForTimeout(1_500);
  expect(await line.textContent(), "the line waits for the player").toBe(first);
  await advance.tap();
  await expect.poll(() => line.textContent(), { message: "a tap goes on to the next line" }).not.toBe(first);
  await page.getByTestId("story-cutscene-skip").tap();
  await expect(storyWords(page)).toBeVisible({ timeout: 30_000 });
});

/** The story's first chapter, finished by a finger: a swipe, or the on-screen buttons. */
for (const mode of ["swipe", "buttons"] as const) {
  test(`the story's first chapter is finished by ${mode}`, async ({ page }) => {
    // A software-drawn browser plays a stepped tick in most of a second: the chapter is minutes of it.
    test.setTimeout(900_000);
    await seedSettings(page.context(), { input: { touchMode: mode }, seen: { tutorial: true } });
    await page.addInitScript(GPU_LIKE);
    await page.addInitScript(FRAME_CONTROL);
    await openTitle(page);
    await enterStory(page);
    const session = await page.context().newCDPSession(page);
    try {
      const viewport = page.viewportSize()!;
      const hands = mode === "swipe" ? swipeHands(session, { x: viewport.width * 0.35, y: viewport.height * 0.8 }) : buttonHands(session, page);
      const ticks = await playChapterOne(page, hands);
      expect(ticks, "the chapter's goal was reached inside the limit").toBeLessThan(2_400);
    } finally {
      await session.detach();
    }
  });
}
