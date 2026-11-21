/**
 * Client entry point.
 *
 * Boots the renderer, wires the managers together, and hands control to the
 * screen manager. It holds no gameplay rule and no screen's display objects.
 */

// First: nothing may generate code at runtime under the CSP (`no-eval.ts`).
import "./lib/no-eval";
import { Assets, Cache, path, type AssetsManifest, type ResolvedAsset } from "pixi.js";
import type { AssetBackend } from "./features/render/assets";
import { createStage } from "./features/app/app";
import { AssetManager } from "./features/render/assets";
import { AudioManager } from "./features/audio";
import { audioDebug } from "./features/audio/diagnostics";
import { HttpContentManager } from "./features/net/content";
import { LoadMeter } from "./lib/load-meter";
import { deviceAccess, unlockAllFor, type AccessOptions } from "./features/profile/access";
import { devOwnedPacks } from "./features/profile/entitlements";
import { deviceStorage } from "./features/profile/settings";
import { createHosting } from "./features/ruken/host";
import { installHosting } from "./features/ruken/current";
import { flushAndLeaveOnHostExit, routeLinksThroughHost } from "./features/ruken/exit";
import { reportCharacterPicks } from "./features/ruken/analytics";
import { EntitlementsStore } from "./features/profile/store/entitlements.svelte";
import { ProgressStore } from "./features/profile/store/progress.svelte";
import { RaceVideo, retireVideoWithRace } from "./features/net/race-video.svelte";
import { closeSlotOnCountdown } from "./features/net/unlock-grant";
import { ColyseusNetworkManager } from "./features/net/colyseus-network";
import { PresentationEventBus } from "./features/screen/presentation/presentation-event-bus";
import { PresentationRuntime } from "./features/screen/presentation/presentation-runtime";
import { createFailureRecovery } from "./features/screen/presentation/failure-recovery";
import { ScreenManager } from "./features/screen/screen-manager";
import { ErrorChannel, recoverableError } from "./features/net/error-view";
import { startBootVersionCheck } from "./features/boot/boot-version-check";
import { installGlobalErrorHandlers } from "./features/platform/global-errors";
import { createOpsTelemetry, type OpsTelemetry } from "./features/app/ops-telemetry";
import { wireOpsTelemetry } from "./features/app/ops-telemetry-wiring";
import { CLIENT_BUILD } from "./lib/build-facts";
import { bootDeviceClass } from "./features/platform/device-class";
import { ErrorView } from "./features/screen/error-panel.svelte";
import { afterFirstPaint, dismissBootLoader, reportBootStep, wordBootLoader } from "./features/boot/boot-loader";
import { trackHostReserved, trackViewport } from "./features/platform/viewport-tracking.svelte";
import { interceptBackGesture, sendBack } from "./features/platform/back-gesture";
import { suppressPageGestures } from "./features/platform/suppress-page-gestures";
import { sleepOnHostLifecycle, sleepWhenHidden } from "./features/platform/sleep-when-hidden";
import { GameEndScreen } from "./features/results/game-end";
import { StoryScreen } from "./features/story/story";
import { ReplayScreen } from "./features/replay/replay";
import { GameplayScreen } from "./features/race/gameplay";
import { MainMenuScreen } from "./features/title/main-menu";
import { LobbyScreen } from "./features/lobby/lobby";
import { SplashScreen } from "./features/boot/splash";
import { SettingsStore } from "./features/profile/store/settings.svelte";
import { inputMethod } from "./features/platform/input-method.svelte";
import { FocusNavigator, arrowKeyNav } from "./features/platform/focus-nav";
import { glyphFamily } from "./features/i18n/glyphs";
import { PadTrace, padTraceEnabled } from "./features/app/pad-trace";
import { GamepadSource, type GamepadNav } from "./features/platform/gamepad-source";
import { scheduleInputPoll } from "./features/platform/input-poll";
import { requestRacerHop } from "./features/lobby/racer-hops";
import { mount, unmount } from "svelte";
import NetworkLoader from "./features/net/NetworkLoader.svelte";
import IdleWarning from "./features/lobby/IdleWarning.svelte";
import { IdleWarningStore, wireIdleWarning } from "./features/net/idle-warning.svelte";
import LandscapeGate from "./features/boot/LandscapeGate.svelte";
import { isEmbedded, mountsLandscapeGate } from "./features/platform/embedded-frame";
import { NetworkActivity, trackNetworkActivity } from "./features/net/store/network-activity.svelte";
import { bridgeSettings, followHostGain, installShellHotkeys, muteWhenUnfocused } from "./features/audio/settings-bridge";
import { installUiMotion } from "./features/kit/ui-motion";
import { installUiSounds } from "./features/kit/ui-sounds";
import { reducedMotion } from "./features/kit/motion";
import { screenFade } from "./features/kit/screen-fade";
import { liveReplaySimulations } from "./features/replay/replay-run";
import { countDisplayObjects, installLeakCounters } from "./features/render/inspection";
import { trackLiveHandles } from "./features/render/live-handles";
import { createTransitionVeil, veilCounters } from "./features/render/transition-veil";
import { bindDocumentLocale } from "./features/i18n/document.svelte";
import { installLocaleStrategy } from "./features/i18n/strategy";
import { applyDeferredStylesheets } from "./features/kit/stylesheets";
import { renderBootFailure } from "./features/boot/boot-failure";

