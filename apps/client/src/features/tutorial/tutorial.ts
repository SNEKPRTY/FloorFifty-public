/**
 * Tutorial: a race on this device alone that waits for the player to do each
 * move (launch polish §3.1.4).
 *
 * The same scene a race draws, fed by a `TutorialRun` stepping the shared
 * simulation here instead of by a room. Nothing is sent to a server, so the
 * pause overlay really pauses, and leaving costs nothing.
 *
 * It closes back to where it was opened -- the title or the lobby -- and marks
 * the tutorial seen only when the player finished or skipped it: an Exit
 * leaves the lobby's first-Play offer standing.
 */

import * as m from "../../paraglide/messages.js";
import { mount, unmount } from "svelte";
import type { ScreenId } from "../profile/screen-state";
import { raceSong } from "../audio";
import { tutorialSongOf } from "./tutorial-song";
import { InputManager } from "../platform/input";
import {
  FAST_FALL_CUE,
  FastFallWhoosh,
  bedForStage,
  cuesForEvents,
  landingSounds,
} from "../race/race-cues";
import { RaceScene, loadRaceAssets, mountTouchInput } from "../race/race-scene";
import { prefersTouchControls } from "../race/touch-controls";
import { addRenderPass } from "../platform/render-order";
import type { StagePresentation } from "../render/stage-presentation";
import { TutorialRun } from "./tutorial-run";
import PauseOverlay from "../race/PauseOverlay.svelte";
import { CursorRunner } from "../platform/cursor-policy";
import { inputMethod, type InputMethod } from "../platform/input-method.svelte";
import { TutorialPromptView } from "./tutorial-prompt.svelte";
import { BaseScreen, type ScreenContext } from "../screen/screen";

export class TutorialScreen extends BaseScreen {
  readonly name: ScreenId = "Tutorial";

  /** The tick of the last snapshot drawn, for tests. */
  private lastTick = 0;
  private scene: RaceScene | undefined;
  /** The run, while the tutorial is on screen. */
  private run: TutorialRun | undefined;

  /** The run's script, for tests: which step it is on, and whether it is done. */
  script(): TutorialRun["script"] | undefined {
    return this.run?.script;
  }
  /** This tutorial as a Ruken round (M1 contracts §6): open until done, skipped or left. */
  private roundOpen = false;

  /** The stage's presentation as drawn, for tests; as `GameplayScreen` exposes it. */
  stagePresentation(): StagePresentation | undefined {
    return this.scene?.presentation;
  }

  /** Opens the pause, for the host's menu button; set while the tutorial runs. */
  private pauseForMenu: (() => void) | undefined;

  /** The host's menu button opens the tutorial's own pause, which really pauses. */
  override openMenu(): boolean {
    if (this.pauseForMenu === undefined) return false;
    this.pauseForMenu();
    return true;
  }

  /** The tick the run last reached. A test reads it to see the run stand still. */
  tick(): number {
    return this.lastTick;
  }

