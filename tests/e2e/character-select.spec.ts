import { expect, test, type Page } from "./support/test";
import { createRoom, enterLobby, expectScreen, joinRoom, openClients, openTitle, passSplash, readyAll, RESULTS_TIMEOUT_MS } from "./support/room-driver";
import { evidenceDir } from "./support/evidence";
import { driveRoom, waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

const tile = (page: Page, id: string) => page.getByTestId("character-page").locator(`[data-testid=tile][data-id="${id}"]`);
const seatOf = (page: Page, index: number) => page.getByTestId("seat").nth(index);

test("the title's Character page shows what is open, locked and DLC, a tap only views, and Back keeps the pick", async ({ page }) => {
  // A production build: no ?dev=unlock-all, so only the ninja is open.
  await openTitle(page);
  await page.getByTestId("title-character").click();
  await expect(tile(page, "ninja")).toHaveAttribute("data-state", "open");
  await expect(tile(page, "frog")).toHaveAttribute("data-state", "locked");
  await expect(tile(page, "robo")).toHaveAttribute("data-state", "locked");
  await expect(tile(page, "penguin")).toHaveAttribute("data-state", "dlc");
  await tile(page, "frog").click();
  await expect(page.getByTestId("character-preview-name")).toHaveText("Frog");
  await expect(page.getByTestId("character-preview-access")).toContainText("Finish 5 races");
  await expect(page.getByTestId("character-pick")).toHaveCount(0);
  await expect(page.getByTestId("character-page")).toBeVisible();
  await page.getByTestId("character-back").click();
  await expect(page.getByTestId("character-page")).toHaveCount(0);
  await enterLobby(page);
});

test("character-panel keeps the roster fixed across picked, locked and DLC previews", async ({ page }, testInfo) => {
  await openTitle(page);
  await page.getByTestId("title-character").click();
  const geometry = () => page.getByTestId("character-page").locator('[data-testid="tile"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { id: (node as HTMLElement).dataset["id"], x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  for (const id of ["frog", "oni", "ninja"]) {
    // Phones page the roster. Navigate normally before comparing a preview;
    // the carousel's intentional movement is separate from selection reflow.
    const pages = await page.getByTestId("character-page").getByTestId("tile-page").count();
    for (let turn = 0; turn < pages; turn += 1) {
      if (await tile(page, id).evaluate((node) => node.closest("[inert]") === null)) break;
      await page.getByTestId("character-page").getByTestId("page-next").click();
    }
    await expect.poll(() => tile(page, id).evaluate((node) => node.closest("[inert]") === null)).toBe(true);
    const before = await geometry();
    expect(before.length).toBeGreaterThan(0);
    await tile(page, id).click();
    await expect(page.getByTestId("character-preview-name")).toHaveText(id === "oni" ? "Oni" : id === "frog" ? "Frog" : "Ninja");
    await page.screenshot({ path: `${evidenceDir()}/${testInfo.project.name}-character-panel-${id}.png` });
    await expect.poll(geometry, { message: `${id} preview leaves the roster in place` }).toEqual(before);
  }
});

test("two players: one picks ? from the seat, the other sees it, Ready locks it, and the race resolves it", async ({ browser }) => {
  test.slow();
  const pages = await openClients(browser, 2);
  const [a, b] = pages as [Page, Page];
  try {
    const code = await createRoom(a, "Alpha");
    await joinRoom(b, code, "Bravo");

    // A tap on ? views it; Pick picks it and the page closes after its hop.
    await a.getByTestId("seat-change").click();
    await a.getByTestId("tile-random").click();
    await expect(a.getByTestId("character-preview-name")).toHaveText("Random");
    await a.getByTestId("character-pick").click();
    await expect(a.getByTestId("character-page")).toHaveCount(0);
    await expect(seatOf(b, 0)).toHaveAttribute("data-character", "?");


    // Ready locks the character: the seat button is disabled until un-ready.
    await a.getByTestId("ready-toggle").click();
    await expect(a.getByTestId("seat-change")).toBeDisabled();
    await a.getByTestId("ready-toggle").click();
    await expect(a.getByTestId("seat-change")).toBeEnabled();

    await readyAll([a, b]);
    await expectScreen(a, "gameplay");
    await driveRoom(code);
    await expectScreen(a, "game-end", RESULTS_TIMEOUT_MS);
    // ? resolved to a body the seat had: the open set is the ninja alone.
    const portraits = await a.getByTestId("result-portrait").evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
    expect(portraits.length).toBe(2);
    for (const src of portraits) expect(src).toMatch(/\/assets\/production\/portrait-(scarlet|cyan)-(win|lose)\.png$/);
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("the ready room survives a reload with the character kept", async ({ browser }) => {
  test.slow();
  const pages = await openClients(browser, 2);
  const [a, b] = pages as [Page, Page];
  try {
    const code = await createRoom(a, "Alpha");
    await joinRoom(b, code, "Bravo");
    await a.getByTestId("seat-change").click();
    await a.getByTestId("tile-random").click();
    await a.getByTestId("character-pick").click();
    await expect(a.getByTestId("character-page")).toHaveCount(0);
    await a.reload();
    // The splash still asks for its tap: it is the gesture that unlocks sound.
    await passSplash(a);
    await expectScreen(a, "lobby");
    await expect(seatOf(a, 0)).toHaveAttribute("data-character", "?");
  } finally {
    for (const page of pages) await page.context().close();
  }
});
