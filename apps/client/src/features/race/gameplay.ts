/**
 * Gameplay.
 *
 * Owns the rendering containers, the input-to-network bridge, and remote
 * interpolation. It owns no rule: every position it draws arrived in a
 * snapshot, and every key it reads leaves as an `InputFrame`.
 *
 * Local input is applied to the local sprite immediately so controls feel
 * attached to the player, and the next snapshot reconciles it. That is the
 * whole of client prediction here: a picture, never an authority claim.
 * `LocalSimulation` owns it and steps the shared simulation to produce it;
 * laps, standings and the winner all still arrive from the room.
 */

import { bootDeviceClass } from "../platform/device-class";
import * as m from "../../paraglide/messages.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomPhase, RoomSnapshot, ServerErrorCode } from "@floor-fifty/shared/common/protocol";
import { orderedResults } from "./results";
import { scoreToSubmit } from "./scores";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { courseBounds } from "@floor-fifty/shared/level/course";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import {
  FAST_FALL_CUE,
  FastFallWhoosh,
  bedForStage,
  countdownCues,
  cuesForEvents,
  ladderHeight,
  landingSounds,
  panFor,
  type Sound,
} from "./race-cues";
import { DroneHold } from "./drone-hold";
import { SpeculativeContacts } from "../net/speculative-contact";
import type { ScreenId } from "../profile/screen-state";
import { InputManager } from "../platform/input";
import type { StagePresentation } from "../render/stage-presentation";
import { raceSong } from "../audio";
import { RaceScene, loadRaceAssets, mountTouchInput } from "./race-scene";
import { CountdownClock } from "./countdown-clock";
import { RaceRecorder } from "../render/race-recorder";
import { RaceAnnouncer } from "./race-announcer";
import { isEndless } from "@floor-fifty/shared/simulation/endless";
import { awaitingStart } from "./hud-model";
import { currentHint, hintsSpent, raceHints, type RaceHintKind } from "./race-hints";
import { FinishSequence, STALL_FALLBACK_MS } from "./finish-sequence";
import { reducedMotion } from "../kit/motion";
import { installInputInspection, installVisualInspection, VISUAL_INSPECTION_ENABLED } from "../render/inspection";
import type { PredictedState } from "../net/local-simulation";
import { RaceNetcode } from "../net/race-netcode";
import { NetDiagnostics } from "../net/net-diagnostics";
import { NetStatsOverlay, installNetReader, netStatsRequested } from "../net/net-stats-overlay";
import { prefersTouchControls } from "./touch-controls";
import { mount, unmount } from "svelte";
import PauseOverlay from "./PauseOverlay.svelte";
import { CursorRunner } from "../platform/cursor-policy";
import { inputMethod, type InputMethod } from "../platform/input-method.svelte";
import { ConnectionStateView } from "../net/connection-state.svelte";
import { recoverableError, type ErrorDetail, type RecoverableErrorCode } from "../net/error-view";
import { addRenderPass } from "../platform/render-order";
import { BaseScreen, type ScreenContext } from "../screen/screen";

/**
 * Failures a race cannot continue through.
 *
 * Everything else -- a dropped input, a rate limit, a transient disconnect --
 * is handled in place, with the canvas left exactly as it was.
 */
/** How long a local landing waits for the drawn racer to turn on it: four frames, about 67 ms (Wonder spec §3.2). */
const LANDING_WAIT_FRAMES = 4;

const FATAL_CODES: readonly string[] = [
  "VERSION_MISMATCH",
  "ROOM_CLOSED",
  "INVALID_ROOM",
  "SIMULATION_FAILURE",
];

export class GameplayScreen extends BaseScreen {
  readonly name: ScreenId = "Gameplay";

  /**
   * The room phase this screen was entered for.
   *
   * Seeded from the entry snapshot rather than left undefined, because the
   * edge that sent us here has already been published by the menu. Only a
   * later phase is news to this screen.
   */
  private lastPhase: RoomPhase | undefined;

