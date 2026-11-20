import { expect, type Frame, type Page } from "@playwright/test";

/**
 * The studio's own screen (SNEKPRTY on white, three seconds) comes up first at
 * every launch. A touch ends it at once, as a player's would, so a spec that is
 * not about it does not sit through it. Waits for it only if it is there.
 */
export async function passStudio(game: Page | Frame): Promise<void> {
  const studio = game.getByTestId("studio-splash");
  if (!(await studio.isVisible().catch(() => false))) return;
  await studio.click({ force: true });
  await expect(studio).toHaveCount(0, { timeout: 5_000 });
}
