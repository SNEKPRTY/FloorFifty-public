/**
 * MainMenu: the title (launch polish §3.1.1).
 *
 * The first screen a player chooses from. It forms no room and follows no
 * snapshot: Play reports `ui.play-requested`, and the authored graph takes
 * the player to the lobby, where rooms are made. A failed race recovers here,
 * so the title is also where the reason for that is shown.
 */

import { NO_ACCESS } from "../profile/access";
import { mount, unmount } from "svelte";
import type { ScreenId } from "../profile/screen-state";
import TitleRoot from "./TitleRoot.svelte";
import { ErrorView } from "../screen/error-panel.svelte";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { claimMenuBackdrop } from "../boot/menu-backdrop";
import { claimMenuBed, claimMenuMusic } from "../boot/menu-music";
import { takeWordmark } from "../boot/wordmark-handoff";
import { reducedMotion } from "../kit/motion";
import { MENU_INTRO } from "../render/non-gameplay-backdrop";
import { SPLASH_BARS_FADE_MS } from "../boot/splash";

/**
 * How long the arrival from the splash takes, from the title's mount to its
 * last moving piece at rest: the camera's pull back (`MENU_INTRO`), the bars
 * coming up to the palette's black, and the racers' drop, which ends last --
 * scarlet waits 300 ms and three 120 ms steps, then falls for 520 ms
 * (`MenuHero`'s `ff-racer-drop`).
 */
export const TITLE_ARRIVAL_MS = Math.max(MENU_INTRO.seconds * 1000, SPLASH_BARS_FADE_MS, 300 + 3 * 120 + 520);

export class MainMenuScreen extends BaseScreen {
  readonly name: ScreenId = "MainMenu";

  /** The mounted title, while it is on screen. */
  private title: { openSettings(): void } | undefined;

  /** The host's menu button opens the title's Settings. */
  override openMenu(): boolean {
    if (this.title === undefined) return false;
    this.title.openSettings();
    return true;
  }

  protected async onEnter(context: ScreenContext): Promise<void> {
    await context.assets.loadBundle("menu");
    // Shared with the other menu screen, so the switch keeps the sky and the song.
    // Fresh from the splash, the camera pulls back as the racers drop in.
    // The title's camera is struck by the song's kick; the lobby's is not.
    this.bag.add(claimMenuBackdrop(context, { zoomIn: context.previousScreen === "Splash", beatZoom: true }));
    this.bag.add(claimMenuMusic(context));
    this.bag.add(claimMenuBed(context));

    const app = mount(TitleRoot, {
      target: context.stage.overlay,
      props: {
        settings: context.settings,
        content: () => context.content.current()?.content,
        artSrc: (alias: string) => context.assets.srcOf?.(alias),
        access: context.access ?? NO_ACCESS,
        // Back from the lobby: its hero is on screen already, so only the
        // panel changes.
        heroRises: context.previousScreen !== "Lobby",
        // Fresh from the splash, the racers fall onto the ledge one by one.
        racersDrop: context.previousScreen === "Splash",
        // And the splash's wordmark slides over to its place in the hero.
        wordmarkFrom: context.previousScreen === "Splash" ? takeWordmark() : undefined,
        onPlay: () => context.publishPresentationEvent("ui.play-requested", {}),
      },
    });
    // `openSettings` is the title's one export (TitleRoot.svelte).
    this.title = app as { openSettings(): void };
    this.bag.add(() => {
      this.title = undefined;
      void unmount(app);
    });
    context.stage.overlay.dataset["screen"] = "title";

    // Fresh from the splash, nothing answers until the arrival is over: the
    // tap that left the splash would otherwise land its release on whatever
    // the title set under it, and a choice made mid-transition leaves before
    // the title has finished arriving. `inert` blocks pointer, key and focus
    // alike. With reduced motion nothing moves, so there is nothing to wait out.
    if (context.previousScreen === "Splash" && !reducedMotion()) {
      const overlay = context.stage.overlay;
      overlay.toggleAttribute("inert", true);
      const timer = setTimeout(() => overlay.toggleAttribute("inert", false), TITLE_ARRIVAL_MS);
      this.bag.add(() => {
        clearTimeout(timer);
        overlay.toggleAttribute("inert", false);
      });
    }

    // Where a failed race lands: say why before anything else. A sibling of
    // the title, as in the lobby, so nothing the title redraws clears it.
    const errorHost = document.createElement("div");
    context.stage.overlay.append(errorHost);
    const errorView = new ErrorView(errorHost);
    this.bag.add(() => {
      errorView.hide();
      errorHost.remove();
    });
    const pending = context.errors.take();
    if (pending !== undefined) errorView.show(pending, { onDismiss: () => {} });

    // The title is a legal moment to adopt new content (`REPLACEABLE_ON`):
    // refreshed on entry, and on the server's notification, which is the only
    // news of a rebuild a player outside a room ever gets.
    const refresh = (): void => void context.content.refresh().catch(() => undefined);
    refresh();
    this.bag.add(context.network.subscribe({ onContentRevision: refresh }));
  }
}