  /**
   * Local contacts this client has answered before the server did.
   *
   * The slice's central question lives here: a landing is resolved by the
   * server and the answer arrives a round trip later, so between seeing the
   * touch and hearing it confirmed there is nothing, and nothing is what makes
   * a visibly correct landing feel dead.
   */
  private readonly contacts = new SpeculativeContacts();
  /**
   * The local racer's landing sound, held until the drawn racer turns on it:
   * the landing is drained a tick before the picture reaches it, and a slam
   * the turn turns out to be replaces it (Wonder spec §3.2). Never held past
   * `LANDING_WAIT_FRAMES`.
   */
  private pendingLanding: { sounds: Sound[]; framesLeft: number } | undefined;
  /** The count over the stage, from the room's end tick (race-flow spec §3.4). */
  private count = new CountdownClock();
  /** What the HUD's polite region says (race-flow spec §6); it knows whose racer is hers. */
  private announcer = new RaceAnnouncer(() => this.localPlayerId());
  /**
   * The start pulse was sent this race. One is enough, and the room's
   * snapshot says she is waiting until it has answered, so without this every
   * further key would send another.
   */
  private startPulseSent = false;
  /** This race's one-time hints, decided once at entry (`features/race/race-hints.ts`). */
  private hintQueue: readonly RaceHintKind[] = [];
  /** Render-clock time when the first snapshot showed her no longer waiting for a first input. */
  private firstInputAtMs: number | undefined;
  /** The device's hint flags were set for this race: once is enough. */
  private hintsSpentFlagged = false;
  /** Wall time drawn so far: the finish is measured on it, never on slowed time. */
  private wallMs = 0;
  /** Whether a racing frame was drawn: only a race watched plays its finish. */
  private drewRacing = false;
  /** The victory sequence, once the finish arrives (race-flow spec §5.2). */
  private finish: FinishSequence | undefined;
  /** Who won, for the `room.finished` the sequence publishes when it ends. */
  private finishWinner: PlayerId | undefined;
  /** Results asked for once, by the sequence or by its stall timer. */
  private finishPublished = false;
  /**
   * This race as a Ruken round (M1 contracts §6): "open" from the start
   * until the finish or until the player leaves it. Ruken counts what it is
   * told, so a race is started once and ended once, whatever arrives twice.
   */
  private round: "none" | "open" | "over" = "none";
  /** This race's score went to Ruken: a run posts once, however it ends. */
  private scoreSent = false;
  /** The newest room snapshot, kept for a leave: leaving clears the network's own. */
  private lastRoom: RoomSnapshot | undefined;
  /** The player chose Leave, or the room failed; nothing after that sends them to Results. */
  private leaving = false;
  /** The live race's recording, until the finish keeps it or a leave drops it (unlockables spec §6.1). */
  private recorder: RaceRecorder | undefined;
  /** The end tick whose cues this mounting issued, so a reload issues them once. */
  private countCuesFor: number | undefined;
  private readonly input = new InputManager();
  /**
   * The room's tuning, taken from the snapshot that brought us here.
   *
   * Not a field initializer any more, and never a resolved default: the
   * server decides a room's numbers, and a client that guessed them would
   * draw a confident sprite in the wrong place with nothing reporting it.
   */
  private tuning: ResolvedTuning | undefined;
  /**
   * The clock, the buffer and the prediction, as one object the netcode lab
   * runs too. Created per race from the room's own tuning.
   */
  private netcode: RaceNetcode | undefined;
  /** This race's netcode measurements. Read by the overlay and `__ffNet`. */
  private readonly diagnostics = new NetDiagnostics();
  private netStats: NetStatsOverlay | undefined;
  /**
   * Whether a frame has been drawn yet. The first one's gap is the loading the
   * screen did before it, not a frame the player watched stall, so it is not
   * measured as one.
   */
  private drewFirstFrame = false;
  /**
   * The race as drawn: scenery, world, HUD and song. Shared with the replay,
   * which draws a race it steps itself.
   */
  private scene: RaceScene | undefined;
  private touch: { readonly isMounted: boolean } | undefined;
  /** Hides the pointer while the player races by keys, pad or idle mouse. */
  private cursor: CursorRunner | undefined;
  /** The last input method the cursor was told about, so it hears only changes. */
  private cursorMethod: InputMethod | undefined;
  /** Whether the pause overlay is open (Task 9 sets it); a paused race shows the cursor. */
  private paused = false;
  /** The climb hum, held from the drawn sample; made on enter. */
  private drone: DroneHold | undefined;
  private readonly whoosh = new FastFallWhoosh(() =>
    this.context?.audio.cue(FAST_FALL_CUE.alias, { bus: "effects", gain: FAST_FALL_CUE.gain }),
  );
  private connection: ConnectionStateView | undefined;
  private mounted = false;

  /** True while the canvas is on screen, which a disconnect must not change. */
  isMounted(): boolean {
    return this.mounted;
  }

  /** The open pause overlay, if any. */
  private pause: ReturnType<typeof mount> | undefined;

  /** Whether the pause overlay is open. The race runs on either way. */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Opens or closes the pause overlay (launch polish §3.1.1, "Pause").
   *
   * The room keeps racing, so pausing only suspends this player's input and
   * hands the controller to the overlay's menu; the race goes on sampling
   * (neutral input) and drawing underneath.
   */
  private setPaused(context: ScreenContext, paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.input.setSuspended(paused);
    // The race heard through the menu: muffled, and given back on resume.
    this.scene?.setPaused(paused);
    // The overlay is menu territory: the controller navigates it.
    context.gamepad.setRaceTarget(paused ? undefined : this.input);
    if (paused) {
      this.pause = mount(PauseOverlay, {
        target: context.stage.overlay,
        props: {
          settings: context.settings,
          onResume: () => this.setPaused(context, false),
          onLeave: () => {
            // Leaving during the finish: the menu, not Results for a room the
            // player has just left.
            this.leaving = true;
            void context.network
              .leaveRoom()
              .catch(() => undefined)
              .finally(() => context.publishPresentationEvent("ui.leave-race-settled", {}));
          },
        },
      });
    } else if (this.pause !== undefined) {
      // Fades out over half a beat, inert from its first frame; nothing waits on it.
      void unmount(this.pause, { outro: true });
      this.pause = undefined;
    }
  }

  /** The host's menu button opens the race's own pause; the race goes on underneath. */
  override openMenu(): boolean {
    if (this.context === undefined) return false;
    this.setPaused(this.context, true);
    return true;
  }

  /**
   * The interpolated room state a view should draw this frame.
   *
   * Sampled at the render clock's moment rather than at a moment derived from
   * the newest snapshot: the latter only changes when a packet lands, which
   * would freeze the picture between arrivals and put transport jitter straight
   * on the screen.
   */
  sample(): RoomSnapshot | undefined {
    return this.netcode?.sample();
  }

