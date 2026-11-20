/**
 * The screen manager.
 *
 * It owns exactly one thing: which screen is live. Transitions are serial and
 * always exit the previous screen before entering the next, so two screens can
 * never both hold display objects, listeners, or an input subscription.
 *
 * It holds no navigation policy. Which screen follows which is the authored
 * flow graph's answer, resolved by `PresentationFlowController`; this class is
 * told a destination and gets there safely.
 */

import type { TransitionStyle } from "@floor-fifty/shared/content/presentation";
import type { ScreenId } from "../profile/screen-state";
import type { Screen, ScreenContext } from "./screen";
import { CarryOver } from "../profile/carry-over";
import type { PresentationPublisher } from "./presentation/presentation-event-bus";
import type { VeilPort } from "../render/veil";
import type { FadePort } from "../kit/screen-fade";

export type ScreenFactory = () => Screen;

/** One queued request, with the promise the caller is holding. */
type TransitionRequest = {
  readonly target: ScreenId;
  readonly style: TransitionStyle;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

export class ScreenManager {
  private current: Screen | undefined;
  private readonly queue: TransitionRequest[] = [];
  /** The drain in flight, if any. Also what `settled` waits on. */
  private active: Promise<void> | undefined;
  /**
   * Whether a drain is running, cleared synchronously when its loop ends.
   *
   * A promise cannot serve as the gate on its own: a caller awaiting the
   * transition it just queued resumes before that promise's own `finally`
   * runs, so it would find the gate still closed and its next request would
   * never be picked up.
   */
  private draining = false;
  /** What one screen hands the next; see `carry-over.ts`. */
  private readonly carryOver = new CarryOver();

  constructor(
    private readonly factories: Record<ScreenId, ScreenFactory>,
    private readonly context: Omit<ScreenContext, "publishPresentationEvent" | "carryOver" | "veilCleared">,
    private readonly publish: PresentationPublisher,
    /** Made on the first liquid edge and kept (race-flow spec §7.3). */
    private readonly makeVeil?: () => VeilPort,
    /** The 200 ms cross-fade of a `fade` edge; absent, a fade edge is a cut. */
    private readonly fade?: FadePort,
  ) {}

  private veil: VeilPort | undefined;
  /** Whether the veil is up: requests that arrive under it run under it. */
  private covered = false;
  /** Screens waiting for the veil to clear (`ScreenContext.veilCleared`). */
  private clearWaiters: Array<() => void> = [];

  get currentName(): ScreenId | undefined {
    return this.current?.name;
  }

  /**
   * Moves to `next`, queued behind any transition already running.
   *
   * Queuing rather than rejecting matters because transitions are provoked by
   * snapshots: two snapshots arriving during a slow asset load would otherwise
   * race, and one of the two screens would leak.
   */
  transition(next: ScreenId, style: TransitionStyle = "cut"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ target: next, style, resolve, reject });
      this.startDrain();
    });
  }

  /**
   * Raises the veil for a liquid edge. A veil that cannot be made or cannot
   * cover leaves the edge a cut: the screen still changes, and a later edge
   * tries again.
   */
  private async tryCover(): Promise<void> {
    if (this.makeVeil === undefined) return;
    try {
      this.veil ??= this.makeVeil();
      this.covered = true;
      await this.veil.cover();
    } catch {
      // Still marked covered when the veil exists: its reveal tidies whatever
      // part of the cover did happen.
      if (this.veil === undefined) {
        this.covered = false;
        this.settleClearWaiters();
      }
    }
  }

  /** At once when the veil is down; otherwise once its reveal has finished. */
  private veilCleared = (): Promise<void> => {
    if (!this.covered) return Promise.resolve();
    return new Promise<void>((resolve) => this.clearWaiters.push(resolve));
  };

  private settleClearWaiters(): void {
    for (const resolve of this.clearWaiters.splice(0)) resolve();
  }

  /** Resolves once nothing is queued. Never rejects; requests carry failures. */
  async settled(): Promise<void> {
    while (this.active !== undefined) await this.active;
  }

  private startDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.active = this.drain();
  }

  /**
   * An explicit queue rather than a chained promise.
   *
   * A chain rejects once and stays rejected, so one screen failing to enter
   * would poison every later transition for the life of the session. Here a
   * failure rejects the request that caused it and everything queued behind
   * it -- those were queued against a screen graph that no longer applies --
   * and then the queue is open again for an explicit retry.
   */
  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const request = this.queue.shift() as TransitionRequest;
        try {
          if (request.style === "liquid" && !this.covered) await this.tryCover();
          await this.run(request.target, request.style === "fade" ? this.fade : undefined);
          request.resolve();
        } catch (error) {
          request.reject(error);
          for (const stranded of this.queue.splice(0)) stranded.reject(error);
        }
        // Requests that arrived under the cover ran under it; the last one out
        // reveals. A failed enter reveals too, so the veil never stays up.
        if (this.queue.length === 0 && this.covered) {
          this.covered = false;
          await this.veil?.reveal().catch(() => undefined);
          this.settleClearWaiters();
        }
      }
    } finally {
      this.draining = false;
      this.active = undefined;
    }
  }

  private async run(next: ScreenId, fade?: FadePort): Promise<void> {
    if (this.current?.name === next) return;

    // A fade edge fades what is showing out first; the first screen of all has
    // nothing to fade. Whatever happens next, the fade comes back in.
    let fadeBackIn: (() => void) | undefined;
    if (fade !== undefined && this.current !== undefined) {
      await fade.out();
      let done = false;
      fadeBackIn = () => {
        if (!done) fade.in();
        done = true;
      };
    }

    // Exit first. A screen that is still mounted while the next one loads can
    // receive a snapshot it is no longer entitled to act on. The carry-over is
    // held across the gap, so what the outgoing screen released survives if
    // the incoming one claims it.
    const previous = this.current?.name;
    this.carryOver.hold();
    try {
      this.current?.exit();
      this.current = undefined;
      await this.enter(next, previous, fadeBackIn);
    } finally {
      this.carryOver.settle();
      // A failed enter leaves nothing to fade in to, but the overlay must not
      // stay transparent and inert: the failure recovery mounts the menu on it.
      fadeBackIn?.();
    }
  }

  private async enter(next: ScreenId, previous: ScreenId | undefined, fadeIn?: () => void): Promise<void> {
    const screen = this.factories[next]();
    // The origin rides along, so a screen can tell a resumed seat (from
    // Splash) from Race again (from GameEnd) without a flag anyone sets.
    const context: ScreenContext = {
      ...this.context,
      publishPresentationEvent: this.publish,
      carryOver: this.carryOver,
      veilCleared: this.veilCleared,
      ...(previous === undefined ? {} : { previousScreen: previous }),
    };

    // Current *before* entering, not after: a screen that publishes during its
    // own asynchronous `enter` -- splash, once its bundle resolves -- must have
    // its event resolved against itself rather than against no screen at all.
    this.current = screen;
    try {
      const entering = screen.enter(context);
      // The screen has mounted what it mounts synchronously: fade it in now,
      // so it takes input as soon as it is there rather than after its loads.
      fadeIn?.();
      await entering;
    } catch (error) {
      screen.exit();
      this.current = undefined;
      throw error;
    }
  }

  /** The host's "Open game menu", answered by the screen on show (Ruken P6 §4). */
  openMenu(): boolean {
    return this.current?.openMenu?.() ?? false;
  }

  /** Tears down the live screen, as a page unload does. */
  dispose(): void {
    this.current?.exit();
    this.current = undefined;
    // The veil's canvas and its GL context go with the app (race-flow spec §7.2).
    this.veil?.destroy();
    this.veil = undefined;
    // Nothing will reveal now: a loader waiting on the veil goes too.
    this.covered = false;
    this.settleClearWaiters();
  }
}
