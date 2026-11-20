import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import type { ScreenId } from "../../../../apps/client/src/features/profile/screen-state";
import type { AssetBundleName } from "../../../../apps/client/src/features/render/assets";
import type { ContentPort } from "../../../../apps/client/src/features/net/content";
import { CarryOver } from "../../../../apps/client/src/features/profile/carry-over";
import { ScreenManager } from "../../../../apps/client/src/features/screen/screen-manager";
import type { PresentationEnvelope } from "../../../../apps/client/src/features/screen/presentation/presentation-event-bus";
import type { Screen, ScreenContext } from "../../../../apps/client/src/features/screen/screen";
import type { StagePort } from "../../../../apps/client/src/features/render/stage-port";
// The screens are imported here, once, at the top. A screen's first import runs
// to seconds on a busy runner (its scene, views, catalogues and unlock code);
// done inside a helper it is charged to the calling test's own budget, so the
// first test of a file to build a screen would time out on a loaded machine.
// Static, it is paid while the file loads, which no test timeout covers. The
// price is that this module is heavier to load, so a test must import the fakes
// at the top of its file, never from inside its body.
import { GameEndScreen } from "../../../../apps/client/src/features/results/game-end";
import { GameplayScreen } from "../../../../apps/client/src/features/race/gameplay";
import { LobbyScreen } from "../../../../apps/client/src/features/lobby/lobby";
import { MainMenuScreen } from "../../../../apps/client/src/features/title/main-menu";
import { ReplayScreen } from "../../../../apps/client/src/features/replay/replay";
import { TutorialScreen } from "../../../../apps/client/src/features/tutorial/tutorial";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { snapshotAt } from "../snapshots";
import { ErrorChannel } from "../../../../apps/client/src/features/net/error-view";
import { inputMethod, type InputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import type { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import type { Hosting } from "../../../../apps/client/src/features/ruken/host";
import { trackScreen } from "../open-screens";
import { FakeContainer, FakeTicker, fakeStage, type FakeStage } from "./stage";
import { FakeAssets } from "./assets";
import { FakeAudio } from "./audio";
import { FakeNetwork } from "./network";
import { fakeContentPort } from "./content";
import { recordingPublisher } from "./events";
import { fakeSettings } from "./settings";
import { settleUi } from "./ui";

export function fakeContext(overrides: Partial<ScreenContext> = {}): ScreenContext {
  return {
    stage: fakeStage(),
    assets: new FakeAssets(),
    audio: new FakeAudio(),
    network: new FakeNetwork(),
    content: fakeContentPort(),
    errors: new ErrorChannel(),
    publishPresentationEvent: () => {},
    // A device that has read the photosensitivity warning, so a splash goes straight on.
    settings: fakeSettings({ seen: { photosensitivity: true } }),
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    ...overrides,
  };
}

/** A screen that records its own lifecycle, for ownership assertions. */
class RecordingScreen implements Screen {
  constructor(
    readonly name: ScreenId,
    private readonly log: { entered: ScreenId[]; exited: ScreenId[] },
  ) {}

  async enter(): Promise<void> {
    this.log.entered.push(this.name);
  }

  exit(): void {
    this.log.exited.push(this.name);
  }
}

/**
 * A screen manager wired to recording screens.
 *
 * `destroyedOwners` and `liveOwners` are how a test asks the question that
 * matters: did the previous screen let go of everything before the next one
 * took the stage?
 */
export function screenManagerWithFakes(): {
  transition(next: ScreenId): Promise<void>;
  destroyedOwners(): ScreenId[];
  liveOwners(): ScreenId[];
  manager: ScreenManager;
} {
  const log = { entered: [] as ScreenId[], exited: [] as ScreenId[] };
  const context = fakeContext();

  const manager = new ScreenManager(
    {
      Splash: () => new RecordingScreen("Splash", log),
      MainMenu: () => new RecordingScreen("MainMenu", log),
      Lobby: () => new RecordingScreen("Lobby", log),
      Gameplay: () => new RecordingScreen("Gameplay", log),
      GameEnd: () => new RecordingScreen("GameEnd", log),
      Tutorial: () => new RecordingScreen("Tutorial", log),
      Replay: () => new RecordingScreen("Replay", log),
    },
    context,
    () => {},
  );

  return {
    manager,
    transition: (next) => manager.transition(next),
    destroyedOwners: () => [...log.exited],
    liveOwners: () => log.entered.filter((name) => !log.exited.includes(name)),
  };
}

/**
 * The Lobby mounted on a fake stage and network (the former menu).
 *
 * Drives the screen through its real DOM rather than through its methods, so a
 * test exercises what a player would touch.
 */
export async function lobbyWithFakeNetwork(
  options: {
    errors?: ErrorChannel;
    network?: FakeNetwork;
    content?: ContentPort;
    stage?: StagePort;
    settings?: SettingsStore;
    /** Where the lobby was entered from; a resumed seat comes from Splash. */
    previousScreen?: ScreenId;
    /** `?dev=unlock-all`: every tile open. */
    unlockAll?: boolean;
  } = {},
): Promise<{
  audio: FakeAudio;
  network: FakeNetwork;
  content: ContentPort;
  stage: StagePort;
  settings: SettingsStore;
  overlay: HTMLElement;
  screen: import("../../../../apps/client/src/features/lobby/lobby").LobbyScreen;
  createRoom(name: string): Promise<void>;
  joinRoom(code: string, name: string): Promise<void>;
  receiveSnapshot(snapshot: RoomSnapshot): void;
  /** Every presentation event this screen published, in order. */
  publishedEvents(): PresentationEnvelope[];
  lastPublished(): PresentationEnvelope["name"] | undefined;
  /** The names of every event published, in order. */
  published(): PresentationEnvelope["name"][];
  click(testId: string): void;
  query<T extends Element>(testId: string): T | null;
  queryAll(testId: string): HTMLElement[];
  statusText(): string;
  /** The fake asset port, recording every bundle loaded. */
  assets: FakeAssets;
  /** Lets the screen's async work settle before assertions. */
  settle(): Promise<void>;
}> {
  const network = options.network ?? new FakeNetwork();
  const content = options.content ?? fakeContentPort();
  const stage = options.stage ?? fakeStage();
  const published = recordingPublisher();

  const errors = options.errors ?? new ErrorChannel();
  const settings = options.settings ?? fakeSettings();
  const audio = new FakeAudio();
  const assets = new FakeAssets();
  const screen = new LobbyScreen();
  // Closed after the case if the case does not close it (open-screens.ts).
  trackScreen(screen);
  await screen.enter({
    stage,
    assets,
    audio,
    network,
    content,
    errors,
    publishPresentationEvent: published.publish,
    settings,
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    access: { unlockAll: options.unlockAll ?? false },
    ...(options.previousScreen === undefined ? {} : { previousScreen: options.previousScreen }),
  });

  const query = <T extends Element>(testId: string): T | null =>
    stage.overlay.querySelector<T>(`[data-testid="${testId}"]`);

  const click = (testId: string): void => {
    query<HTMLButtonElement>(testId)?.click();
  };

  /**
   * Types into a field the way a player does.
   *
   * The `input` event matters: a component binds to it, so assigning `.value`
   * alone would change what the field shows without telling the component
   * anything, and the command would go out with an empty name.
   */
  const type = (testId: string, value: string): void => {
    const input = query<HTMLInputElement>(testId);
    if (input === null) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    settleUi();
  };

  /** Lets the screen's async command handlers settle before assertions. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    settleUi();
  };

  return {
    network,
    content,
    stage,
    settings,
    overlay: stage.overlay,
    screen,
    async createRoom(name) {
      type("name-input", name);
      click("create-room");
      await settle();
    },
    async joinRoom(code, name) {
      type("name-input", name);
      type("code-input", code);
      click("join-room");
      await settle();
    },
    audio,
    receiveSnapshot: (snapshot) => network.emitSnapshot(snapshot),
    publishedEvents: () => [...published.events],
    lastPublished: () => published.events.at(-1)?.name,
    published: () => published.events.map((event) => event.name),
    click: (testId) => {
      click(testId);
      settleUi();
    },
    query,
    queryAll: (testId) => [...stage.overlay.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)],
    statusText: () => (query("menu-status")?.textContent ?? "").trim(),
    assets,
    settle,
  };
}

/**
 * The title mounted on a fake stage and network.
 *
 * `displayMode: "standalone"` makes `(display-mode: standalone)` match while
 * the screen enters, as an installed app's window does.
 */
export async function mainMenuWithFakeNetwork(
  options: {
    errors?: ErrorChannel;
    network?: FakeNetwork;
    settings?: SettingsStore;
    displayMode?: "standalone" | "browser";
    previousScreen?: ScreenId;
    content?: ContentPort;
    /** `?dev=unlock-all`: every tile open. */
    unlockAll?: boolean;
    /** Ruken, for a screen that runs hosted (see `tests/client/ruken`). */
    hosting?: Hosting;
    audio?: FakeAudio;
  } = {},
): Promise<{
  network: FakeNetwork;
  settings: SettingsStore;
  overlay: HTMLElement;
  audio: FakeAudio;
  screen: import("../../../../apps/client/src/features/title/main-menu").MainMenuScreen;
  /** The names of every event published, in order. */
  published(): PresentationEnvelope["name"][];
  click(testId: string): void;
  query<T extends Element>(testId: string): T | null;
}> {
  const network = options.network ?? new FakeNetwork();
  const stage = fakeStage();
  const published = recordingPublisher();
  const settings = options.settings ?? fakeSettings();

  const realMatchMedia = window.matchMedia;
  if (options.displayMode === "standalone") {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("display-mode: standalone") || (realMatchMedia?.(query).matches ?? false),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  const screen = new MainMenuScreen();
  const audio = options.audio ?? new FakeAudio();
  try {
    await screen.enter({
      stage,
      assets: new FakeAssets(),
      audio,
      network,
      content: options.content ?? fakeContentPort(),
      errors: options.errors ?? new ErrorChannel(),
      publishPresentationEvent: published.publish,
      settings,
      gamepad: { setRaceTarget: () => {} },
      carryOver: new CarryOver(),
      ...(options.hosting === undefined ? {} : { hosting: options.hosting }),
      access: { unlockAll: options.unlockAll ?? false },
      ...(options.previousScreen === undefined ? {} : { previousScreen: options.previousScreen }),
    });
  } finally {
    window.matchMedia = realMatchMedia;
  }

  const query = <T extends Element>(testId: string): T | null =>
    stage.overlay.querySelector<T>(`[data-testid="${testId}"]`);

  return {
    network,
    settings,
    audio,
    overlay: stage.overlay,
    screen,
    published: () => published.events.map((event) => event.name),
    click: (testId) => {
      query<HTMLButtonElement>(testId)?.click();
      settleUi();
    },
    query,
  };
}

/** A GameEnd screen mounted on a fake stage, with a snapshot already delivered. */
export async function gameEndWithSnapshot(
  snapshot: RoomSnapshot,
  options: {
    settings?: SettingsStore;
    content?: ContentPort;
    network?: FakeNetwork;
    progress?: import("../../../../apps/client/src/features/profile/store/progress.svelte").ProgressStore;
    localPlayerId?: string;
    audio?: FakeAudio;
    /** Ruken, for a screen that runs hosted (see `tests/client/ruken`). */
    hosting?: Hosting;
  } = {},
): Promise<{
  screen: import("../../../../apps/client/src/features/results/game-end").GameEndScreen;
  network: FakeNetwork;
  overlay: HTMLElement;
  /** Every presentation event this screen published, in order. */
  publishedEvents(): PresentationEnvelope[];
  lastPublished(): PresentationEnvelope["name"] | undefined;
  query<T extends Element>(testId: string): T | null;
  queryAll(testId: string): Element[];
}> {
  const network = options.network ?? new FakeNetwork();
  if (options.localPlayerId !== undefined) network.localPlayerId = options.localPlayerId;
  network.emitSnapshot(snapshot);

  const stage = fakeStage();
  const published = recordingPublisher();

  const screen = new GameEndScreen();
  await screen.enter({
    stage,
    assets: new FakeAssets(),
    audio: options.audio ?? new FakeAudio(),
    network,
    content: options.content ?? fakeContentPort(),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    errors: new ErrorChannel(),
    publishPresentationEvent: published.publish,
    settings: options.settings ?? fakeSettings(),
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    ...(options.hosting === undefined ? {} : { hosting: options.hosting }),
  });

  return {
    screen,
    network,
    overlay: stage.overlay,
    publishedEvents: () => [...published.events],
    lastPublished: () => published.events.at(-1)?.name,
    query: <T extends Element>(testId: string) =>
      stage.overlay.querySelector<T>(`[data-testid="${testId}"]`),
    queryAll: (testId: string) => [...stage.overlay.querySelectorAll(`[data-testid="${testId}"]`)],
  };
}

/**
 * A Gameplay screen mounted on a fake stage, ready to be disconnected.
 *
 * `stage` is accepted rather than always built here so a test can dress the
 * stage the way `features/app/app.ts` dresses the real one -- a palette lock on the
 * backdrop, say -- and then assert what the screen leaves behind on exit.
 */
export async function gameplayWithFakeNetwork(
  options: {
    stage?: FakeStage;
    content?: ContentPort;
    /**
     * The snapshot already on hand when the screen enters.
     *
     * Defaulted rather than optional because gameplay is only ever reached by
     * a snapshot-driven transition, so a harness with none would be testing a
     * situation production cannot produce. Pass `null` to test exactly that
     * situation.
     */
    latestSnapshot?: RoomSnapshot | null;
    /** Seated before `enter`, so the entry snapshot reconciles a local player. */
    localPlayerId?: string;
    /**
     * Runs while the screen loads its bundles. A real load takes most of a
     * second, and the room keeps sending snapshots through all of it.
     */
    whileLoading?: (network: FakeNetwork) => void;
    settings?: SettingsStore;
    /** Ruken, for a screen that runs hosted (see `tests/client/ruken`). */
    hosting?: Hosting;
    /** Fails this bundle's first load, to exercise the retry. */
    failOnce?: AssetBundleName;
    /** Presses the error view's Retry as soon as it appears, recording its code. */
    retryAutomatically?: boolean;
    /** The mixer as the select screen left it: the song step may have started the race's song. */
    audio?: FakeAudio;
    /** Where the race's recording is kept; without one, nothing records (unlockables spec §6.1). */
    raceVideo?: import("../../../../apps/client/src/features/net/race-video.svelte").RaceVideo;
  } = {},
): Promise<{
  screen: import("../../../../apps/client/src/features/race/gameplay").GameplayScreen;
  network: FakeNetwork;
  errors: ErrorChannel;
  audio: FakeAudio;
  stage: FakeStage;
  overlay: HTMLElement;
  /** Every presentation event this screen published, in order. */
  publishedEvents(): PresentationEnvelope[];
  lastPublished(): PresentationEnvelope["name"] | undefined;
  /** Clicks a control by test id, as a player does. */
  click(testId: string): void;
  /** Lets the screen's async handlers settle before assertions. */
  settle(): Promise<void>;
  /** The code of the error view `retryAutomatically` answered, if any. */
  errorShown(): string | undefined;
}> {
  const network = new FakeNetwork();
  const errors = new ErrorChannel();
  const stage = options.stage ?? fakeStage();
  const published = recordingPublisher();

  if (options.localPlayerId !== undefined) network.localPlayerId = options.localPlayerId;
  const entry = options.latestSnapshot === undefined ? snapshotAt(0) : options.latestSnapshot;
  if (entry !== null) network.emitSnapshot(entry);

  const audio = options.audio ?? new FakeAudio();
  const screen = new GameplayScreen();
  const assets = new FakeAssets();
  if (options.failOnce !== undefined) assets.failOnce = options.failOnce;
  let shownCode: string | undefined;
  const watcher =
    options.retryAutomatically === true
      ? new MutationObserver(() => {
          const view = stage.overlay.querySelector<HTMLElement>('[data-testid="error-view"]');
          const retry = stage.overlay.querySelector<HTMLButtonElement>('[data-testid="error-retry"]');
          if (view === null || retry === null) return;
          shownCode = view.dataset["code"];
          retry.click();
        })
      : undefined;
  watcher?.observe(stage.overlay, { childList: true, subtree: true });
  const whileLoading = options.whileLoading;
  if (whileLoading !== undefined) {
    assets.whileLoading = (name) => {
      if (name === "gameplay") whileLoading(network);
    };
  }
  await screen.enter({
    stage,
    assets,
    audio,
    network,
    content: options.content ?? fakeContentPort(),
    errors,
    publishPresentationEvent: published.publish,
    settings: options.settings ?? fakeSettings(),
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    ...(options.hosting === undefined ? {} : { hosting: options.hosting }),
    ...(options.raceVideo === undefined ? {} : { raceVideo: options.raceVideo }),
  });
  watcher?.disconnect();

  return {
    screen,
    network,
    errors,
    audio,
    stage,
    overlay: stage.overlay,
    publishedEvents: () => [...published.events],
    lastPublished: () => published.events.at(-1)?.name,
    click: (testId) => {
      stage.overlay.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
      settleUi();
    },
    errorShown: () => shownCode,
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      settleUi();
    },
  };
}

/**
 * The tutorial mounted on a fake stage whose ticker a test drives.
 *
 * Served the shipped content, so its steps and prompts are the authored ones.
 * `frames(n)` ticks the stage as a display would; `key` holds a key for about
 * that long in frames, as a player does.
 */
export async function tutorialWithFakes(
  options: {
    method?: InputMethod;
    previousScreen?: ScreenId;
    settings?: SettingsStore;
    /** Serves an artifact compiled before the tutorial had a stage of its own. */
    withoutTutorialStage?: boolean;
    /** Plays only these of the authored steps, in their authored order: a short tutorial to reach a late step. */
    onlySteps?: readonly string[];
    audio?: FakeAudio;
    /** Ruken, for a screen that runs hosted (see `tests/client/ruken`). */
    hosting?: Hosting;
  } = {},
): Promise<{
  screen: import("../../../../apps/client/src/features/tutorial/tutorial").TutorialScreen;
  settings: SettingsStore;
  audio: FakeAudio;
  ticker: FakeTicker;
  stage: FakeStage;
  /** Display objects on the stage before the screen entered. */
  displayObjectsBefore: number;
  countDisplayObjects(): number;
  /** The names of every event published, in order. */
  published(): PresentationEnvelope["name"][];
  click(testId: string): void;
  query<T extends Element>(testId: string): T | null;
  frames(count: number): void;
  key(code: string, ms: number): void;
  escape(): void;
}> {
  const ticker = new FakeTicker();
  const stage = fakeStage({ ticker });
  const settings = options.settings ?? fakeSettings();
  const published = recordingPublisher();
  inputMethod.note(options.method ?? "keyboard");

  const layers = [stage.scene, stage.field, stage.backdrop, stage.world, stage.ui] as unknown as FakeContainer[];
  const count = (node: { children?: readonly unknown[] }): number =>
    (node.children ?? []).reduce<number>((sum, child) => sum + 1 + count(child as typeof node), 0);
  const countDisplayObjects = (): number => layers.reduce((sum, layer) => sum + count(layer), 0);
  const displayObjectsBefore = countDisplayObjects();

  // The stale artifact the tutorial's fallback exists for: cast through
  // `unknown`, because the current schema would refuse it.
  const content = options.withoutTutorialStage
    ? ({
        ...GENERATED_CONTENT,
        content: {
          ...GENERATED_CONTENT.content,
          tutorial: (({ stage: _stage, song: _song, ...rest }) => rest)(GENERATED_CONTENT.content.tutorial),
        },
      } as unknown as GameContent)
    : GENERATED_CONTENT;
  const only = options.onlySteps;
  const served =
    only === undefined
      ? content
      : ({
          ...content,
          content: {
            ...content.content,
            tutorial: {
              ...content.content.tutorial,
              steps: content.content.tutorial.steps.filter((step) => only.includes(step.kind)),
            },
          },
        } as GameContent);
  const audio = options.audio ?? new FakeAudio();

  const screen = new TutorialScreen();
  await screen.enter({
    stage,
    assets: new FakeAssets(),
    audio,
    network: new FakeNetwork(),
    content: fakeContentPort(served),
    errors: new ErrorChannel(),
    publishPresentationEvent: published.publish,
    settings,
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    ...(options.hosting === undefined ? {} : { hosting: options.hosting }),
    ...(options.previousScreen === undefined ? {} : { previousScreen: options.previousScreen }),
  });
  settleUi();

  const query = <T extends Element>(testId: string): T | null =>
    stage.overlay.querySelector<T>(`[data-testid="${testId}"]`);
  const frames = (count: number): void => {
    for (let index = 0; index < count; index += 1) ticker.tick(16.6667);
    settleUi();
  };

  return {
    screen,
    stage,
    settings,
    audio,
    ticker,
    displayObjectsBefore,
    countDisplayObjects,
    published: () => published.events.map((event) => event.name),
    click: (testId) => {
      query<HTMLButtonElement>(testId)?.click();
      settleUi();
    },
    query,
    frames,
    key: (code, ms) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      frames(Math.round(ms / 16));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },
    escape: () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
      settleUi();
    },
  };
}

/**
 * The Replay screen mounted on fakes (race-options spec §7), playing `bytes`
 * against `content`, with the race's own scene and a ticker to drive it.
 */
export async function replayWithFakes(options: {
  bytes: Uint8Array | undefined;
  content: GameContent;
  network?: FakeNetwork;
  /** One engine across viewings, as the page has. */
  audio?: FakeAudio;
  /** The race's live recording (unlockables spec §6.1). */
  raceVideo?: import("../../../../apps/client/src/features/net/race-video.svelte").RaceVideo;
}): Promise<{
  screen: import("../../../../apps/client/src/features/replay/replay").ReplayScreen;
  network: FakeNetwork;
  audio: FakeAudio;
  ticker: FakeTicker;
  overlay: HTMLElement;
  stage: FakeStage;
  published(): PresentationEnvelope["name"][];
  query<T extends Element>(testId: string): T | null;
  frames(count: number): void;
  key(key: string): void;
}> {
  const ticker = new FakeTicker();
  const stage = fakeStage({ ticker });
  const published = recordingPublisher();
  const network = options.network ?? new FakeNetwork();
  if (options.bytes !== undefined) network.replay = options.bytes;
  const audio = options.audio ?? new FakeAudio();

  const screen = new ReplayScreen();
  await screen.enter({
    stage,
    assets: new FakeAssets(),
    audio,
    network,
    content: fakeContentPort(options.content),
    errors: new ErrorChannel(),
    publishPresentationEvent: published.publish,
    settings: fakeSettings(),
    gamepad: { setRaceTarget: () => {} },
    carryOver: new CarryOver(),
    previousScreen: "GameEnd",
    ...(options.raceVideo === undefined ? {} : { raceVideo: options.raceVideo }),
  });
  settleUi();

  const query = <T extends Element>(testId: string): T | null =>
    stage.overlay.querySelector<T>(`[data-testid="${testId}"]`);
  return {
    screen,
    network,
    audio,
    ticker,
    overlay: stage.overlay,
    stage,
    published: () => published.events.map((event) => event.name),
    query,
    frames: (count) => {
      for (let index = 0; index < count; index += 1) ticker.tick(16.6667);
      settleUi();
    },
    key: (key) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      settleUi();
    },
  };
}
