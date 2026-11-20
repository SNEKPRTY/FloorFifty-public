/**
 * The presentation event router.
 *
 * Authored routing decides which code-registered actions a published event
 * reaches, and in what order. It cannot decide what an action does: handlers
 * are registered here, by name, before the first screen starts, and the
 * registry is then locked.
 *
 * Handlers receive no publisher. An action cannot publish, so authored routing
 * cannot be made to form a cycle or an event storm; an asynchronous result is
 * published later by its own code-owned producer or not at all.
 *
 * Diagnostics record the source, the action, its order, and the content
 * revision -- never the payload. A payload can carry a player's name or a room
 * code, and a route is just as traceable without them.
 */

import type { RevisionHash } from "@floor-fifty/shared/content/game-content";
import type {
  PresentationActionId,
  PresentationRoute,
  PresentationRouting,
} from "@floor-fifty/shared/content/presentation";
import type { PresentationEnvelope, PresentationEventBus } from "./presentation-event-bus";

export type PresentationActionHandler = (event: PresentationEnvelope) => void;

export type PresentationDispatchFailure = {
  readonly source: PresentationEnvelope["name"];
  readonly action: PresentationActionId;
  readonly order: number;
  readonly contentRevision: RevisionHash;
  readonly error: unknown;
};

export type PresentationTrace = Omit<PresentationDispatchFailure, "error"> & {
  readonly outcome: "ok" | "error";
};

const byOrder = (a: PresentationRoute, b: PresentationRoute): number => a.order - b.order;

export class PresentationEventRouter {
  private readonly handlers = new Map<PresentationActionId, PresentationActionHandler>();
  private readonly unsubscribe: () => void;
  private locked = false;

  constructor(
    bus: PresentationEventBus,
    private routing: PresentationRouting,
    private contentRevision: RevisionHash,
    private readonly onFailure: (failure: PresentationDispatchFailure) => void,
    private readonly trace?: (entry: PresentationTrace) => void,
  ) {
    this.unsubscribe = bus.subscribe((event) => this.dispatch(event));
  }

  /**
   * Binds one action name to its implementation.
   *
   * The returned disposer and this method both refuse once the registry is
   * locked: a handler appearing or vanishing mid-session would make a route's
   * behaviour depend on when the event happened to arrive.
   */
  register(action: PresentationActionId, handler: PresentationActionHandler): () => void {
    this.assertUnlocked();
    this.handlers.set(action, handler);
    return () => {
      this.assertUnlocked();
      this.handlers.delete(action);
    };
  }

  /** Closes registration, refusing routing that names an unimplemented action. */
  lock(): void {
    const missing = [
      ...new Set(this.routing.routes.map((route) => route.action)),
    ].filter((action) => !this.handlers.has(action));

    if (missing.length > 0)
      throw new Error(`no handler registered for presentation action: ${missing.join(", ")}`);

    this.locked = true;
  }

  /**
   * Swaps the routing table.
   *
   * Takes already-decoded routing, and leaves the handler registry locked:
   * reloading content changes which actions run, never what they are.
   */
  replace(routing: PresentationRouting, contentRevision: RevisionHash): void {
    this.routing = routing;
    this.contentRevision = contentRevision;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private assertUnlocked(): void {
    if (this.locked) throw new Error("presentation actions are locked");
  }

  /**
   * Runs every route for one event, in ascending explicit order.
   *
   * A throwing action is reported and the ones behind it still run. A required
   * flow action that fails enters the client's recovery path through
   * `onFailure`; it never falls back to an authored alternative, because there
   * is no such thing.
   */
  private dispatch(event: PresentationEnvelope): void {
    const routes = this.routing.routes
      .filter((route) => route.source === event.name)
      .sort(byOrder);

    for (const route of routes) {
      const handler = this.handlers.get(route.action);
      const entry = {
        source: event.name,
        action: route.action,
        order: route.order,
        contentRevision: this.contentRevision,
      };

      if (handler === undefined) {
        this.onFailure({ ...entry, error: new Error(`no handler for ${route.action}`) });
        this.trace?.({ ...entry, outcome: "error" });
        continue;
      }

      try {
        handler(event);
        this.trace?.({ ...entry, outcome: "ok" });
      } catch (error) {
        this.onFailure({ ...entry, error });
        this.trace?.({ ...entry, outcome: "error" });
      }
    }
  }
}
