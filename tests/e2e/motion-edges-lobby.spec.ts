import { expect, test, type Page } from "./support/test";
import { CLIENT_FOLLOWS_MS, createRoom, enterLobby, expectScreen, openTitle } from "./support/room-driver";

/**
 * The lobby's gaps from the animations audit (batch 3), one row each, watched in a real browser
 * (the project's internal notes, U3b). Kept in its
 * own file so the screen groups merge without touching each other's lines; `motion-edges.spec.ts`
 * holds the same kind of rows for the other groups.
 *
 * Nothing samples at a clock time. A software-rendered container stalls for hundreds of milliseconds
 * a frame, so a row asks what the page did at the moment of the change, from a `MutationObserver`
 * that runs before the first frame: an arriving element is first seen transparent and animating, a
 * leaving one is `inert` while its exit still runs. Under reduced motion the same row expects the end
 * state at once and no animation at all.
 */

interface Sight {
  opacity: number;
  animating: boolean;
  inert: boolean;
}
interface Watched {
  arrived?: Sight;
  leaving?: Sight;
  events: string[];
  gone: boolean;
}
interface Watch {
  selector: string;
  /** The ancestor to watch instead, where the selector's own node is not what fades. */
  closest?: string;
}

/** Installs the in-page observer before any script of the page runs. */
async function watch(page: Page, watches: Record<string, Watch>): Promise<void> {
  await page.addInitScript((spec) => {
    const found: Record<string, Watched & { node?: Element }> = {};
    (window as unknown as { __edges: typeof found }).__edges = found;
    const sight = (node: Element): Sight => ({
      opacity: Number(getComputedStyle(node).opacity),
      animating: node.getAnimations({ subtree: false }).length > 0,
      inert: (node as HTMLElement).inert === true,
    });
    const find = (target: Watch): Element | null => {
      const hit = document.querySelector(target.selector);
      return hit !== null && target.closest !== undefined ? hit.closest(target.closest) : hit;
    };
    const look = (): void => {
      for (const [key, target] of Object.entries(spec)) {
        const entry = (found[key] ??= { events: [], gone: false });
        const node = entry.node ?? find(target);
        if (node === null || node === undefined) continue;
        if (entry.node === undefined) {
          entry.node = node;
          entry.arrived = sight(node);
          for (const name of ["introstart", "outrostart"]) node.addEventListener(name, () => entry.events.push(name));
        }
        if (entry.leaving === undefined && (node as HTMLElement).inert === true) entry.leaving = sight(node);
        if (!node.isConnected) entry.gone = true;
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert"] });
  }, watches);
}

const edge = (page: Page, key: string): Promise<Watched | undefined> =>
  page.evaluate((name) => {
    const entry = (window as unknown as { __edges: Record<string, Watched & { node?: Element }> }).__edges[name];
    if (entry === undefined) return undefined;
    const { node: _node, ...rest } = entry;
    return rest;
  }, key);

const opacityOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!).opacity), selector);

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  const still = reducedMotion === "reduce";

  test.describe(`lobby, motion ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test("find a race is a glass panel that rises in", async ({ page }) => {
      await watch(page, { card: { selector: ".ff-connect__card" } });
      await openTitle(page);
      await page.getByTestId("title-play").click();
      await expectScreen(page, "lobby");
      const card = page.locator(".ff-connect__card");
      await expect(card).toBeVisible();
      await expect(card).toHaveClass(/ff-aquarian-panel/);

      const seen = await edge(page, "card");
      expect(seen?.arrived?.opacity === 1, still ? "settles at once" : "arrives transparent").toBe(still);
      expect(seen?.arrived?.animating).toBe(!still);
      await expect.poll(() => opacityOf(page, ".ff-connect__card")).toBe(1);
    });

    test("going from find a race to the ready room fades the form out and the room in", async ({ page }) => {
      await watch(page, {
        form: { selector: '[data-testid="find-race"]', closest: ".ff-view" },
        room: { selector: '[data-testid="ready-room"]', closest: ".ff-view" },
      });
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Edge");
      await expect(page.getByTestId("ready-room")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });

      await expect.poll(async () => (await edge(page, "form"))?.gone, "the form is gone once its exit is done").toBe(true);
      const form = await edge(page, "form");
      if (!still) {
        expect(form?.leaving?.inert, "inert from its first leaving frame").toBe(true);
        expect(form?.events, "and its exit ran").toContain("outrostart");
      }
      const room = await edge(page, "room");
      if (still) expect(room?.arrived?.opacity, "the room is there at once").toBe(1);
      else expect(room?.events, "the room fades in").toContain("introstart");
      await expect.poll(() => page.getByTestId("ready-room").evaluate((node) => Number(getComputedStyle(node.closest(".ff-view")!).opacity))).toBe(1);
    });

    test("the ready room's panel is glass", async ({ page }) => {
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Glass");
      const panel = page.locator(".ff-ready__chip");
      await expect(panel).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      await expect(panel).toHaveClass(/ff-aquarian-panel/);
      await expect(page.locator(".ff-room-code")).toHaveClass(/ff-aquarian-panel/);
    });
  });
}
