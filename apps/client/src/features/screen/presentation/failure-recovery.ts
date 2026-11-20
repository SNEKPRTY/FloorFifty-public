/**
 * What the game does when the presentation reports a failure (audit S14).
 *
 * The screen manager exits a screen that fails to open and sets none in its
 * place. The failure went only to an error channel that the menu or the lobby
 * reads when it next opens, and nothing opened one, so the player had a bare
 * canvas while their seat stayed in the race, and the sentence kept for them
 * said the game "went back to the menu". Now it does: after reporting, an empty
 * place is filled with the menu, which shows the report as it opens.
 *
 * One attempt per empty place. If the menu itself fails to open, nothing is
 * tried again until a screen has shown in between, so a broken menu cannot
 * become a loop.
 */

import type { ScreenId } from "../../profile/screen-state";

/** The screen that stands in for one that failed. It reads the reported failure on entry. */
export const FALLBACK_SCREEN: ScreenId = "MainMenu";

export type FailureRecoveryDeps = {
  screens: { readonly currentName: ScreenId | undefined; transition(next: ScreenId): Promise<void> };
  /** Puts the failure on the error channel the fallback screen reads. */
  report(): void;
};

export function createFailureRecovery(deps: FailureRecoveryDeps): () => void {
  let attempted = false;
  return () => {
    // Before the transition, so the fallback screen finds it when it opens.
    deps.report();
    if (deps.screens.currentName !== undefined) {
      attempted = false;
      return;
    }
    if (attempted) return;
    attempted = true;
    void deps.screens.transition(FALLBACK_SCREEN).catch(() => undefined);
  };
}