  /**
   * The predicted local state, for the renderer and for prediction assertions.
   *
   * Everyone else is drawn from `sample`, an interpolation delay behind
   * authority. Drawing yourself that way is what makes your own controls feel
   * late, so the local sprite is simulated forward instead and reconciled to
   * every snapshot. Undefined until the first snapshot arrives.
   */
  predictedState(): PredictedState | undefined {
    return this.netcode?.predicted();
  }

  /**
   * The tuning this screen was built from.
   *
   * Exposed so a test can assert reference identity with the snapshot's own
   * object rather than mere equality: two equal tuning objects would hide
   * exactly the bug this arrangement removes.
   */
  gameplayTuning(): ResolvedTuning | undefined {
    return this.tuning;
  }

  protected async onEnter(context: ScreenContext): Promise<void> {
    // Read before anything is created. The transition into gameplay is driven
    // by a snapshot, so one is always waiting; if it is not, the room is not
    // one this client can draw, and leaving now means leaving with nothing
    // built rather than tearing a half-built screen down.
    const entrySnapshot = context.network.latestSnapshot();
    if (entrySnapshot === undefined) {
      this.recoverToMenu(
        context,
        "INVALID_ROOM",
        "room-silent",
      );
      return;
    }
    this.lastPhase = entrySnapshot.phase;
    this.tuning = entrySnapshot.tuning;
    this.netcode = new RaceNetcode({
      tuning: entrySnapshot.tuning,
      diagnostics: this.diagnostics,
      // Every frame goes out stamped with the tick it takes effect on; the
      // server holds it until then and rate-limits what it cannot use.
      send: (frame) => context.network.sendInput(frame),
      ping: (tick) => context.network.sendPing(tick),
      // Wall time when the display's ticker draws the race, which is every
      // real browser; a screen drawn frame by frame by a test keeps time by
      // the frames it is given.
      ...(this.onWallClock(context) ? { now: () => performance.now() } : {}),
      // Measured in the lobby, so the first inputs of the race are on time.
      ...(context.network.roundTripMs?.() === undefined
        ? {}
        : { roundTripMs: context.network.roundTripMs()! }),
    });

    // The loader (§3.1.5), with a real retry on a failed load.
    // Every bundle is already loaded from the select's loading step, so this is
    // instant; it is the retry path for a reload mid-race.
    // The room's song (select spec §5.5), named on the snapshot from the song
    // reveal on; already decoded by the select's loading step.
    const raceTrack = raceSong(context.content.current(), entrySnapshot.songId);
    await loadRaceAssets(context, m.shell_loading_race(), {
      songAlias: raceTrack?.audioAlias,
      songGroup: raceTrack === undefined ? undefined : `song-${raceTrack.id}`,
      stageId: entrySnapshot.stageId,
    });

    // Loaded above rather than at boot because a browser will not start audio
    // outside a user gesture, and reaching this screen took one. Not waited
    // on: a resume the browser refuses never settles, and the race must not
    // wait on its sound. The graph exists once this returns either way.
    void context.audio.unlock().catch(() => undefined);

    // The HUD holds the way into the pause overlay (§3.1.1), in a cell of its
    // own row, so it can never sit on a chip. On touch the timer is also the
    // restart, since there is no R key: a pulse, which the InputManager
    // latches for exactly one tick.
    // One hint per race, in the HUD's one toast slot under the top row: the
    // swipe coach, which the player needs to play, takes the first swipe
    // race, and the rotate hint waits for a later one. Decided once, here, so
    // the rotate hint never appears the moment the coach is dismissed.
    const coachThisRace =
      prefersTouchControls() &&
      context.settings.value.input.touchMode === "swipe" &&
      !context.settings.value.seen.swipeCoach;
    // The hints this race shows, one at a time in the same slot (spec parts 4
    // and 5): the coach has its race to itself, the lava line and the climb
    // lessons wait for a race of their own, and a watcher with no seat is shown
    // none and spends none.
    const endlessRace = isEndless(entrySnapshot.tuning);
    this.hintQueue = raceHints({
      endless: endlessRace,
      replay: false,
      seated: this.localPlayerId() !== undefined,
      coachDue: coachThisRace,
      seen: context.settings.value.seen,
    });
    this.firstInputAtMs = undefined;
    this.hintsSpentFlagged = false;
    const firstHint = currentHint(this.hintQueue, undefined, false);
    // The room's own numbers, for presentation sizing and for the local
    // visual lead. The values that decide a landing are these same ones,
    // applied on the server.
    // The stage and the song the room's roulettes chose (select spec §5.5), or
    // Chrome in the Rain for a race that began without a select.
    const content = context.content.current();
    const stage =
      content?.content.stages.find((entry) => entry.id === entrySnapshot.stageId) ?? content?.content.stages[0];
    // The stage's own air under the whole race: on the rooftops, wind and the
    // city far below.
    const bed = bedForStage(stage);
    context.audio.playBed?.(bed);
    // The room's song (select spec §5.5), which the race plays.
    const song = raceSong(content, entrySnapshot.songId);
    // Entered as the countdown begins. The song the reveal started plays on
    // through the count and GO; anything else holding the slot stops, and the
    // song then starts at GO (race-flow spec §3.3).
    const songPlaying = song !== undefined && context.audio.isLooping?.(song.audioAlias) === true;
    if (entrySnapshot.phase === "countdown" && !songPlaying) context.audio.stop();
    this.bag.add(() => context.audio.stopBed?.(bed));
    this.drone = new DroneHold(context.audio);
    this.bag.add(() => {
      this.drone?.stop();
      context.audio.stopDrone?.();
      this.drone = undefined;
    });
    const scene = new RaceScene(context, {
      tuning: entrySnapshot.tuning,
      stage,
      song,
      localPlayerId: () => this.localPlayerId(),
      hud: {
        settings: context.settings,
        ...(firstHint === undefined ? {} : { hint: firstHint }),
        // The Survival coach already says to stay above the lava, so it spends
        // the lava line too: she is not told twice (audit S6).
        onCoachDismiss: () => context.settings.update({ seen: { swipeCoach: true, ...(endlessRace ? { edgeLine: true } : {}) } }),
        onPause: () => this.setPaused(context, true),
        ...(prefersTouchControls()
          ? {
              onRestart: () => {
                this.input.set("reset", true, "touch");
                this.input.set("reset", false, "touch");
              },
            }
          : {}),
      },
    });
    this.scene = scene;
    this.bag.add(() => {
      scene.destroy();
      this.scene = undefined;
    });

    // The test-only reading of the three things a capture cannot get from the
    // DOM: which profile the scenery resolved to, what the ambient clock says,
    // and how large the bounded target actually came out. Installed here
    // because this screen is the only thing holding all three, and released
    // with the bag so a race that exits twice cannot leave a reader pointing at
    // a destroyed backdrop. Reads only -- see the module.
    this.bag.add(
      installVisualInspection(() => ({
        profile: this.scene?.presentation.profile ?? "legacy",
        refraction:
          this.scene?.backdrop?.refractionActive !== true
            ? "plain"
            : this.scene.backdrop.cityRefractionActive
              ? "sky+city"
              : "sky-only",
        citySampling: this.scene?.view.citySampling ?? null,
        clockSeconds: this.scene?.ambientSeconds ?? 0,
        target:
          this.scene?.backdrop?.targetSize === undefined
            ? null
            : {
                ...this.scene.backdrop.targetSize,
                pooled: this.scene.backdrop.pooledCapacity ?? 0,
              },
      })),
    );

    // The newest snapshot, not the entry one. Loading the bundles and the song
    // above takes most of a second in a browser, and the room ticked through
    // all of it; seeding the clock from the snapshot that brought us here
    // started the race that far in the past, so the first inputs were stamped
    // for ticks the room had already stepped and arrived forty ticks late.
    // Tuning and presentation stay the entry snapshot's: they are the room's
    // for its whole life, and a race must not change them halfway up.
    const latest = context.network.latestSnapshot();
    this.onSnapshot(
      latest ?? entrySnapshot,
      latest === undefined || !this.onWallClock(context)
        ? undefined
        : context.network.latestSnapshotReceivedAt?.(),
    );

    const connection = new ConnectionStateView(context.stage.overlay);
    connection.set(context.network.connectionState);
    this.connection = connection;
    this.bag.add(() => {
      connection.destroy();
      this.connection = undefined;
    });

    let connectionState = context.network.connectionState;
    this.bag.add(
      context.network.subscribe({
        onSnapshot: (snapshot) => this.onSnapshot(snapshot),
        // A transport problem changes what is said, never what is drawn: the
        // last snapshot stays on screen for the whole recovery window.
        onConnectionState: (state) => {
          // Back from a drop: frames sent while it lasted went nowhere, so the
          // current intent is sent again on the next tick.
          if (state === "connected" && connectionState === "reconnecting") this.netcode?.resync();
          // A drop mid-count silences it, mid-word, as the Lobby's did when
          // the count was the select screen's (owner, 2026-09-30).
          if (state === "offline" && this.lastPhase === "countdown") this.stopCount(context);
          connectionState = state;
          connection.set(state);
        },
        onError: (error) => this.onError(error.code, error.detail),
        onPong: (pong) => this.netcode?.pong(pong.id, pong.rttMs, pong.slack),
      }),
    );

    // The netcode instrument: `?netstats` shows it from the start, F3 toggles
    // it, and `__ffNet()` reads the same numbers in any build. It observes the
    // race and nothing in the race reads it back.
    const netStats = new NetStatsOverlay(context.stage.overlay, this.diagnostics);
    netStats.setVisible(VISUAL_INSPECTION_ENABLED && netStatsRequested());
    this.netStats = netStats;
    const onDebugKey = (event: KeyboardEvent): void => {
      if (event.code !== "F3") return;
      event.preventDefault();
      netStats.toggle();
    };
    window.addEventListener("keydown", onDebugKey);
    this.bag.add(() => {
      window.removeEventListener("keydown", onDebugKey);
      netStats.destroy();
      this.netStats = undefined;
    });
    this.bag.add(installNetReader(() => this.diagnostics.summary()));

    // Keys are read, not forwarded: the race samples them once per tick and
    // sends what it samples, so the frame the server holds and the frame the
    // prediction steps are the same one, on the same tick.
    this.input.attach();
    // The words "Press any key to start" and "Tap to start" are a promise: a
    // waiting Survival racer starts on a key the game does not bind, on any
    // controller button, and on a tap, not only on the few keys that steer.
    this.bag.add(this.input.onAnyPress((source) => this.startPulse(source)));
    const onTap = (event: Event): void => {
      // The HUD's own controls (Menu, the timer) take their taps as they do.
      if ((event.target as Element | null)?.closest?.("button, a, input, select, textarea, [role='button']")) return;
      this.startPulse("touch");
    };
    context.stage.overlay.addEventListener("pointerdown", onTap);
    this.bag.add(() => context.stage.overlay.removeEventListener("pointerdown", onTap));
    // The controller steers this race, and goes back to the menus with it.
    context.gamepad.setRaceTarget(this.input);
    this.bag.add(() => context.gamepad.setRaceTarget(undefined));
    // What this player holds, for the e2e pad journey; test builds only.
    this.bag.add(
      installInputInspection(() => {
        const { left, right, fastFall } = this.input.frame;
        return { left, right, fastFall };
      }),
    );

    // The cursor hides while the player races without the mouse (§3.1.3), and
    // its detach puts it back, however the race ends.
    const cursor = new CursorRunner(document.body, { paused: () => this.paused });
    this.bag.add(cursor.attach(window));
    this.cursor = cursor;
    this.bag.add(() => {
      this.cursor = undefined;
      this.cursorMethod = undefined;
    });
    this.bag.add(() => this.input.dispose());

    // Touch controls exist only where a finger is the primary input, and
    // follow the player's choice of swipe or buttons live.
    const touch = mountTouchInput(context, this.input);
    if (touch !== undefined) {
      this.touch = touch;
      this.bag.add(() => {
        touch.release();
        this.touch = undefined;
      });
    }

    // The way into the pause overlay on every device: the HUD's Menu button
    // for a pointer, Escape for a keyboard, and Start for a controller (which
    // arrives as Escape; see `focus-nav`). The overlay's own Escape stops at
    // the dialog and resumes through `onClose`, so this listener only ever
    // sees an Escape outside it.
    this.bag.addListener(window, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Escape" || key.defaultPrevented) return;
      this.setPaused(context, !this.paused);
    });
    this.bag.add(() => {
      if (this.pause !== undefined) void unmount(this.pause);
      this.pause = undefined;
      this.paused = false;
    });

