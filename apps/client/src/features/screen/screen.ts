/**
 * The screen contract.
 *
 * `enter` creates only what the screen owns; `exit` removes it. Nothing else in
 * the client destroys a screen's display objects or listeners, so ownership is
 * always answerable by reading one file.
 */

import type { AccessOptions } from "../profile/access";
import type { ProgressStore } from "../profile/store/progress.svelte";
import type { RaceVideo } from "../net/race-video.svelte";
import { DisposeBag } from "../../lib/dispose";
import type { ScreenId } from "../profile/screen-state";
import type { AssetPort } from "../render/assets";
import type { AudioPort } from "../audio";
import type { CarryOverPort } from "../profile/carry-over";
import type { GamepadSource } from "../platform/gamepad-source";
import type { ContentPort } from "../net/content";
import type { PresentationPublisher } from "./presentation/presentation-event-bus";
import type { NetworkPort } from "../net/network";
import type { ErrorChannel } from "../net/error-view";
import type { SettingsStore } from "../profile/store/settings.svelte";
import type { Hosting } from "../ruken/host";
import type { LoadMeter } from "../../lib/load-meter";
import type { StagePort } from "../render/stage-port";

export type ScreenContext = {
  readonly stage: StagePort;
  readonly assets: AssetPort;
  readonly audio: AudioPort;
  readonly network: NetworkPort;
  /**
   * Public content: the catalog, and from Task 9 the flow graph too.
   *
   * A screen reads it and may ask for a refresh; nothing a screen does can
   * make content authoritative over a room.
   */
  readonly content: ContentPort;
  /**
   * Carries a failure across a transition.
   *
   * A screen that has to leave because of a failure reports it here, and the
   * screen that takes over shows it. Without this a player would be moved back
   * to the menu with no explanation.
   */
  readonly errors: ErrorChannel;
  /**
   * Reports that an allowlisted fact occurred.
   *
   * A screen says what happened, never where to go. The destination is the
   * authored flow graph's answer, so a screen cannot invent a results screen
   * out of a transport error, and a content reload can change the route
   * without touching any screen.
   */
  readonly publishPresentationEvent: PresentationPublisher;
  /**
   * The player's per-device settings, live (launch polish §3.1.2). A screen
   * reads them and subscribes; the app-level ones are applied by the bridge.
   */
  readonly settings: SettingsStore;
  /**
   * The app's controller. A race hands it its input for the race's life, and
   * the menus have it back when the race lets go (spec §3.1.3).
   */
  readonly gamepad: Pick<GamepadSource, "setRaceTarget">;
  /**
   * What survives from one screen to the next when both claim it: the menu
   * backdrop the title and the lobby share. See `carry-over.ts`.
   */
  readonly carryOver: CarryOverPort;
  /** The screen that was showing before this one, if any. */
  readonly previousScreen?: ScreenId;
  /**
   * Settles once the transition veil has fully cleared, or at once when it is
   * not up. A loader drawn over the wipe stays until then: taken down while
   * the veil is still fully up, it leaves a frame of bare blue. Absent in
   * tests that do not ask for it, where there is no veil.
   */
  readonly veilCleared?: () => Promise<void>;
  /**
   * What this device may pick: `?dev=unlock-all` in a dev build (select spec
   * §4.3), what it earned and what it owns (unlockables spec §5, §8).
   */
  readonly access?: AccessOptions;
  /** What this device earned by play, for results and the tile reveal (unlockables spec §5). */
  readonly progress?: ProgressStore;
  /** The last race's video, recorded live (unlockables spec §6.1); absent where nothing records. */
  readonly raceVideo?: RaceVideo;
  /**
   * Ruken, when the game runs inside it (Ruken P6 spec §3): the break after
   * results, round telemetry, analytics and the host's menu. Absent in tests
   * that do not ask for it, which then behave as standalone.
   */
  readonly hosting?: Hosting;
  /**
   * The page's one stall rule and its clock (`lib/load-meter.ts`): a
   * screen that waits on something the asset and audio managers do not guard
   * (the splash's fonts) answers to it, and the slow line counts on its
   * timers. Absent in tests that do not ask for it, which get a fresh one.
   */
  readonly loads?: LoadMeter;
};

export interface Screen {
  readonly name: ScreenId;
  enter(context: ScreenContext): Promise<void>;
  exit(): void;
  /**
   * The host's "Open game menu" (Ruken P6 §4): opens this screen's own menu
   * and returns true, or returns false when it has none, and the host keeps
   * its own drawer open instead.
   */
  openMenu?(): boolean;
}

/**
 * Shared screen plumbing.
 *
 * Subclasses register everything they create with `this.bag`; `exit` runs that
 * teardown exactly once and is safe to call on a screen that never entered.
 */
export abstract class BaseScreen implements Screen {
  abstract readonly name: ScreenId;

  protected bag = new DisposeBag();
  protected context: ScreenContext | undefined;

  async enter(context: ScreenContext): Promise<void> {
    this.context = context;
    this.bag = new DisposeBag();
    await this.onEnter(context);
  }

  exit(): void {
    this.onExit();
    this.bag.dispose();
    this.context = undefined;
  }

  /** No menu of its own: the host's drawer stays. Screens with a pause or Settings override this. */
  openMenu(): boolean {
    return false;
  }

  protected abstract onEnter(context: ScreenContext): Promise<void>;

  /** Optional hook for teardown that must run before disposal. */
  protected onExit(): void {}

  /** The context, or a clear failure rather than an undefined dereference. */
  protected requireContext(): ScreenContext {
    if (this.context === undefined) throw new Error(`${this.name} is not entered`);
    return this.context;
  }
}
