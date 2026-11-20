/**
 * Art acceptance evidence.
 *
 * Captures the renderer at each target viewport so a human can review the art
 * against `docs/art/reimagined-visual-direction-brief.md`. These screenshots
 * are necessary evidence and not a substitute for that review: an automated
 * check can prove a sprite is the right size and has an alpha channel, and can
 * prove nothing at all about whether it looks right.
 *
 * Four players, not two. The brief's ninth acceptance gate asks for each
 * viewport captured with four connected players, and four is where the
 * questions the review exists to answer actually arise: whether a racer can be
 * found during overlap, whether the standings panel still fits, and whether the
 * seat colours stay distinguishable against the city rather than only against
 * the sky.
 */

import { expect, test } from "./support/test";
import { holdRoomClocks, driveRoom, readRoom, waitForRoom, waitForServer } from "./support/server-fixture";
import { evidenceDir } from "./support/evidence";
import { FakePad } from "./support/fake-gamepad";
import {
  createRoom,
  chooseMode,
  expectCanvasHasPixels,
  expectScreen,
  joinRoom,
  openClient,
  openClients,
  readyAll,
  readyOnly,
  passSelect,
  pickStage,
  RESULTS_TIMEOUT_MS,
} from "./support/room-driver";

const SHOTS = evidenceDir();

test.beforeAll(async () => {
  await waitForServer();
});

test("ready-panel contains its actions with bottom padding", async ({ browser }, testInfo) => {
  test.slow();
  const [page] = await openClients(browser, 1);
  try {
    await createRoom(page!, "Racer 90");
    // The rules are behind the Rules button, in a sheet.
    await page!.getByTestId("ready-rules").click();
    await expect(page!.getByTestId("mode-tagline")).toContainText("Stay above");
    await page!.getByTestId("info-sheet-close").click();
    await expect(page!.getByTestId("mode-tagline")).toHaveCount(0);
    const sizes = testInfo.project.name === "desktop"
      ? [{ width: 1280, height: 720 }, { width: 1970, height: 1248 }, { width: 1440, height: 900 }, { width: 985, height: 624 },
        { width: 360, height: 640 }, { width: 410, height: 590 }, { width: 667, height: 375 }]
      : [page!.viewportSize()!];
    for (const size of sizes) {
      await page!.setViewportSize(size);
      for (const mode of ["infinite", "floors-20"] as const) {
        await chooseMode(page!, mode);
        await expect(page!.getByTestId("ready-actions")).toBeVisible();
        const geometry = () => page!.locator(".ff-ready__chip").evaluate((panel) => {
          const actions = panel.querySelector('[data-testid="ready-actions"]')!;
          const bounds = panel.getBoundingClientRect();
          const actionBounds = actions.getBoundingClientRect();
          const scale = bounds.width / (panel as HTMLElement).offsetWidth;
          return {
            panel: { top: bounds.top, bottom: bounds.bottom, height: bounds.height },
            actions: { top: actionBounds.top, bottom: actionBounds.bottom },
            viewportBottom: innerHeight,
            bottomInset: bounds.bottom - actionBounds.bottom,
            padding: parseFloat(getComputedStyle(panel).paddingBottom) * scale,
          };
        });
        await page!.screenshot({ path: `${SHOTS}/${testInfo.project.name}-ready-panel-${size.width}x${size.height}-${mode}.png` });
        await expect.poll(async () => {
          const box = await geometry();
          return box.bottomInset - box.padding;
        }, { message: `actions keep panel padding at ${size.width}x${size.height}: ${JSON.stringify(await geometry())}` }).toBeGreaterThanOrEqual(-1);
        const box = await geometry();
        expect(box.panel.bottom, "whole panel remains in the viewport").toBeLessThanOrEqual(box.viewportBottom);
      }
    }
  } finally {
    await page!.context().close();
  }
});

test("a guest tabs through the race choice in focus order, and the rules open and close from the keyboard", async ({ browser }) => {
  const [host] = await openClients(browser, 1);
  const guest = await (await browser.newContext({ viewport: { width: 360, height: 640 }, reducedMotion: "reduce" })).newPage();
  const pad = await FakePad.install(guest);
  try {
    await openClient(guest);
    const code = await createRoom(host!, "Host");
    await joinRoom(guest!, code, "Guest");
    // The host's choice is theirs alone: a guest's buttons are disabled and skipped.
    await expect(guest!.getByTestId("clock-180")).toBeDisabled();
    await expect(guest!.getByTestId("race-settings-scroll")).toHaveCount(0);
    await guest!.getByTestId("seat-change").focus();
    await guest!.keyboard.press("Tab");
    await expect(guest!.getByTestId("ready-rules")).toBeFocused();
    await guest.screenshot({ path: test.info().outputPath("guest-rules-focus.png") });
    await guest!.keyboard.press("Enter");
    await expect(guest!.getByTestId("mode-tagline")).toBeVisible();
    await guest!.keyboard.press("Escape");
    await expect(guest!.getByTestId("mode-tagline")).toHaveCount(0);
    await expect(guest!.getByTestId("ready-rules")).toBeFocused();
    await guest!.keyboard.press("Tab");
    await expect(guest!.getByTestId("ready-toggle")).toBeFocused();
    await pad.connect();
    await guest.getByTestId("seat-change").focus();
    // Down the room, seat by seat, the controller reaches Rules and then Ready.
    for (let step = 0; step < 8; step += 1) {
      if (await guest.getByTestId("ready-rules").evaluate((node) => node === document.activeElement)) break;
      await pad.step("down", "dpad");
    }
    await expect(guest.getByTestId("ready-rules")).toBeFocused();
    for (const id of ["ready-toggle", "leave-room"]) {
      const box = await guest!.getByTestId(id).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    }
  } finally {
    await Promise.all([host!, guest!].map((page) => page.context().close()));
  }
});

