/**
 * Whether the game runs inside another page's frame, as it does in Ruken
 * (audit S9).
 *
 * Ruken serves the game in a sandboxed iframe and answers no handshake, so
 * `hosting.hosted` is never true; the frame itself is the one thing the game
 * can see. Inside it the host owns the page and its full screen, so the game
 * shows no "turn your phone upright" cover: its advice (add the page to the
 * Home Screen) would install Ruken's page, and a cover waiting on a full
 * screen the frame cannot give would never lift.
 */

/** The two windows the check compares; `window` satisfies it. */
export type FrameWindow = { readonly self: unknown; readonly top: unknown };

/**
 * True when this window is not the top one. A sandboxed or cross-origin frame
 * may refuse to say what the top window is, which is itself the answer.
 */
export function isEmbedded(win: FrameWindow): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** Whether the landscape cover is mounted: not under automation, not hosted, not in a frame. */
export function mountsLandscapeGate(inputs: { webdriver: boolean; hosted: boolean; embedded: boolean }): boolean {
  return !inputs.webdriver && !inputs.hosted && !inputs.embedded;
}
