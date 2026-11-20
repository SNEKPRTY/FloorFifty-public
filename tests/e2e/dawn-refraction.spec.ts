import { expect, test } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { readInspection } from "./support/inspection";
import { maxProbeLineShift, type ProbeAxis } from "./support/pixels";
import {
  createRoom,
  expectCanvasHasPixels,
  expectScreen,
  joinRoom,
  openClient,
  openClients,
  readyAll,
} from "./support/room-driver";

test.use({ reducedMotion: "no-preference" });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

test("non-gameplay uses the refraction effect", async ({ page }) => {
  const gpuErrors: string[] = [];
  page.on("pageerror", (error) => gpuErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /shader|WebGL|GLSL/i.test(message.text())) {
      gpuErrors.push(message.text());
    }
  });

  await openClient(page, "/");
  await expect(page.getByTestId("overlay")).toHaveAttribute("data-refraction", "active");
  expect(
    await page.locator('[data-screen="lobby"]').evaluate((node) =>
      getComputedStyle(node).backgroundImage,
    ),
  ).toBe("none");
  await expectCanvasHasPixels(page);
  expect(gpuErrors).toEqual([]);
});

test("low quality is static but still draws", async ({ page }) => {
  await openClient(page, "/?refraction=low");
  await expect(page.getByTestId("overlay")).toHaveAttribute("data-refraction", "active");
  await expect(page.getByTestId("overlay")).toHaveAttribute(
    "data-refraction-quality",
    "low",
  );
  await expectCanvasHasPixels(page);
  // The controller deliberately pauses hidden documents. Foreground this page
  // before the authored 600 ms entry ease so parallel viewport workers cannot
  // leave the first capture at a partially eased intensity.
  await page.bringToFront();
  // The claim is about the backdrop, so the menu's DOM -- whose entrance runs
  // on requestAnimationFrame and pauses whenever another worker's page is in
  // front -- is hidden rather than photographed mid-animation.
  await page.getByTestId("overlay").evaluate((node) => {
    (node as HTMLElement).style.visibility = "hidden";
  });
  // Wait for the entrance to settle rather than for a fixed 700 ms: under the
  // full parallel matrix the split menu's plates can arrive later than that,
  // and a frame caught mid-entrance says nothing about low quality. Settled is
  // two identical captures in a row; static is the next one matching them.
  let first = await page.locator("#app > canvas").screenshot();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(150);
    const next = await page.locator("#app > canvas").screenshot();
    if (next.equals(first)) break;
    first = next;
  }
  await page.waitForTimeout(250);
  const second = await page.locator("#app > canvas").screenshot();
  expect(second.equals(first)).toBe(true);
});

test("reduced motion freezes the authored high-quality frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openClient(page, "/");
  await expect(page.getByTestId("overlay")).toHaveAttribute("data-refraction", "active");
  await expect(page.getByTestId("overlay")).toHaveAttribute(
    "data-refraction-quality",
    "high",
  );
  // Reduced motion freezes the authored clock, but it does not make texture
  // upload and the first GPU composite synchronous. Under the full parallel
  // matrix the first screenshot can catch that initial composite, then compare
  // it with the finished one and report motion that never happened. Wait for
  // two equal frames, as the low-quality still above does, then measure the
  // requested half-second hold from that stable frame.
  let first = await page.locator("#app > canvas").screenshot();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(150);
    const next = await page.locator("#app > canvas").screenshot();
    if (next.equals(first)) break;
    first = next;
  }
  await page.waitForTimeout(500);
  const second = await page.locator("#app > canvas").screenshot();
  expect(second.equals(first)).toBe(true);
});

test("gameplay refracts its scenery rather than the whole screen", async ({ browser }) => {
  // The ownership moved, and the assertions moved with it. This pass used to be
  // a screen-owned effect over the entire canvas, which is why the test that
  // lived here asserted the overlay carried no marker. It now runs over the
  // scenery alone, behind the world and the HUD -- so the marker is still
  // absent, because nothing screen-owned is refracting, while the scenery is
  // refracted. That second half is read off the screen's own report; asserting
  // only the absence would pass just as well if refraction had been dropped.
  test.slow();
  const clients = await openClients(browser, 2);
  const [host, guest] = clients;
  if (host === undefined || guest === undefined) throw new Error("two clients were not created");

  try {
    const code = await createRoom(host, "Kite");
    await joinRoom(guest, code, "Ninja 2");
    await readyAll(clients);
    await expectScreen(guest, "gameplay");

    const overlay = guest.getByTestId("overlay");
    expect(await overlay.getAttribute("data-refraction")).toBeNull();
    expect(await overlay.getAttribute("data-refraction-quality")).toBeNull();

    const inspection = await readInspection(guest);
    expect(inspection.refraction).toBe("sky+city");
    expect(inspection.citySampling).toBe("nearest");

    await expectCanvasHasPixels(guest);
  } finally {
    for (const page of clients) await page.context().close().catch(() => undefined);
  }
});

test("the refraction is isotropic at every pixel density", async ({ browser }, testInfo) => {
  // One GPU measurement, not one per viewport: the menu composite is a fixed
  // 960 x 540 target whatever the device, so the desktop answers for all.
  test.skip(testInfo.project.name !== "desktop", "desktop project only");

  // The letterbox bars cover the top and bottom twentieth of the field (27
  // units); the lines measured stay where the old tenth (54) left them clear,
  // which is inside the new band too.
  const clearOfBars: [number, number] = [64, 476];
  const measure = async (deviceScaleFactor: number, axis: ProbeAxis): Promise<number> => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await openClient(page, `/?refraction=high&refraction-probe=${axis}`);
      await expect(page.getByTestId("overlay")).toHaveAttribute("data-refraction", "active");
      // The menu's DOM sits over the canvas; the probe is measured without it.
      await page.getByTestId("overlay").evaluate((node) => {
        (node as HTMLElement).style.visibility = "hidden";
      });
      await page.waitForTimeout(200);
      const shot = await page.locator("#app > canvas").screenshot();
      return maxProbeLineShift(shot, axis, {
        along: axis === "vertical" ? clearOfBars : [64, 896],
        across: axis === "vertical" ? [0, 960] : clearOfBars,
      });
    } finally {
      await context.close();
    }
  };

  const shifts: Record<number, { x: number; y: number }> = {};
  for (const dpr of [1, 2]) {
    shifts[dpr] = { x: await measure(dpr, "vertical"), y: await measure(dpr, "horizontal") };
  }
  testInfo.annotations.push({ type: "refraction shifts", description: JSON.stringify(shifts) });

  const agree = (a: number, b: number): boolean => Math.abs(a - b) <= 0.25 * Math.max(a, b);
  for (const dpr of [1, 2]) {
    const { x, y } = shifts[dpr]!;
    // A frame that drew nothing would agree with itself; the warp must be there.
    expect(Math.min(x, y), `DPR ${dpr} shifts ${JSON.stringify(shifts)}`).toBeGreaterThan(1);
    expect(agree(x, y), `DPR ${dpr}: x ${x.toFixed(2)} vs y ${y.toFixed(2)}`).toBe(true);
  }
  expect(agree(shifts[1]!.x, shifts[2]!.x), JSON.stringify(shifts)).toBe(true);
  expect(agree(shifts[1]!.y, shifts[2]!.y), JSON.stringify(shifts)).toBe(true);
});