    // One draw per frame from the interpolated buffer, not from the newest
    // snapshot: rendering straight off the wire would stutter at the broadcast
    // rate rather than run at the display rate.
    const ticker = context.stage.app?.ticker;
    if (ticker !== undefined) {
      // Network time is wall time: the ticker caps `deltaMS` at 100 ms, and a
      // clock fed the capped value falls behind the room on every slow frame.
      // Animation keeps the capped value, which is what it is for.
      const draw = (): void => this.draw(ticker.deltaMS, ticker.elapsedMS);
      // Ahead of the backdrop and composite passes, so both render the frame
      // this draw just produced rather than the one before it (Aquarian spec §5).
      this.bag.add(addRenderPass(ticker, "gameplayDraw", draw));
    }

    // The race as this player sees it, recorded live for the replay
    // window's Save and Share (unlockables spec §6.1). A hidden tab stops
    // painting, so the recording is dropped rather than kept frozen.
    if (context.raceVideo !== undefined) {
      const recordTicker = context.stage.app?.ticker;
      this.recorder = RaceRecorder.start({
        canvas: context.stage.canvas?.(),
        // The play field as the player sees it, in the canvas's own pixels.
        region: () => {
          const { gameplayCss: field, pixelRatio } = context.stage.viewport;
          return { x: field.x * pixelRatio, y: field.y * pixelRatio, width: field.width * pixelRatio, height: field.height * pixelRatio };
        },
        frames: recordTicker === undefined ? undefined : (copy) => addRenderPass(recordTicker, "record", copy),
        audio: context.audio.captureStream?.(),
        deviceClass: bootDeviceClass(),
      });
      const onVisibility = (): void => {
        if (document.visibilityState === "hidden") this.dropRecording();
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.bag.add(() => {
        document.removeEventListener("visibilitychange", onVisibility);
        this.dropRecording();
      });
    }

    context.stage.overlay.dataset["screen"] = "gameplay";
    this.mounted = true;
    // Entered mid-race (a reload): the round starts here, as it was not seen to start.
    const now = context.network.latestSnapshot();
    if (now?.phase === "racing") this.startRound(context, now);
  }