  protected async onEnter(context: ScreenContext): Promise<void> {
    const origin = context.previousScreen === "Lobby" ? "Lobby" : "MainMenu";
    const close = (to: "MainMenu" | "Lobby"): void =>
      context.publishPresentationEvent(to === "Lobby" ? "ui.tutorial-closed-to-lobby" : "ui.tutorial-closed-to-title", {});

    // Optional at runtime: a stale artifact's tutorial carries no song, and
    // plays the race's (`tutorialSongOf`).
    const tutorialSong = tutorialSongOf(context);
    // The Dawn stage's layers are in `gameplay`, so the tutorial names no stage.
    await loadRaceAssets(context, m.shell_loading_tutorial(), {
      songAlias: tutorialSong?.audioAlias,
      songGroup: tutorialSong === undefined ? undefined : `song-${tutorialSong.id}`,
    });
    // Reaching this screen took a gesture, which is what a browser asks for.
    // Not waited on: a refused resume never settles (see `gameplay.ts`).
    void context.audio.unlock().catch(() => undefined);

    const content = context.content.current();
    if (content === undefined) {
      // Nothing to teach from: the title has always fetched content by now,
      // so this is a client that never had any. Back the way it came.
      close(origin);
      return;
    }
    const tutorial = content.content.tutorial;
    const tuning = content.content.baseTuning;

    // The player's own controls, as in a race: keys, the controller and touch.
    const input = new InputManager();
    input.attach();
    this.bag.add(() => input.dispose());
    context.gamepad.setRaceTarget(input);
    this.bag.add(() => context.gamepad.setRaceTarget(undefined));

    const whoosh = new FastFallWhoosh(() =>
      context.audio.cue(FAST_FALL_CUE.alias, { bus: "effects", gain: FAST_FALL_CUE.gain }),
    );
    const run = new TutorialRun({
      tutorial,
      tuning,
      // The tutorial draws the body this device last picked (spec §3).
      characterId: context.settings.value.profile.lastCharacter,
      colour: context.settings.value.profile.lastColour,
      revisions: { contentRevision: content.contentRevision, rulesetRevision: content.rulesetRevision },
      sample: () => {
        const intent = input.sample();
        whoosh.observe(intent);
        return intent;
      },
    });
    // Registered first, so it is released last: everything after reads it.
    this.bag.add(() => run.dispose());
    this.run = run;
    this.bag.add(() => (this.run = undefined));

    // A tutorial run is a round for Ruken's play metrics, as a race is: it
    // ends complete when the last step is done, and as quit when skipped or
    // left part-way (in `skip` below and in `onExit`).
    const hosting = context.hosting;
    this.roundOpen = true;
    hosting?.roundStart();
    hosting?.track({ name: "race_started", props: { mode: "tutorial" } });
    const endRound = (outcome: "complete" | "quit"): void => {
      if (!this.roundOpen) return;
      this.roundOpen = false;
      hosting?.roundEnd(outcome);
      hosting?.track({ name: outcome === "complete" ? "tutorial_completed" : "tutorial_skipped" });
    };

    let paused = false;
    let pauseOverlay: ReturnType<typeof mount> | undefined;
    /**
     * Opens or closes the pause overlay. Unlike a race's, this one stops the
     * run: here nothing else is climbing.
     */
    const setPaused = (next: boolean): void => {
      if (next === paused) return;
      paused = next;
      prompt.setPaused(next);
      run.setPaused(next);
      input.setSuspended(next);
      // The overlay is menu territory: the controller navigates it.
      context.gamepad.setRaceTarget(next ? undefined : input);
      if (next) {
        pauseOverlay = mount(PauseOverlay, {
          target: context.stage.overlay,
          props: {
            settings: context.settings,
            // The title says it is paused; no line repeats it (ui layout spec §6.10).
            status: null,
            // A getter, so a language switch made from this overlay's own
            // Settings re-words it in place.
            get leaveLabel() {
              return m.tutorial_exit();
            },
            confirmLeave: false,
            onResume: () => setPaused(false),
            onLeave: () => close(origin),
            // The one way a controller reaches Skip: it drives the racer while
            // the tutorial runs, so the prompt's button is out of its reach.
            onSkip: () => {
              setPaused(false);
              skip();
            },
          },
        });
      } else if (pauseOverlay !== undefined) {
        // Fades out over half a beat, inert from its first frame; nothing waits on it.
        void unmount(pauseOverlay, { outro: true });
        pauseOverlay = undefined;
      }
    };

    // Optional at runtime, whatever the type says: a stale artifact carries
    // no tutorial stage, and draws the race's rather than an empty sky.
    const own = tutorial as Partial<Pick<typeof tutorial, "stage" | "song">>;
    const stage = own.stage ?? content.content.stages[0];
    // The air of the stage being taught on: the dawn's breeze and birds.
    const bed = bedForStage(stage);
    context.audio.playBed?.(bed);
    this.bag.add(() => context.audio.stopBed?.(bed));
    const scene = new RaceScene(context, {
      tuning,
      localPlayerId: () => run.playerId,
      stage,
      song: own.song ?? raceSong(content, undefined),
      isTutorial: true,
      hud: {

        settings: context.settings,
        solo: true,
        onPause: () => setPaused(true),
        // On touch the timer is the restart, as in a race: a one-tick pulse.
        ...(prefersTouchControls()
          ? {
              onRestart: () => {
                input.set("reset", true, "touch");
                input.set("reset", false, "touch");
              },
            }
          : {}),
      },
    });
    this.scene = scene;
    // The tutorial has no countdown: its song starts with it.
    scene.startSong();
    this.bag.add(() => {
      scene.destroy();
      this.scene = undefined;
    });

    const touch = mountTouchInput(context, input);
    if (touch !== undefined) this.bag.add(() => touch.release());

    // The cursor hides while the player plays without the mouse (§3.1.3).
    const cursor = new CursorRunner(document.body, { paused: () => paused });
    this.bag.add(cursor.attach(window));
    let cursorMethod: InputMethod | undefined;

    // Seen once finished or skipped, never on Exit.
    let markedSeen = false;
    const markSeen = (): void => {
      if (markedSeen) return;
      markedSeen = true;
      context.settings.update({ seen: { tutorial: true } });
    };

    const prompt = new TutorialPromptView(context.stage.overlay, {
      steps: tutorial.steps,
      origin,
      settings: context.settings,
      onSkip: () => skip(),
      // Play now from the title goes to the lobby, as Race now does.
      onRaceNow: () => close("Lobby"),
      onBackToTitle: () => close("MainMenu"),
    });
    this.bag.add(() => prompt.destroy());
    function skip(): void {
      endRound("quit");
      run.script.skip();
      markSeen();
      prompt.update(run.script.index, run.script.phase, true, false);
    }

    // Escape (and a controller's Start, which arrives as it) pauses. A dialog
    // that handled an Escape has prevented it, so this never sees that one.
    this.bag.addListener(window, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Escape" || key.defaultPrevented || run.script.done) return;
      setPaused(!paused);
    });
    this.bag.add(() => {
      if (pauseOverlay !== undefined) void unmount(pauseOverlay);
      pauseOverlay = undefined;
    });

