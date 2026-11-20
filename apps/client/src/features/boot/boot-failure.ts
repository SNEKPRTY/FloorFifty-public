import * as m from "../../paraglide/messages.js";
import { BUTTON_GO_DOM_CLASS, PANEL_DOM_CLASS } from "../kit/dom-classes";
import { dismissBootLoader } from "./boot-loader";

/**
 * Shown instead of a blank canvas when the client cannot start at all.
 *
 * Two things can put us here: the renderer may fail, or the server may be
 * unreachable, which means the client has no screen graph to build. Both leave
 * nothing to draw, and the retry -- a page reload -- is the right answer to
 * both. There is deliberately no bundled fallback flow: a client guessing its
 * own navigation is the failure mode the authored artifact exists to remove.
 *
 * The panel says what the player can do, in the game's words. The error's own
 * message is a library's text and stays out of it (audit S15, docs/copy-style.md);
 * what failed is reported by the caller's boot telemetry.
 */
export function renderBootFailure(host: HTMLElement, _error: unknown): void {
  host.innerHTML = "";
  // No splash will lift the boot black; the failure reads on the page colour.
  document.documentElement.classList.remove("ff-booting");
  dismissBootLoader();
  const panel = document.createElement("div");
  // The kit's glass and its rise, in the middle of the screen across and down (`.ff-boot-error`).
  panel.className = `ff-boot-error ${PANEL_DOM_CLASS}`;
  panel.dataset["testid"] = "boot-error";
  panel.innerHTML = `
    <h1></h1>
    <p class="ff-reason"></p>
    <button type="button" data-testid="boot-retry" class="${BUTTON_GO_DOM_CLASS}"></button>
  `;
  // Text, not markup: the copy is the player's language (the strategy is
  // installed before anything can fail), set as text so no catalogue can inject.
  panel.querySelector("h1")!.textContent = m.shell_boot_failed_title();
  panel.querySelector(".ff-reason")!.textContent = m.shell_boot_failed_body();
  panel.querySelector("button")!.textContent = m.shell_try_again();
  panel.querySelector("button")!.addEventListener("click", () => window.location.reload());
  host.appendChild(panel);
}