  /** The race began: a round for Ruken's play metrics, and the disclosed `race_started`. */
  private startRound(context: ScreenContext, snapshot: RoomSnapshot): void {
    if (this.round !== "none") return;
    this.round = "open";
    this.scoreSent = false;
    context.hosting?.roundStart();
    // A public room is the one Quick match seats you in; a private one is a friends' room.
    context.hosting?.track({ name: "race_started", props: { mode: snapshot.access === "public" ? "quick" : "room" } });
  }

  /** The race finished with the player in it: the round is complete, and where they placed. */
  private completeRound(context: ScreenContext, snapshot: RoomSnapshot): void {
    if (this.round !== "open") return;
    this.round = "over";
    context.hosting?.roundEnd("complete");
    // The order Results shows, so the place reported is the place the player saw.
    const place = orderedResults(snapshot).findIndex((player) => player.id === context.network.localPlayerId) + 1;
    if (place > 0) context.hosting?.track({ name: "race_finished", props: { place, players: snapshot.players.length } });
    this.submitScore(context, snapshot);
  }

  /**
   * The race's score, if it has one now (`scoreToSubmit`): the player's own
   * finish time, or Survival's highest floor once their run is over. Sent
   * once a race. Not awaited: no screen waits on Ruken, and the seam
   * swallows every failure.
   */
  private submitScore(context: ScreenContext, snapshot: RoomSnapshot, left = false): void {
    if (this.scoreSent) return;
    const submission = scoreToSubmit(snapshot, context.network.localPlayerId, { left });
    if (submission === undefined) return;
    this.scoreSent = true;
    void context.hosting?.submitScore(submission.board, submission.score);
  }

