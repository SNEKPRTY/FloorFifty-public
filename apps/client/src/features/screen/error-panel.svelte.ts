/**
 * Mounting a failure panel from imperative code.
 *
 * Three callers still own their own lifecycle rather than living inside a
 * component tree: the boot path in `main.ts`, which has no screen yet, and the
 * menu, which shows the reason a race ejected the player.
 *
 * So the view is a Svelte component and this is the seam. The class keeps the
 * shape those callers already use -- `show`, `hide`, `isShowing`, `text` --
 * while the markup, the styling and the motion live with every other panel.
 *
 * `.svelte.ts` because the props are `$state`: a second failure arriving
 * replaces the first by writing to them, rather than by tearing the component
 * down and building another one in its place.
 */

import { mount, unmount } from "svelte";
import ErrorPanel from "./ErrorPanel.svelte";
import { errorCopy } from "./error-copy";
import type { RecoverableError } from "../net/error-view";

export type ErrorViewActions = {
  /** Invoked by the retry action, when the failure has one. */
  onRetry?: () => void;
  onDismiss?: () => void;
};

/** A failure with nothing to say, held only so the getters are always total. */
const NOTHING: RecoverableError = { code: "ROOM_CLOSED", retry: false };

export class ErrorView {
  private error = $state<RecoverableError>(NOTHING);
  private onRetry = $state<(() => void) | undefined>(undefined);
  private onDismiss = $state<(() => void) | undefined>(undefined);
  private app: Record<string, unknown> | undefined;

  constructor(private readonly host: HTMLElement) {}

  /** Renders a failure, replacing any already on screen. */
  show(error: RecoverableError, actions: ErrorViewActions = {}): void {
    this.error = error;
    this.onRetry = actions.onRetry;
    // Dismissing is this class's business rather than the caller's: the panel
    // must come down whether or not the caller has anything else to do.
    this.onDismiss =
      actions.onDismiss === undefined
        ? undefined
        : () => {
            this.hide();
            actions.onDismiss?.();
          };

    if (this.app !== undefined) return;

    // Getters rather than values, so the mounted component tracks this object's
    // state instead of freezing the props it was mounted with.
    const view = this;
    this.app = mount(ErrorPanel, {
      target: this.host,
      props: {
        get error() {
          return view.error;
        },
        get onRetry() {
          return view.onRetry;
        },
        get onDismiss() {
          return view.onDismiss;
        },
      },
    });
  }

  hide(): void {
    if (this.app === undefined) return;
    void unmount(this.app);
    this.app = undefined;
  }

  get isShowing(): boolean {
    return this.app !== undefined;
  }

  text(): string {
    return this.isShowing ? errorCopy(this.error.code, this.error.detail)() : "";
  }
}