    // Inside Ruken: the host's menu button opens this pause, and so does the
    // host putting the game in the background for any reason (P6 §4). Nothing
    // else is climbing here, so a tutorial left running would be lost time;
    // it waits for the player to resume it, never resuming on its own.
    this.pauseForMenu = () => setPaused(true);
    this.bag.add(() => (this.pauseForMenu = undefined));
    const releaseLifecycle = context.hosting?.onLifecycle((lifecycle) => {
      if (lifecycle.state === "background" && !run.script.done) setPaused(true);
    });
    if (releaseLifecycle !== undefined) this.bag.add(releaseLifecycle);

    const draw = (deltaMs: number, elapsedMs: number): void => {
      // A pad press never moves the mouse, so the pad reaches the cursor
      // through the input-method tracker, on the change only.
      if (inputMethod.method !== cursorMethod) {
        cursorMethod = inputMethod.method;
        if (cursorMethod === "gamepad") cursor.noteInput("gamepad");
      }
      cursor.tick();

      const snapshot = run.advance(elapsedMs);
      this.lastTick = snapshot.tick;
      for (const { alias, ...options } of cuesForEvents(snapshot.events, run.playerId, snapshot)) {
        context.audio.cue(alias, options);
      }
      // The tutorial steps its own world, so its landings arrive as events
      // rather than as a prediction; they sound here, as the race's do there.
      for (const event of snapshot.events) {
        if (event.type !== "floorLanded" || event.playerId !== run.playerId) continue;
        for (const { alias, ...options } of landingSounds(event.floorIndex, { floorCount: snapshot.floorCount })) {
          context.audio.cue(alias, options);
        }
      }
      // A reset (a fall past the bottom, or R) flickers here as it does in a
      // race (race-flow spec §5.1).
      scene.noteResets(snapshot.events);
      // The juice answers them too: there is no room, so the run's own events
      // stand in for the room's (polish spec §4.1).
      scene.noteRoomEvents(snapshot.events);
      // The last step's edge and a catch: the lava is the tutorial's own, and "OUT!" is shown here
      // because the run, not a room, decides she is out.
      scene.setTutorialEdge(run.edge);
      scene.showOut(run.out);
      scene.draw(snapshot, deltaMs, undefined, undefined, undefined, false, run.drainSideContacts());
      if (run.script.done) {
        markSeen();
        // Done without a skip (a skip ended the round already): every step was played.
        endRound("complete");
      }
      prompt.update(run.script.index, run.script.phase, run.script.done, run.script.caught);
      // Out of the racer's way while it plays; solid while frozen, when
      // nothing moves and the words are what the player is reading.
      prompt.keepClearOf(run.script.done ? undefined : scene.localRacerRect());
    };
    const ticker = context.stage.app?.ticker;
    if (ticker !== undefined) {
      // Stepped on wall time, as a race keeps it; animation keeps the capped delta.
      this.bag.add(addRenderPass(ticker, "gameplayDraw", () => draw(ticker.deltaMS, ticker.elapsedMS ?? ticker.deltaMS)));
    }

    context.stage.overlay.dataset["screen"] = "tutorial";
  }

  protected override onExit(): void {
    // Left part-way: Leave tutorial, or the host closing the game.
    if (this.roundOpen) this.context?.hosting?.roundEnd("quit");
    this.roundOpen = false;
    this.lastTick = 0;
  }
}
