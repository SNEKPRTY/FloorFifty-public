/**
 * The ready room's Rules popup is centred in the screen and wholly on it at
 * every desktop size, zoomed ones included. The UI zoom once multiplied the
 * dialog's centring offset, so the popup hung low and its foot left the screen.
 */
import { expect, test } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { createRoom, openClients } from "./support/room-driver";

test.beforeAll(async () => {
  await waitForServer();
});

const SIZES = [
  { width: 1280, height: 720 },
  { width: 985, height: 624 },
  { width: 1440, height: 900 },
  { width: 1970, height: 1248 },
];

test("the Rules popup is centred and on screen at every desktop size", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop sizes only");
  test.slow();
  const [page] = await openClients(browser, 1);
  await createRoom(page!, "Racer 90");
  for (const size of SIZES) {
    await page!.setViewportSize(size);
    await page!.getByTestId("ready-rules").click();
    const dialog = page!.getByTestId("ready-rules-sheet");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const close = (await page!.getByTestId("info-sheet-close").boundingBox())!;
    const label = `${size.width}x${size.height}`;
    expect(box.y, label).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, label).toBeLessThanOrEqual(size.height);
    expect(close.y + close.height, label).toBeLessThanOrEqual(size.height);
    // Centred: the space above and below differ by a few pixels at most.
    expect(Math.abs(box.y - (size.height - box.y - box.height)), label).toBeLessThanOrEqual(8);
    await page!.getByTestId("info-sheet-close").click();
    await expect(dialog).toHaveCount(0);
  }
});
