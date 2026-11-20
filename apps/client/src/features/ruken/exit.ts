/**
 * Leaving through Ruken (P6 §4): the host closing the game, and links that
 * leave the game.
 */

import type { Hosting } from "./host";

/** How long the game may hold the host's close (P6 §4: "1 s cap"). */
export const HOST_EXIT_CAP_MS = 1000;

/**
 * When the host closes the game (`session.exiting`), every save still on its
 * way is handed to the host and the room is left, so the seat frees for the
 * others at once rather than after the server's reconnection grace. The host
 * waits for this before closing, but never more than `HOST_EXIT_CAP_MS`: a
 * room that does not answer must not keep a player from leaving.
 */
export function flushAndLeaveOnHostExit(
  hosting: Pick<Hosting, "onExiting" | "flushSaves">,
  network: { leaveRoom(): Promise<void> },
): () => void {
  return hosting.onExiting(async () => {
    const work = Promise.all([hosting.flushSaves(), network.leaveRoom().catch(() => undefined)]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, HOST_EXIT_CAP_MS)));
    await Promise.race([work, cap]);
    clearTimeout(timer);
  });
}

/**
 * Inside Ruken, a link that opens a new window (the studio's socials) goes
 * through the host instead: the game's sandbox has no pop-ups, and the host
 * asks the player before taking them anywhere (`links.open`). One listener on
 * the document covers every such link, so no component needs to know.
 * Standalone it installs nothing and the browser follows the link as before.
 */
export function routeLinksThroughHost(doc: Document, hosting: Pick<Hosting, "hosted" | "openLink">): () => void {
  if (!hosting.hosted) return () => undefined;
  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const link = target?.closest?.("a[target='_blank']") as HTMLAnchorElement | null | undefined;
    if (link === null || link === undefined || !link.href.startsWith("https://")) return;
    event.preventDefault();
    void hosting.openLink(link.href);
  };
  // Capture, so a control that stops propagation cannot let a link slip past.
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
