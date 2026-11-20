/**
 * The flow controller.
 *
 * It answers one question: given the screen that is current and a flow event
 * that just happened, which screen comes next. The answer comes from the
 * authored graph and from nowhere else -- no screen names its successor, and
 * no producer names a destination.
 *
 * A flow event with no matching transition is a failure rather than a silent
 * no-op. The compiler proves the shipped graph complete, so reaching this case
 * means a producer published something the current screen has no answer for,
 * and the player would otherwise be left looking at a screen that has stopped
 * responding to the room.
 */

import type {
  FlowEvent,
  PresentationFlow,
  ScreenId,
} from "@floor-fifty/shared/content/presentation";
import type { ScreenManager } from "../screen-manager";

export class PresentationFlowController {
  constructor(
    private flow: PresentationFlow,
    private readonly screens: ScreenManager,
    private readonly onFailure: (error: unknown) => void,
  ) {}

  /** Enters the authored entry screen. */
  start(): Promise<void> {
    return this.screens.transition(this.flow.entry);
  }

  /**
   * Resolves one flow event against the current screen.
   *
   * The resulting screen change is queued through the screen manager's own
   * serialization, so two events arriving during a slow asset load are applied
   * in the order they happened rather than racing each other.
   */
  dispatch(event: FlowEvent): void {
    const from: ScreenId | undefined = this.screens.currentName;
    if (from === undefined) {
      this.onFailure(new Error(`no screen is current for flow event ${event}`));
      return;
    }

    const matches = this.flow.transitions.filter(
      (transition) => transition.from === from && transition.event === event,
    );
    const target = matches[0];
    if (target === undefined || matches.length > 1) {
      this.onFailure(new Error(`no single ${from} transition for flow event ${event}`));
      return;
    }

    void this.screens.transition(target.to, target.transition ?? "cut").catch((error: unknown) => this.onFailure(error));
  }

  /** Swaps the graph. Legality is the runtime's decision, not this one's. */
  replace(flow: PresentationFlow): void {
    this.flow = flow;
  }
}