  /** Stops the recording and keeps the race's video for the replay window. */
  private keepRecording(context: ScreenContext): void {
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder === undefined) return;
    const stageId = context.network.latestSnapshot()?.stageId ?? "race";
    void recorder.finish({ stageId, finishedAt: new Date() }).then((video) => {
      if (video !== undefined) context.raceVideo?.keep(video);
    });
  }

  private dropRecording(): void {
    this.recorder?.abort();
    this.recorder = undefined;
  }

  /**
   * Handles a server failure.
   *
   * Only a failure the race cannot continue through leaves the screen, and it
   * always leaves with a reason attached. Gameplay never renders a result of
   * its own on the way out.
   */
  private onError(code: string, detail: ErrorDetail | undefined): void {
    if (!FATAL_CODES.includes(code)) return;
    const context = this.requireContext();
    // A halted race is the one fatal code whose room still exists: the seat
    // is given up here, or the player would sit on in a room that has stopped.
    // Every other fatal code means the room is already gone.
    if (code === "SIMULATION_FAILURE") void context.network.leaveRoom().catch(() => undefined);
    this.recoverToMenu(context, code as ServerErrorCode, detail);
  }

  /**
   * Leaves with a reason attached.
   *
   * The explanation reaches the error channel before the event is published,
   * so the screen that takes over already has something to show by the time
   * it enters. Gameplay names no destination: the graph decides where
   * recovery goes.
   */
  private recoverToMenu(context: ScreenContext, code: ServerErrorCode, detail?: ErrorDetail): void {
    // A finish still playing must not also ask for Results on its way out.
    this.leaving = true;
    context.errors.report(recoverableError(code as RecoverableErrorCode, detail));
    context.publishPresentationEvent("room.recovery-required", { code });
  }

  /**
   * The presentation this race was mounted with, for assertions.
   *
   * Exposed so a test can prove that replacing content after entry leaves the
   * object this race resolved untouched.
   */
  stagePresentation(): StagePresentation | undefined {
    return this.scene?.presentation;
  }

  /** The connection indicator, for layout and recovery assertions. */
  connectionState(): ConnectionStateView | undefined {
    return this.connection;
  }

  /**
   * Whether this race keeps wall time: when the display's ticker draws it,
   * which is every real browser. A test that draws frame by frame keeps time by
   * the frames it is given, and a wall-clock timestamp would be on a different
   * timeline from them.
   */
  private onWallClock(context: ScreenContext): boolean {
    return context.stage.app?.ticker !== undefined;
  }

  /**
   * Takes one snapshot. `receivedAt`, on the wall clock, when it arrived
   * earlier than it is being read -- which only the entry snapshot is.
   */
  private onSnapshot(snapshot: RoomSnapshot, receivedAt?: number): void {
    this.lastRoom = snapshot;
    // Sounded from the newest snapshot rather than from the delayed sample the
    // world is drawn on. A cue is information about something that has already
    // happened, and holding it back to match the interpolation would report a
    // landing later than authority knows about it. The mixer de-duplicates on
    // the server's own event ID, so a reconnect that re-delivers a batch costs
    // nothing.
    const room = {
      players: snapshot.players,
      lapCount: snapshot.lapCount,
      floorCount: ladderHeight(snapshot),
      ...(this.tuning === undefined ? {} : { halfWidth: courseBounds(this.tuning).right, floorGap: this.tuning.FLOOR_GAP_MIN }),
    };
    for (const { alias, ...options } of cuesForEvents(snapshot.events, this.localPlayerId(), room)) {
      this.context?.audio.cue(alias, options);
    }
    // Every racer's reset flickers; one the prediction already started keeps
    // its clock, because the IDs match.
    this.scene?.noteRoomResets(snapshot.events);
    this.scene?.announce(this.announcer.observe(snapshot));

    // Confirmations close out whatever the prediction ticked early. Both an
    // upgrade and a plain confirmation have already had their landing sounded
    // above; what this settles is the speculative tick, which must not be
    // heard again and must not be left waiting.
    const local = this.localPlayerId();
    for (const event of snapshot.events) {
      if (event.type !== "floorLanded" || event.playerId !== local) continue;
      this.contacts.confirm(event.floorId, event.id);
    }
    // Steers the render clock and reconciles the prediction against the
    // newest snapshot rather than the delayed sample: the replay starts from
    // where the server actually put the player, and how far forward of it to
    // replay is the clock's answer -- the same clock the world is drawn on.
    this.netcode?.observe(snapshot, this.localPlayerId(), receivedAt);

    this.count.observe(snapshot);
    // The count's cues (race-flow spec §3.4). The Lobby schedules them on the
    // snapshot that hands over; cues are de-duplicated by event ID, so issuing
    // the same IDs here costs nothing then and covers a reload mid-count.
    const endsAt = snapshot.countdownEndsAtTick;
    if (snapshot.phase === "countdown" && endsAt !== undefined && endsAt !== this.countCuesFor) {
      this.countCuesFor = endsAt;
      const remainingMs = Math.max(0, (endsAt - snapshot.tick) * TICK_MS);
      for (const { alias, ...options } of countdownCues(`countdown:${snapshot.hostId}:${endsAt}`, remainingMs)) {
        this.context?.audio.cue(alias, options);
      }
    }

    // Knocked out of Survival while others race on: the run is over, so its floor posts now.
    if (this.context !== undefined && this.round === "open" && snapshot.phase === "racing") this.submitScore(this.context, snapshot);

    if (snapshot.phase === this.lastPhase) return;
    this.lastPhase = snapshot.phase;

    if (this.context !== undefined) {
      if (snapshot.phase === "racing") this.startRound(this.context, snapshot);
      if (snapshot.phase === "finished") this.completeRound(this.context, snapshot);
    }

    if (snapshot.phase === "finished") {
      // A client that never drew the race (a reload, a late snapshot) goes
      // straight on; one that watched it plays the finish first (race-flow
      // spec §5.2).
      if (!this.drewRacing) this.publishFinished(snapshot.winnerId);
      else this.startFinish(snapshot.winnerId);
    }
  }

  /** Silences the count, the number speaking and the ones queued behind it. */
  private stopCount(context: ScreenContext): void {
    if (context.audio.stopCues !== undefined) context.audio.stopCues("countdown:");
    else context.audio.cancelPending?.("countdown:");
  }

  /** The winner's last landing, slowed, then Results (race-flow spec §5.2). */
  private startFinish(winnerId: PlayerId | undefined): void {
    if (this.finish !== undefined) return;
    const reduced = reducedMotion();
    this.finish = new FinishSequence(this.wallMs, reduced);
    this.finishWinner = winnerId;
    if (winnerId !== undefined) this.scene?.focusOn(winnerId, reduced);
    // Frames stop in a hidden tab; Results must not wait on them.
    const timer = setTimeout(() => this.publishFinished(winnerId), STALL_FALLBACK_MS);
    this.bag.add(() => clearTimeout(timer));
  }

  private publishFinished(winnerId: PlayerId | undefined): void {
    if (this.finishPublished || this.leaving) return;
    this.finishPublished = true;
    const context = this.requireContext();
    this.keepRecording(context);
    context.publishPresentationEvent("room.finished", winnerId === undefined ? {} : { winnerId });
  }

  /**
   * Draws one frame.
   *
   * The ticker drives this; nothing else does. Remote players and the world
   * come from the interpolated sample, and the local player from the lead that
   * this call advances first.
   *
   * `deltaMs` is the ticker's capped delta and drives animation. `elapsedMs`
   * is the wall time since the last frame and drives the race's clock, which
   * has to keep pace with the room however long a frame took.
   */
  draw(deltaMs: number, elapsedMs: number = deltaMs): void {
    const drawStarted = performance.now();
    // Wall time measures the finish; presentation time is slowed by it.
    this.wallMs += elapsedMs;
    const scale = this.finish?.scale(this.wallMs) ?? 1;
    this.netcode?.setPresentationScale(scale);
    // A pad press never moves the mouse, so the pad reaches the cursor through
    // the app's input-method tracker -- on the change only, or a mouse moved
    // after the pad would be hidden again on the very next frame.
    const method = inputMethod.method;
    if (method !== this.cursorMethod) {
      this.cursorMethod = method;
      if (method === "gamepad") this.cursor?.noteInput("gamepad");
    }
    this.cursor?.tick();
    const frame = this.netcode?.frame(() => {
      const intent = this.input.sample();
      this.whoosh.observe(intent);
      return intent;
    }, elapsedMs);
    if (frame === undefined) return;
    const sample = frame.sample;
    this.scene?.setCount(this.count.label(this.netcode?.authorityTick()));
    this.updateHints();
    if (sample.phase === "racing") {
      this.drewRacing = true;
      this.scene?.startSong();
    }
    // The sequence already latched reduced motion, which holds the scale at 1.
    if (this.finish !== undefined) this.context?.audio.slowMusic?.(scale);

    // Contacts this client believes it has made, answered immediately with a
    // tick. They never credit anything -- a floor, a score, the HUD's pop --
    // because the server may disagree, and the confirmation above owns credit.
    // Contact juice (a squash, a puff, the slam's kick) is not driven from
    // these events either: the scene's JuiceDirector hears the drawn picture
    // turn, which is what the player saw (polish spec §4.1). The landing's
    // sound waits for the draw, so a slam the draw hears can replace it
    // (Wonder spec §3.2).
    const predicted = this.netcode?.drainPredictedEvents() ?? [];
    const landingCues: Sound[] = [];
    const localId = this.localPlayerId();
    this.scene?.noteResets(predicted.filter((event) => event.type === "playerReset" && event.playerId === localId));
    for (const event of predicted) {
      if (event.type !== "floorLanded" || event.playerId !== localId) continue;
      const effect = this.contacts.predict({ floorId: event.floorId, tick: event.tick });
      if (effect === undefined) continue;
      // The landing itself, now, rather than a placeholder tick followed by
      // the real sound a round trip later. One transient per landing, on the
      // frame the player watched it happen, pitched to the floor's height and
      // placed where the racer is on screen.
      landingCues.push(
        ...landingSounds(event.floorIndex, {
          floorCount: ladderHeight(sample),
          pan: panFor(frame.predicted?.x, this.tuning === undefined ? undefined : courseBounds(this.tuning).right),
        }),
      );
    }
    // A prediction nothing confirms is dropped quietly: the tick and the
    // compression have both already ended, so there is nothing to take back.
    this.contacts.expire(this.netcode?.predictedTick ?? 0);
    this.drone?.update(sample, localId, this.netcode?.authorityTick() ?? sample.tick);

    // The scenery, the world, the HUD and the mix, all from this one sample.
    if (landingCues.length > 0) {
      this.pendingLanding = { sounds: [...(this.pendingLanding?.sounds ?? []), ...landingCues], framesLeft: LANDING_WAIT_FRAMES };
    }
    this.scene?.draw(sample, deltaMs * scale, frame.predicted, frame.floors, this.netcode?.authorityTick(), this.pendingLanding !== undefined, this.netcode?.drainSideContacts() ?? []);
    this.settleLanding(localId);

    const bytesIn = this.context?.network.wireBytesIn?.();
    if (bytesIn !== undefined) this.diagnostics.wire(bytesIn);
    if (this.drewFirstFrame) this.diagnostics.frame(elapsedMs, performance.now() - drawStarted);
    this.drewFirstFrame = true;
    this.netStats?.update();
    if (this.finish?.done(this.wallMs) === true) this.publishFinished(this.finishWinner);
  }

  /**
   * Plays the held landing when the drawn racer turns, or drops it if the turn
   * is a slam (the slam is the bigger cue); plays it anyway once it has waited
   * `LANDING_WAIT_FRAMES`, so a landing nothing draws is never lost.
   */
  private settleLanding(localId: PlayerId | undefined): void {
    const pending = this.pendingLanding;
    if (pending === undefined) return;
    if (this.scene?.localSlammed === true) {
      this.pendingLanding = undefined;
      return;
    }
    const turned = this.scene?.juiceFrame?.moments.some(
      (moment) => moment.playerId === localId && (moment.kind === "bounce" || moment.kind === "slam"),
    );
    pending.framesLeft -= 1;
    if (turned !== true && pending.framesLeft > 0) return;
    this.pendingLanding = undefined;
    for (const { alias, ...options } of pending.sounds) this.context?.audio.cue(alias, options);
  }

  /**
   * Puts the right hint in the HUD's toast slot, and sets the device's flag once
   * the hints have had their time. The time counts from the first snapshot that
   * shows her no longer waiting for a first input, on the render clock, so a
   * slow start costs her nothing. A race she goes out of or leaves first spends
   * nothing: she may not have read it.
   */
  private updateHints(): void {
    const room = this.lastRoom;
    const local = room?.players.find((player) => player.id === this.localPlayerId());
    if (this.firstInputAtMs === undefined && local !== undefined && !local.awaitingInput) this.firstInputAtMs = this.wallMs;
    const since = this.firstInputAtMs === undefined ? undefined : this.wallMs - this.firstInputAtMs;
    const out = local?.outAtTick !== undefined;
    this.scene?.setHint(currentHint(this.hintQueue, since, out));
    if (this.hintsSpentFlagged || out || !hintsSpent(this.hintQueue, since)) return;
    this.hintsSpentFlagged = true;
    const first = this.hintQueue[0];
    if (first === "edge") this.context?.settings.update({ seen: { edgeLine: true } });
    else if (first === "floors") this.context?.settings.update({ seen: { climbHints: true } });
  }

  /**
   * Starts a waiting Survival racer: one press of reset, which ends her wait
   * and does nothing else in Survival (a reset is ignored there). It is an
   * ordinary input frame, so prediction, the room and a replay all agree on it.
   * Nothing is sent once she has started, in a climb (where a reset restarts),
   * while paused, or after the first pulse of this race.
   */
  private startPulse(source: "keyboard" | "gamepad" | "touch"): void {
    const room = this.lastRoom ?? this.context?.network.latestSnapshot();
    if (this.startPulseSent || this.paused || room === undefined || !awaitingStart(room, this.localPlayerId())) return;
    this.startPulseSent = true;
    this.input.set("reset", true, source);
    this.input.set("reset", false, source);
  }

  private localPlayerId(): PlayerId | undefined {
    const id = this.context?.network.localPlayerId;
    return id === undefined ? undefined : asPlayerId(id);
  }

  /** Whether touch controls are on screen, for layout verification. */
  hasTouchControls(): boolean {
    return this.touch?.isMounted === true;
  }

  protected override onExit(): void {
    // Left with the race still on: Leave, a failed room, or the host closing the
    // game. That ends a Survival run, so its floor posts.
    if (this.round === "open" && this.context !== undefined) {
      const room = this.lastRoom ?? this.context.network.latestSnapshot();
      if (room !== undefined) this.submitScore(this.context, room, true);
      this.context.hosting?.roundEnd("quit");
    }
    this.round = "none";
    this.lastRoom = undefined;
    // Leaving mid-count: the count stops with the player, mid-word, as the
    // Lobby's does when a connection drops.
    if (this.lastPhase === "countdown" && this.context !== undefined) this.stopCount(this.context);
    // The finish's slow motion is the race's; whatever plays next plays at speed.
    if (this.finish !== undefined) this.context?.audio.slowMusic?.(1);
    this.countCuesFor = undefined;
    this.count = new CountdownClock();
    this.announcer = new RaceAnnouncer(() => this.localPlayerId());
    this.startPulseSent = false;
    this.hintQueue = [];
    this.firstInputAtMs = undefined;
    this.hintsSpentFlagged = false;
    this.wallMs = 0;
    this.drewRacing = false;
    this.finish = undefined;
    this.finishWinner = undefined;
    this.finishPublished = false;
    this.leaving = false;
    this.mounted = false;
    this.drewFirstFrame = false;
    this.netcode?.clear();
    this.netcode = undefined;
    this.tuning = undefined;
    this.lastPhase = undefined;
    this.paused = false;
  }
}
