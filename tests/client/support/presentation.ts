/**
 * Presentation test support.
 *
 * Two levels of harness. `routedHarness` wires a bus and a router with no
 * screens at all, for the router's own mechanics; `presentationHarness` wires
 * the whole runtime against recording screens, for the behaviour a player
 * would notice.
 */

import type { GameContent, RevisionHash } from "@floor-fifty/shared/content/game-content";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import type {
  PresentationConfig,
  PresentationRouting,
} from "@floor-fifty/shared/content/presentation";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { ScreenId } from "../../../apps/client/src/features/profile/screen-state";
import type { ContentPort } from "../../../apps/client/src/features/net/content";
import {
  PresentationEventBus,
  type PresentationEnvelope,
} from "../../../apps/client/src/features/screen/presentation/presentation-event-bus";
import {
  PresentationEventRouter,
  type PresentationDispatchFailure,
  type PresentationTrace,
} from "../../../apps/client/src/features/screen/presentation/presentation-event-router";
import {
  PresentationRuntime,
  type PresentationRuntimeFailure,
} from "../../../apps/client/src/features/screen/presentation/presentation-runtime";
import { ScreenManager } from "../../../apps/client/src/features/screen/screen-manager";
import { GameEndScreen } from "../../../apps/client/src/features/results/game-end";
import { GameplayScreen } from "../../../apps/client/src/features/race/gameplay";
import { MainMenuScreen } from "../../../apps/client/src/features/title/main-menu";
import { LobbyScreen } from "../../../apps/client/src/features/lobby/lobby";
import { SplashScreen } from "../../../apps/client/src/features/boot/splash";
import type { Screen } from "../../../apps/client/src/features/screen/screen";
import { FakeNetwork } from "./fakes/network";
import { fakeContext } from "./fakes/screens";
import { proceedAtOnce, skipStudio } from "./fakes/ui";
import { snapshotAt } from "./snapshots";

export const HARNESS_REVISION: RevisionHash = asRevision("e".repeat(64));

/**
 * Two routes for one source, at different orders.
 *
 * Deliberately a pairing the capability registry forbids: the router's
 * ordering and failure isolation are worth unit-testing on their own, and
 * `tests/content/validate/event-routing.test.ts` proves such routing can never reach a
 * decoded artifact.
 */
export const twoOrderedRoutes = (): PresentationRouting => ({
  routes: [
    { source: "room.finished", order: 20, action: "flow.return-to-menu" },
    { source: "room.finished", order: 10, action: "flow.race-finished" },
  ],
});

export function routedHarness(routing: PresentationRouting): {
  bus: PresentationEventBus;
  router: PresentationEventRouter;
  failures: PresentationDispatchFailure[];
  traces: PresentationTrace[];
} {
  const bus = new PresentationEventBus();
  const failures: PresentationDispatchFailure[] = [];
  const traces: PresentationTrace[] = [];
  const router = new PresentationEventRouter(
    bus,
    routing,
    HARNESS_REVISION,
    (failure) => failures.push(failure),
    (entry) => traces.push(entry),
  );
  return { bus, router, failures, traces };
}

export type PresentationHarness = {
  runtime: PresentationRuntime;
  screens: ScreenManager;
  network: FakeNetwork;
  /** Every screen entered, in order. */
  screenHistory: ScreenId[];
  publishedNames: PresentationEnvelope["name"][];
  failures: PresentationRuntimeFailure[];
  emitSnapshot(snapshot: RoomSnapshot): void;
  settleTransitions(): Promise<void>;
  dispose(): void;
};

/**
 * The whole runtime, against the real screens.
 *
 * Real screens on purpose: the producers under test are the screens
 * themselves, and a recording stand-in would publish nothing. `currentScreen`
 * is reached by transitioning straight to it, because what most of these
 * tests are about is what happens once a particular screen is showing.
 */