test("captures the menu and a running race for art review", { tag: "@gpu" }, async ({ browser }, testInfo) => {
  test.slow();
  const viewport = testInfo.project.name;

  const clients = await openClients(browser, 4);
  const [host, ...guests] = clients as [import("@playwright/test").Page, ...import("@playwright/test").Page[]];
  try {
    await host.screenshot({ path: `${SHOTS}/${viewport}-main-menu.png` });

    await host.getByTestId("name-input").fill("Kite");
    await host.getByTestId("code-input").fill("BAD");
    await host.getByTestId("join-room").click();
    await expect(host.getByTestId("menu-status")).toHaveText("A room code is 6 characters.");
    await host.screenshot({ path: `${SHOTS}/${viewport}-menu-error.png` });
    await host.getByTestId("code-input").fill("");

    const code = await createRoom(host, "Kite");
    await chooseMode(host, "floors-20");
    // Named rather than numbered, because the roster truncates long names and a
    // capture of four rows reading "Ninja 2" proves less than one that does not.
    const names = ["Sable", "Wren", "Koi"];
    for (const [index, guest] of guests.entries()) {
      await joinRoom(guest, code, names[index]!);
    }
    await host.screenshot({ path: `${SHOTS}/${viewport}-ready-room.png` });

    await readyAll(clients);
    await expectScreen(host, "gameplay");
    // Let the climb get off the ground so the shot shows the course, not the
    // first frame of it.
    await host.waitForTimeout(4000);
    await expectCanvasHasPixels(host);
    await expectScreen(host, "gameplay");
    await host.screenshot({ path: `${SHOTS}/${viewport}-gameplay.png` });

    await driveRoom(code);
    await expectScreen(host, "game-end", RESULTS_TIMEOUT_MS);
    await host.screenshot({ path: `${SHOTS}/${viewport}-results.png` });

    if (viewport === "desktop") {
      const lowContext = await browser.newContext();
      try {
        const low = await lowContext.newPage();
        // This context is created outside Playwright's page fixture, so apply
        // the deterministic capture preference before the first navigation.
        await low.emulateMedia({ reducedMotion: "reduce" });
        await openClient(low, "/?refraction=low");
        await low.screenshot({ path: `${SHOTS}/desktop-main-menu-low.png` });
      } finally {
        await lowContext.close();
      }
    }
  } finally {
    for (const client of clients) await client.context().close().catch(() => undefined);
  }
});

// The same rooftops frame contains bright sky/sun and dark city. Keep both in
// each capture; this is visual evidence, not a physical-device acceptance gate.
test("four-player labels across LCD and motion settings", { tag: "@gpu" }, async ({ browser }, testInfo) => {
  test.slow();
  const clients = await openClients(browser, 4);
  const [host, ...guests] = clients as [import("@playwright/test").Page, ...import("@playwright/test").Page[]];
  try {
    const code = await createRoom(host, "Kite");
    await chooseMode(host, "floors-20");
    for (const [index, guest] of guests.entries()) await joinRoom(guest, code, ["Sable", "Wren", "Koi"][index]!);
    await holdRoomClocks(code, ["countdown"]);
    await readyOnly(clients);
    for (const client of clients) {
      await expect(client.getByTestId("select-screen")).toHaveAttribute("data-step", "stage");
      await pickStage(client, "rooftops");
    }
    await passSelect(clients);
    await Promise.all(clients.map((client) => expectScreen(client, "gameplay")));
    await holdRoomClocks(code, []);
    await waitForRoom(code, (now) => now.phase === "racing", { what: "labels after GO", ticks: 240 });
    await expect(host.getByTestId("race-count")).toBeHidden();
    for (const lcdPanel of [true, false]) {
      for (const reducedMotion of ["no-preference", "reduce"] as const) {
        await host.emulateMedia({ reducedMotion });
        await host.keyboard.press("Escape");
        await host.getByTestId("pause-settings").click();
        await host.getByTestId("settings-lcd").setChecked(lcdPanel);
        await expect(host.getByTestId("settings-lcd")).toBeChecked({ checked: lcdPanel });
        await host.getByTestId("pause-settings-back").click();
        await host.getByTestId("pause-resume").click();
        await expect(host.getByTestId("pause-resume")).toBeHidden();
        const prefix = `${SHOTS}/readability/${testInfo.project.name}-lcd-${lcdPanel ? "on" : "off"}-${reducedMotion}`;
        await expectCanvasHasPixels(host);
        await expectScreen(host, "gameplay");
        await host.screenshot({ path: `${prefix}-overlap.png` });
        const before = await readRoom(code);
        await Promise.all(clients.map((client) => client.keyboard.down("ArrowRight")));
        try {
          await waitForRoom(code, (now) => now.tick >= before.tick + 8 && now.seats.every((seat) => {
            const was = before.seats.find((candidate) => candidate.id === seat.id)!;
            const dx = ((seat.x - was.x + 480) % 960 + 960) % 960 - 480;
            return seat.input.right && Math.hypot(dx, seat.y - was.y) > 2;
          }), { what: "all four real clients move before the motion captures", ticks: 120 });
          // Real shared steering carries the labels away from the sun and
          // across the darker city, including the course seam. No bot inputs.
          for (let frame = 0; frame < 3; frame += 1) {
            await host.waitForTimeout(200);
            await expectScreen(host, "gameplay");
            await host.screenshot({ path: `${prefix}-moving-${frame}.png` });
          }
        } finally {
          await Promise.all(clients.map((client) => client.keyboard.up("ArrowRight")));
        }
      }
    }
  } finally {
    for (const client of clients) await client.context().close().catch(() => undefined);
  }
});

