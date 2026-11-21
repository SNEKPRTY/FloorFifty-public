/**
 * The presentation runtime.
 *
 * Owns the bus, the router, and the flow controller as one unit, and is the
 * only place the six flow actions are bound to their flow events. An action
 * translates its source to a `FlowEvent`; it cannot name a screen, so no
 * producer and no authored route can bypass the graph.
 *
 * Flow and routing are replaced together or not at all. A race that observed
 * half a reload -- a new graph with old routes -- would navigate somewhere
 * neither table describes.
 */

import type { RevisionHash } from "@floor-fifty/shared/content/game-content";
import type {
  FlowEvent,
  PresentationActionId,
  PresentationConfig,
} from "@floor-fifty/shared/content/presentation";
import type {
  PresentationEventBus,
  PresentationPublisher,
} from "./presentation-event-bus";
import {
  PresentationEventRouter,
  type PresentationDispatchFailure,
  type PresentationTrace,
} from "./presentation-event-router";
import { PresentationFlowController } from "./presentation-flow";
import type { ScreenManager } from "../screen-manager";

export type PresentationRuntimeFailure =
  | { readonly kind: "action"; readonly failure: PresentationDispatchFailure }
  | { readonly kind: "flow"; readonly error: unknown };

/**
 * The screens a configuration swap is legal on.
 *
 * Before `start()` there is nothing to disturb; on the title or in the lobby
 * there is no race to strand between two graphs. The lobby refreshes content
 * on a snapshot's revision as the old menu did, so it must be able to adopt
 * it. Every other screen is mid-session.
 */
const REPLACEABLE_ON: ReadonlySet<string> = new Set(["MainMenu", "Lobby"]);

/** Each flow action is exactly one flow event. Nothing else is an action yet. */
const FLOW_EVENT_FOR_ACTION = {
  "flow.splash-complete": "splashComplete",
  "flow.room-racing": "roomRacing",
  "flow.race-finished": "raceFinished",
  "flow.recover-to-menu": "recoverToMenu",
  "flow.race-again": "raceAgain",
  "flow.return-to-menu": "returnToMenu",
  "flow.resume-room": "resumeRoom",
  "flow.play": "play",
  "flow.back": "back",
  "flow.leave-race": "leaveRace",
  "flow.story": "story",
  "flow.story-to-title": "storyToTitle",
  "flow.story-to-lobby": "storyToLobby",
  "flow.watch-replay": "watchReplay",
  "flow.replay-exit": "replayExit",
  "flow.replay-exit-to-room": "replayExitToRoom",
} as const satisfies Record<PresentationActionId, FlowEvent>;

export type PresentationRuntimeOptions = {
  readonly config: PresentationConfig;
  readonly contentRevision: RevisionHash;
  readonly bus: PresentationEventBus;
  readonly screens: ScreenManager;
  readonly onFailure: (failure: PresentationRuntimeFailure) => void;
  readonly trace?: (entry: PresentationTrace) => void;
};

export class PresentationRuntime {
  readonly publish: PresentationPublisher;

  private readonly bus: PresentationEventBus;
  private readonly screens: ScreenManager;
  private readonly router: PresentationEventRouter;
  private readonly flow: PresentationFlowController;
  private config: PresentationConfig;
  private revision: RevisionHash;

  constructor(options: PresentationRuntimeOptions) {
    this.bus = options.bus;
    this.screens = options.screens;
    this.config = options.config;
    this.revision = options.contentRevision;

    this.flow = new PresentationFlowController(options.config.flow, options.screens, (error) =>
      options.onFailure({ kind: "flow", error }),
    );
    this.router = new PresentationEventRouter(
      options.bus,
      options.config.routing,
      options.contentRevision,
      (failure) => options.onFailure({ kind: "action", failure }),
      options.trace,
    );

    for (const [action, event] of Object.entries(FLOW_EVENT_FOR_ACTION)) {
      this.router.register(action as PresentationActionId, () => this.flow.dispatch(event));
    }
    // Registration closes before the first screen starts, so no event can be
    // routed to an action that is only half wired.
    this.router.lock();

    this.publish = (name, payload) => this.bus.publish(name, payload);
  }

  start(): Promise<void> {
    return this.flow.start();
  }

  /** The active configuration, by reference, for reload assertions. */
  currentConfig(): PresentationConfig {
    return this.config;
  }

  currentRevision(): RevisionHash {
    return this.revision;
  }

  /**
   * Swaps flow and routing in one synchronous step.
   *
   * Throws on any screen but the title and the lobby, and throws before changing anything,
   * so a refused swap leaves all three values reference-identical.
   */
  replaceConfig(config: PresentationConfig, contentRevision: RevisionHash): void {
    const current = this.screens.currentName;
    if (current !== undefined && !REPLACEABLE_ON.has(current))
      throw new Error(`presentation config cannot be replaced on ${current}`);

    this.config = config;
    this.revision = contentRevision;
    this.flow.replace(config.flow);
    this.router.replace(config.routing, contentRevision);
  }

  dispose(): void {
    this.router.dispose();
    this.bus.dispose();
  }
}