/** Set once boot has a sender, so a boot that fails after that point still says so (§7.1). */
let bootTelemetry: OpsTelemetry | undefined;

function resolveServerUrl(): string {
  const configured = import.meta.env["VITE_SERVER_URL"];
  if (!import.meta.env.DEV && configured !== undefined) return configured;

  const serverUrl = new URL(configured ?? `${window.location.protocol}//${window.location.hostname}:3000`);
  if (
    import.meta.env.DEV &&
    (serverUrl.hostname === "127.0.0.1" || serverUrl.hostname === "localhost") &&
    window.location.hostname !== "127.0.0.1" &&
    window.location.hostname !== "localhost"
  ) {
    serverUrl.hostname = window.location.hostname;
  }
  return serverUrl.toString().replace(/\/$/, "");
}

export async function boot(host: HTMLElement): Promise<void> {
  // The one stall rule every load of the page answers to (`load-meter.ts`):
  // a wait fails only when nothing has arrived for 30 s, or on an error. Slow
  // never fails, and nothing here gives up on a clock of its own.
  const loads = new LoadMeter();
  // Ruken lifts its own cover when the game says hello, so hello comes only
  // once the boot loader in `index.html` is on screen: the player is never
  // left with a bare frame between the host's cover and ours.
  await afterFirstPaint();
  // The browser's own storage, at once: the new Ruken serves the game as a
  // plain folder with no SDK, so there is no host to wait for.
  const hosting = createHosting();
  installHosting(hosting);
  reportBootStep("host", 1);
  // Settings before the stage: the LCD panel is built from them.
  const settings = new SettingsStore(hosting.storage);
  // The language before anything draws a word (languages spec §3.4).
  installLocaleStrategy(settings);
  bindDocumentLocale();
  wordBootLoader();
  // The page's stylesheets no longer hold back its first paint (the build
  // defers them, `defer-stylesheets.ts`), so the loader showed at once. No
  // screen is drawn before they are in. After the language, so a stylesheet
  // that fails still gets a failure panel in the player's words.
  await loads.guard((signal) => applyDeferredStylesheets(document, signal));
  const stage = await createStage(host, { lcdPanel: settings.value.display.lcdPanel });
  // Which controls to teach follows the device the player last touched.
  const detachInputMethod = inputMethod.attach(window);

  // The pad's recent events, logged on every fullscreen change (debug only):
  // the Safari fullscreen exit was never reproduced, and this names its path.
  const padTrace = padTraceEnabled() ? new PadTrace() : undefined;
  const detachPadTrace = padTrace?.attach();

  // The controller: race intents while a race holds it, and otherwise focus
  // navigation over the page's own DOM, in Tab's order (spec §3.1.3).
  const focus = new FocusNavigator();
  const detachFocus = focus.attach(window);
  const menuStep = (nav: GamepadNav): void => {
    if (nav === "up" || nav === "down" || nav === "left" || nav === "right") {
      // A grid holding focus may take the direction first, to move within a page or turn it.
      if (focus.steer(nav)) return;
      focus.move(nav === "up" || nav === "left" ? "previous" : "next");
    } else if (nav === "confirm") focus.confirm();
    else focus.back(); // back and start: Escape, which modals and the pause overlay own
  };
  // Out of a race the arrow keys walk the menus as the d-pad does; in a race
  // they steer, which the race's own input handles.
  const onArrowKey = (event: KeyboardEvent): void => {
    if (gamepad.racing) return;
    const nav = arrowKeyNav(event);
    if (nav === undefined) return;
    event.preventDefault();
    menuStep(nav);
  };
  window.addEventListener("keydown", onArrowKey);
  const detachArrowKeys = (): void => window.removeEventListener("keydown", onArrowKey);
  const gamepad = new GamepadSource({
    onActive: (pad) => inputMethod.noteGamepad(glyphFamily(pad.id)),
    onHandover: (to) => padTrace?.record(`handover:${to}`),
    onNav: (nav) => {
      padTrace?.record(nav);
      // Sideways on a slider changes it, as the arrow keys do; elsewhere it walks.
      if ((nav === "left" || nav === "right") && focus.adjust(nav)) return;
      menuStep(nav);
    },
    // The shoulder buttons page a grid that holds focus (LB back, RB on);
    // anywhere else each jumps one of the menu's racers.
    onHop: (slot) => {
      if (slot === 1 && focus.page("previous")) return;
      if (slot === 2 && focus.page("next")) return;
      requestRacerHop(slot);
    },
  });
  const detachGamepad = gamepad.attach(window);
  const releasePoll = scheduleInputPoll(stage.app.ticker, () => {
    gamepad.poll(performance.now());
    // In the menus, a screen change drops focus on the page; put it back on
    // a control so the pad player always sees where they stand.
    if (!gamepad.racing) focus.recover();
  });

  // An explicit adapter rather than handing Pixi's `Assets` straight to the
  // manager: the asset port stays renderer-agnostic, and the one place that
  // knows the manifest's concrete shape is this cast.
  const backend: AssetBackend = {
    // A dropped request is retried before it fails the whole bundle: a phone
    // on Wi-Fi drops the odd one, and a bundle is up to a hundred files.
    init: (options) =>
      Assets.init({
        manifest: options.manifest as AssetsManifest,
        loadOptions: { strategy: "retry", retryCount: 3, retryDelay: 250 },
      }),
    // Pixi reports each bundle's progress as a fraction, which the splash and
    // the race loader draw (§3.1.5).
    loadBundle: (name, onProgress) => Assets.loadBundle(name, onProgress),
    unloadBundle: (name) => Assets.unloadBundle(name),
    // Pixi keeps a file's load in its loader until it settles, and gives the
    // same promise to the next ask. After a stall that is a hung request that
    // never settles, so Try again would be handed it back and stall again.
    // Drop the bundle's files that have not arrived; those that have are in
    // the cache, and stay.
    abandon: (name) => {
      const resolved = Assets.resolver.resolveBundle(name) as Record<string, ResolvedAsset | ResolvedAsset[]>;
      for (const [alias, asset] of Object.entries(resolved)) {
        if (Cache.has(alias)) continue;
        // The loader keys its loads by the file's absolute URL.
        for (const file of [asset].flat()) {
          if (file.src !== undefined) delete Assets.loader.promiseCache[path.toAbsolute(file.src)];
        }
      }
    },
  };

  const assets = new AssetManager(backend, `${import.meta.env.BASE_URL}assets/manifest.json`, { loads });
  const audio = new AudioManager({ loads });
  // A locked phone, a backgrounded tab or an unfocused window goes quiet, and
  // picks up on return.
  sleepWhenHidden(document, audio.mixer);
  // Inside Ruken the host says so too, for a game hidden behind its page.
  sleepOnHostLifecycle(hosting, audio.mixer);
  // Mute, volumes and the panel follow the settings live, for the life of the tab.
  const releaseSettings = bridgeSettings(settings, { audio, stage });
  // Quiet while another window has focus, for a player who asked (settings).
  const releaseUnfocusedMute = muteWhenUnfocused(settings, audio);
  // Inside Ruken, side controls clear the host's tab (P6 §4); 0 standalone.
  const releaseHostReserved = trackHostReserved(hosting, document.documentElement);
  // Inside Ruken, the host's volume, ducking and ads scale the master too.
  const releaseHostGain = followHostGain(hosting, audio);
  // Under `?audiodebug` only: what the mix thinks it is doing, every two
  // seconds, beside what the context is doing (see `diagnostics.ts`).
  audioDebug?.watchMix(() => ({
    masterGain: audio.mixer.masterGain,
    muted: audio.isMuted,
    hostGain: hosting.hostGain(),
    music: audio.playing,
    sources: audio.mixer.liveSources,
    settings: settings.value.audio,
  }));
  // The disclosed `character_selected`, sent to Ruken with consent (silent standalone).
  const releaseCharacterPicks = reportCharacterPicks(settings, hosting);
  // M mutes anywhere but a text field (§3.1.1).
  const releaseHotkeys = installShellHotkeys(settings, window);
  // Every control in the shell sounds, from one listener (see `ui-sounds.ts`).
  const releaseUiSounds = installUiSounds(stage.overlay, audio);
  // Every control presses and, from a mouse, lifts, from one listener (see `ui-motion.ts`).
  const releaseUiMotion = installUiMotion(stage.overlay);
  // Test-only: what a screen left behind, read by the e2e leak checks.
  // Timers and window/document listeners, counted in inspection builds only (§9.3).
  const handles = trackLiveHandles(window);
  const releaseCounters = installLeakCounters(() => ({
    displayObjects: countDisplayObjects(stage.app.stage),
    worldObjects: countDisplayObjects(stage.world),
    audioSources: audio.mixer.liveSources,
    cues: audio.mixer.activeVoices,
    previewSources: audio.mixer.previewSources,
    music: audio.mixer.playingMusic,
    ...veilCounters(),
    replaySimulations: liveReplaySimulations(),
    timers: handles.timers(),
    listeners: handles.listeners(),
  }));
  const errors = new ErrorChannel();
  const serverUrl = resolveServerUrl();
  // Anonymous operational events, fire and forget (release readiness §7.1).
  let contentRevision = "";
  let currentScreen = (): string => "Boot";
  const telemetry = createOpsTelemetry({
    url: `${serverUrl}/telemetry`,
    facts: CLIENT_BUILD,
    revisions: () => ({ contentRevision }),
    deviceClass: bootDeviceClass,
  });
  bootTelemetry = telemetry;
  // An error nothing else caught (release readiness §6.7). It never tears down
  // a race in progress: the explanation waits for the menu, unless something
  // with its own reason is already waiting there.
  installGlobalErrorHandlers(
    window,
    (errorClass, reason) => {
      telemetry.report({
        event: "fatal",
        class: errorClass,
        screen: currentScreen(),
        ...(reason === undefined ? {} : { reason }),
      });
      if (!errors.hasPending) errors.report(recoverableError("SIMULATION_FAILURE", "presentation-failed"));
    },
    // A rejection nobody awaited (a cue that failed to fetch) leaves the game
    // running: it is counted, and the player is told nothing.
    (errorClass) => telemetry.report({ event: "rejection", class: errorClass, screen: currentScreen() }),
  );
  // One network manager outlives every screen, because the room connection has
  // to survive the GameEnd-to-MainMenu `Race Again` path.
  const connection = new ColyseusNetworkManager(serverUrl);
  // Every command a player waits on, counted, so one loader covers them all.
  const activity = new NetworkActivity();
  const network = trackNetworkActivity(connection, activity);
  const releaseTelemetry = wireOpsTelemetry({ telemetry, network, errors });
  // Inside Ruken: the host's close flushes saves and frees the seat, and the
  // studio's links open through the host (P6 §4). Standalone, neither installs.
  const releaseHostExit = flushAndLeaveOnHostExit(hosting, network);
  const releaseLinks = routeLinksThroughHost(document, hosting);
  const loader = mount(NetworkLoader, { target: document.body, props: { activity } });
  // A room nobody is using is closed after ten minutes, with a warning a minute
  // before, and Keep room open (audit B1).
  const idleWarning = new IdleWarningStore();
  const releaseIdleWarning = wireIdleWarning(connection, idleWarning);
  const idleBanner = mount(IdleWarning, { target: document.body, props: { network: connection, store: idleWarning } });
  // A phone held sideways plays fullscreen (`landscape-gate.ts`). Not under
  // automation: the landscape e2e project drives an emulated phone that is
  // never fullscreen, and the gate's own spec turns `webdriver` off to see it.
  // Nor inside Ruken: the host owns the page and its fullscreen (P6 §4), and a
  // gate waiting on a fullscreen the host cannot give would never lift. Ruken
  // answers no handshake, so `hosting.hosted` is never true there: the frame
  // itself is how the game knows (audit S9).
  const landscapeGate = mountsLandscapeGate({
    webdriver: navigator.webdriver,
    hosted: hosting.hosted,
    embedded: isEmbedded(window),
  })
    ? mount(LandscapeGate, { target: document.body })
    : undefined;
  // Public content comes from the same origin as the room socket, over plain
  // HTTP: it is cacheable, and it is needed before any room exists.
  const content = new HttpContentManager(serverUrl, undefined, { loads });

  // Content before screens. The flow graph is authored, so until `/content`
  // has answered and decoded there is no screen graph to construct. Beside it,
  // this bundle is compared with the server's, so a stale tab shows Reload on
  // the menu rather than after its player presses Create (release readiness
  // §4.2). The comparison is started, never awaited: it cannot delay the boot.
  startBootVersionCheck(
    async () => (await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(10_000) })).json(),
    CLIENT_BUILD,
    (stale) => errors.report(stale),
  );
  // The manifest is read beside it, so the two waits overlap on a slow link;
  // either failing (or going 30 s without a byte) is the boot failure, with
  // Try again, rather than a splash that waits for ever.
  const [first] = await Promise.all([
    content.refresh((fraction) => reportBootStep("content", fraction)),
    assets.prepare((fraction) => reportBootStep("manifest", fraction)),
  ]);
  contentRevision = first.contentRevision;

  // What this device may pick rides in every join and, seated in a lobby, in a
  // report: what it earned by play, the packs it owns, and `?dev=unlock-all`
  // (unlockables spec §5, §8). The dev flags are honoured only in a dev build.
  const dev = import.meta.env.DEV;
  // What play earned is the game's save, so inside Ruken it is kept in Ruken's saves.
  const progress = new ProgressStore(hosting.storage, () => content.current()?.content);
  const entitlements = new EntitlementsStore(deviceStorage(), () => content.current()?.content);
  for (const packId of devOwnedPacks(window.location.search, dev)) entitlements.grant(packId);
  const access: AccessOptions = { unlockAll: unlockAllFor(window.location.search, dev), progress, entitlements };
  // A grant or a purchase changes the report; the network resends it only
  // in the ready room and only when the sets changed.
  const reportAccess = (): void => {
    const current = content.current()?.content;
    if (current !== undefined) network.setAccess(deviceAccess(current, access));
  };
  network.setAccess(deviceAccess(first.content, access));
  progress.subscribe(reportAccess);
  entitlements.subscribe(reportAccess);
  // The round's grant slot closes when the next race's countdown begins (§5.2).
  closeSlotOnCountdown(network, progress);
  // The last race's video (unlockables spec §6.1), retired with the race.
  const raceVideo = new RaceVideo();
  retireVideoWithRace(network, raceVideo);
  // The remembered colour rides in every join, so a seat appears in it.
  network.setColourSource(() => settings.value.profile.lastColour);
  network.setDeviceClass(bootDeviceClass());

  const bus = new PresentationEventBus();
  const screens = new ScreenManager(
    {
      Splash: () => new SplashScreen(),
      MainMenu: () => new MainMenuScreen(),
      Lobby: () => new LobbyScreen(),
      Gameplay: () => new GameplayScreen(),
      GameEnd: () => new GameEndScreen(),
      Story: () => new StoryScreen(),
      Replay: () => new ReplayScreen(),
    },
    { stage, assets, audio, network, content, errors, settings, gamepad, access, progress, raceVideo, hosting, loads },
    (name, payload) => bus.publish(name, payload),
    // The liquid wipe between the race's screens (race-flow spec §7), made on
    // the first liquid edge. Focus navigation rests while it covers.
    () =>
      createTransitionVeil({
        host: document.body,
        reducedMotion,
        onCoveringChange: (covering) => focus.setPaused(covering),
      }),
    // The 200 ms cross-fade of the menu's edges: the overlay fades out, the
    // next screen mounts, the overlay fades back in.
    screenFade(stage.overlay),
  );
  currentScreen = () => screens.currentName ?? "Boot";
  // Ruken's "Open game menu" goes to whatever screen is showing (P6 §4).
  hosting.setMenuHandler(() => screens.openMenu());

  // A back swipe is the game's Back (`back-gesture.ts`). It leaves the site
  // only from the title, and only when no dialog there took it; anywhere else
  // an unhandled Back is swallowed -- in a room the way out is Leave room.
  const releaseBackGesture = interceptBackGesture(window, () => {
    const atRoot = screens.currentName === "MainMenu" || screens.currentName === "Splash";
    return sendBack(document) || !atRoot;
  });

  const runtime = new PresentationRuntime({
    config: first.content.presentation,
    contentRevision: first.contentRevision,
    bus,
    screens,
    // After the report, a screen that failed to open is replaced by the menu
    // (`failure-recovery.ts`); `screens` is the manager built above.
    onFailure: createFailureRecovery({
      screens,
      report: () =>
        errors.report(
          // One sentence for either kind: an action's name is ours, not the player's.
          recoverableError("ROOM_CLOSED", "presentation-failed"),
        ),
    }),
    // Payload-free by construction, so a development console never shows a
    // player's name or a room code. Production passes no callback at all.
    ...(import.meta.env.DEV
      ? { trace: (entry: { readonly action: string }) => console.debug(entry) }
      : {}),
  });

  // A menu refresh is the only moment a swap is legal, and the menu is also
  // the only screen that refreshes. A notification that arrives elsewhere is
  // not an error: the next menu entry refreshes again and adopts it then.
  const releaseContent = content.subscribe((next) => {
    contentRevision = next.contentRevision;
    network.setAccess(deviceAccess(next.content, access));
    try {
      runtime.replaceConfig(next.content.presentation, next.contentRevision);
    } catch {
      // Mid-session. The active pair stays exactly as it is.
    }
  });

  window.addEventListener("pagehide", () => {
    releaseTelemetry();
    releaseContent();
    releaseBackGesture();
    releaseSettings();
    releaseUnfocusedMute();
    releaseHostGain();
    releaseHostReserved();
    releaseCharacterPicks();
    releaseHostExit();
    releaseLinks();
    releaseHotkeys();
    releaseUiSounds();
    releaseUiMotion();
    releaseCounters();
    detachInputMethod();
    detachGamepad();
    detachFocus();
    detachArrowKeys();
    detachPadTrace?.();
    releasePoll();
    runtime.dispose();
    screens.dispose();
    void unmount(loader);
    releaseIdleWarning();
    void unmount(idleBanner);
    if (landscapeGate !== undefined) void unmount(landscapeGate);
    network.dispose();
    stage.destroy();
  });

  // An asset failure at boot must not leave a blank canvas: it is reported with
  // a retry, because a failed fetch really can succeed on a second attempt.
  // The splash throws for any failure to load what it shows -- a font, its art,
  // the menu bundle, the menu song, or 30 s of silence (`load-meter.ts`) -- so
  // this is the one place those become "couldn't load" with Try again.
  const start = async (): Promise<void> => {
    try {
      await runtime.start();
      telemetry.report({ event: "boot", stage: "ready", ok: true });
    } catch {
      telemetry.report({ event: "boot", stage: "assets", ok: false });
      dismissBootLoader();
      const view = new ErrorView(stage.overlay);
      view.show(
        // The error's own message names a bundle; the player needs only the outcome.
        recoverableError("ASSET_LOAD_FAILED", "game-assets"),
        {
          // A reload, not another go in place: a font that failed or hung
          // stays failed or hung in the browser until the page is new, and a
          // reload shows the boot loader from its first paint. Nothing is
          // lost this early, and what had arrived is in the HTTP cache.
          onRetry: () => window.location.reload(),
        },
      );
    }
  };

  // Nothing beyond the boot loader shows before Ruken says so (R-04): the
  // host may be showing its own pre-roll. Content, the stage and the screen
  // graph were built meanwhile. Standalone this has already resolved.
  //
  // A host that never says so is a failure to load like any other: after 30 s
  // of silence the boot failure shows, with Try again. A content failure above
  // shows the same panel before Ruken's ready, which is deliberate -- the
  // loader is the only thing on screen then, and it must give way to a clear
  // "couldn't load" rather than spin for ever behind the host's pre-roll.
  await loads.guard(() => hosting.ready);
  await start();
}

// Before the first mount, so the first paint already has its form factor.
trackViewport(window, document.documentElement);
// No right-click or long-press menu and no image drags over the game.
suppressPageGestures(document);

const host = document.querySelector<HTMLElement>("#app");
if (host !== null) {
  boot(host).catch((error: unknown) => {
    bootTelemetry?.report({ event: "boot", stage: "boot", ok: false });
    renderBootFailure(host, error);
  });
}