export async function presentationHarness(options: {
  config: PresentationConfig;
  contentRevision?: RevisionHash;
  currentScreen?: ScreenId;
  content?: ContentPort;
  network?: FakeNetwork;
  /**
   * Leaves the entry screen mid-`enter`, by never resolving its bundle.
   *
   * The only way to observe splash as the current screen: it publishes the
   * moment its assets arrive, so any harness that lets them arrive has
   * already moved on to the menu.
   */
  holdEntry?: boolean;
}): Promise<PresentationHarness> {
  const screenHistory: ScreenId[] = [];
  const publishedNames: PresentationEnvelope["name"][] = [];
  const failures: PresentationRuntimeFailure[] = [];
  const network = options.network ?? new FakeNetwork();

  const bus = new PresentationEventBus();
  bus.subscribe((event) => publishedNames.push(event.name));

  // The publisher is supplied by the manager, so it is dropped from the
  // context the manager is constructed with.
  const { publishPresentationEvent: _publishPresentationEvent, ...context } = fakeContext({
    network,
    ...(options.content === undefined ? {} : { content: options.content }),
    ...(options.holdEntry === true
      ? { assets: { loadBundle: () => new Promise<void>(() => {}), isLoaded: () => false } }
      : {}),
  });

  /** Records a screen the moment the manager decides to build it. */
  const track = <T extends Screen>(screen: T): T => {
    screenHistory.push(screen.name);
    return screen;
  };

  const screens = new ScreenManager(
    {
      // No minimum on screen: these tests are about the flow, not the timing.
      Splash: () => track(new SplashScreen(proceedAtOnce, skipStudio)),
      MainMenu: () => track(new MainMenuScreen()),
      Lobby: () => track(new LobbyScreen()),
      Gameplay: () => track(new GameplayScreen()),
      GameEnd: () => track(new GameEndScreen()),
      // Recorded, never loaded: the flow tests ask where the tutorial goes,
      // not what it draws (tests/client/features/tutorial/tutorial.test.ts does that).
      // As the tutorial: where the replay goes, not what it draws
      // (tests/client/features/replay/replay.test.ts does that).
      Replay: () => track({ name: "Replay", enter: async () => {}, exit: () => {} }),
    },
    context,
    (name, payload) => bus.publish(name, payload),
  );

  const runtime = new PresentationRuntime({
    config: options.config,
    contentRevision: options.contentRevision ?? HARNESS_REVISION,
    bus,
    screens,
    onFailure: (failure) => failures.push(failure),
  });

  if (options.currentScreen !== undefined) {
    // The manager makes a screen current before awaiting its `enter`, so a
    // held entry is already current even though its transition never
    // resolves. Otherwise wait for the screen to be fully mounted.
    const arrival = screens.transition(options.currentScreen);
    if (options.holdEntry === true) void arrival.catch(() => undefined);
    else await arrival;
    screenHistory.length = 0;
    screenHistory.push(options.currentScreen);
  }

  return {
    runtime,
    screens,
    network,
    screenHistory,
    publishedNames,
    failures,
    emitSnapshot: (snapshot) => network.emitSnapshot(snapshot),
    settleTransitions: () => screens.settled(),
    dispose: () => {
      runtime.dispose();
      screens.dispose();
    },
  };
}

/**
 * Content reload, as boot wires it.
 *
 * Boot subscribes to the content port and hands each successful refresh to
 * `replaceConfig`, swallowing the refusal that arrives mid-session. This
 * harness reproduces that wiring exactly, because the rule being tested is
 * about when the swap is allowed to happen, not about how HTTP works.
 *
 * The port serves already-decoded objects rather than decoding a response, so
 * a test can assert reference identity on the configuration that ended up
 * live. An invalid server build is modelled as a refresh that rejects, which
 * is what the real manager does with a response it cannot decode.
 */
export async function hotReloadHarness(options: {
  currentScreen: ScreenId;
  content: GameContent;
}): Promise<{
  runtimeConfig(): PresentationConfig;
  runtimeRevision(): RevisionHash;
  contentCache(): GameContent | undefined;
  serverBuilds(next: GameContent): Promise<void>;
  invalidServerBuild(): Promise<void>;
  finishIntoMenu(): Promise<void>;
  dispose(): void;
}> {
  let served: GameContent = options.content;
  let cached: GameContent | undefined = options.content;
  let serverIsBroken = false;
  const listeners = new Set<(next: GameContent) => void>();

  const port: ContentPort = {
    current: () => cached,
    async refresh() {
      if (serverIsBroken) throw new Error("the server answered with unreadable content");
      cached = served;
      for (const listener of [...listeners]) listener(served);
      return served;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const network = new FakeNetwork();
  const app = await presentationHarness({
    config: options.content.content.presentation,
    contentRevision: options.content.contentRevision,
    // A race is reached the way a player reaches one: from the lobby.
    currentScreen: options.currentScreen === "Gameplay" ? "Lobby" : options.currentScreen,
    content: port,
    network,
  });

  const release = port.subscribe((next) => {
    try {
      app.runtime.replaceConfig(next.content.presentation, next.contentRevision);
    } catch {
      // Mid-session. The active pair stays exactly as it is.
    }
  });

  /** Lets the menu's own asynchronous refresh land before an assertion. */
  const settle = async (): Promise<void> => {
    await app.settleTransitions();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.settleTransitions();
  };

  if (options.currentScreen === "Gameplay") {
    network.emitSnapshot(snapshotAt(10, { phase: "racing" }));
    await settle();
  }

  let tick = 20;

  return {
    runtimeConfig: () => app.runtime.currentConfig(),
    runtimeRevision: () => app.runtime.currentRevision(),
    contentCache: () => cached,
    async serverBuilds(next) {
      served = next;
      serverIsBroken = false;
      // The server announces; only a client on the menu acts on it.
      network.emitContentRevision(next.contentRevision);
      await settle();
    },
    async invalidServerBuild() {
      serverIsBroken = true;
      network.emitContentRevision("f".repeat(64));
      await settle();
    },
    async finishIntoMenu() {
      network.emitSnapshot(snapshotAt((tick += 10), { phase: "finished" }));
      await settle();
      app.runtime.publish("ui.return-to-menu-settled", {});
      await settle();
    },
    dispose() {
      release();
      app.dispose();
    },
  };
}
