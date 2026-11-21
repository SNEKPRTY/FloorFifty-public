/**
 * Story: one chapter's climb on this device alone (story mode v2 spec, "In
 * the climb"), with Frog and Oni beside the player, the glims and lamps, the
 * lava and the wind, and the words along the way.
 *
 * The same scene a race draws, fed by a `StoryRun` stepping the shared
 * simulation here instead of by a room, through the three openings the scene
 * keeps for the story: its layer in the world, its named moments, and the
 * Floors chip's reading. Nothing is sent to a server, so the pause really
 * pauses, and leaving costs nothing.
 *
 * It opens on the hub, focused on the first chapter not yet finished. A
 * finished chapter saves its stars, glims and time, lets its last words go
 * by, and shows its results over the frozen climb; "Next" opens the next
 * chapter's cutscene, and after the last, the ending.
 */

import * as m from "../../paraglide/messages.js";
import { mount, unmount } from "svelte";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { floorX } from "@floor-fifty/shared/common/state";
import type { ChipKind } from "@floor-fifty/shared/level/tutorial";
import type { GameContentPayload, StoryChapter, StoryContent, StoryCutscene, StoryLine } from "@floor-fifty/shared/content/game-content";
import type { ScreenId } from "../profile/screen-state";
import { DisposeBag } from "../../lib/dispose";
import { InputManager, type InputIntent } from "../platform/input";
import { FAST_FALL_CUE, FastFallWhoosh, bedForStage, cuesForEvents, landingSounds } from "../race/race-cues";
import { RaceScene, loadRaceAssets, mountTouchInput, preloadRaceAssets } from "../race/race-scene";
import { formatElapsed } from "../race/hud-model";
import { addRenderPass } from "../platform/render-order";
import { VISUAL_INSPECTION_ENABLED, installStoryInspection } from "../render/inspection";
import type { StagePresentation } from "../render/stage-presentation";
import { reducedMotion } from "../kit/motion";
import { StoryRun, heroLook } from "./story-run";
import Cutscene from "./Cutscene.svelte";
import TitleCard from "./TitleCard.svelte";
import StoryFinale from "./StoryFinale.svelte";
import StoryHub from "./StoryHub.svelte";
import ChapterResults from "./ChapterResults.svelte";
import { chapterGlims } from "./pickups";
import type { CutsceneLineView, CutscenePanelView } from "./cutscene";
import { after, type FlowStep } from "./story-flow";
import { StoryTalk, lineHoldMs } from "./story-talk";
import PauseOverlay from "../race/PauseOverlay.svelte";
import { CursorRunner } from "../platform/cursor-policy";
import { inputMethod, type InputMethod } from "../platform/input-method.svelte";
import { characterName, storyBark, storyCutLine, storyLast, storyThesis, storyTitle } from "../i18n/content";
import { portraitAliasFor } from "../profile/character-art";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { actorPlayerId } from "./actors";
import type { StoryEvent } from "./director";
import { StoryFeel } from "./story-feel";
import { StoryHudView, type HudLine, type HudPointer } from "./story-hud.svelte";
import { StoryLayer } from "./story-layer";
import { firstUnfinished, recordFinish, recordOf, starsFor, totals, unlocked, type ChapterResult, type HubChapter } from "./progress";

type Chapter = {
  readonly index: number;
  readonly spec: StoryChapter;
  readonly run: StoryRun;
  readonly scene: RaceScene;
  readonly layer: StoryLayer;
  readonly feel: StoryFeel;
  readonly talk: StoryTalk<HudLine>;
  readonly bag: DisposeBag;
  /** Run time, stepped with the run, so a pause holds a line on screen. */
  clockMs: number;
  finished: boolean;
  /** The run's tick when the chapter was finished: the results never wait more than `AFTER_DONE_TICKS` after it. */
  finishedAtTick: number | undefined;
  /** The control chip showing, and the move that clears it. */
  chip: ChipKind | undefined;
  /** When the camera goes back to the player after a `lookAt`, on the run clock. */
  lookUntilMs: number | undefined;
  /** The finished run, for its results: what it earned, and which stars are new. */
  result: { readonly run: ChapterResult; readonly stars: [boolean, boolean, boolean]; readonly fresh: [boolean, boolean, boolean] } | undefined;
  /** Frames drawn so far: the HUD and the chapter card wait for the stage's first ones. */
  drawn: number;
  /** Called once the stage and the HUD have been drawn and measured for this chapter. */
  onShown: (() => void) | undefined;
};

/** Frames the stage draws before the HUD and the chapter card show over it. */
const SHOWN_AFTER_FRAMES = 2;

/** How long the finished chapter stands before the next, after its last words. */
const AFTER_WORDS_MS = 900;
/**
 * The most the finished chapter stands, in the run's own ticks, when it has no
 * words for its goal; one with goal words gives them their hold on top. The
 * climb is over: a stretch with nothing new is dead time (review 2, R2).
 */
export const AFTER_DONE_TICKS = 72;
/** How often the story's chips re-measure the race HUD's band. */
const ANCHOR_EVERY_MS = 250;


/** The ticks a chapter's goal words stand, one after another. */
const goalWordsTicks = (chapter: StoryChapter): number =>
  Math.ceil(
    chapter.moments.filter((moment) => moment.when.kind === "goal").flatMap((moment) => moment.lines ?? []).reduce((sum, line) => sum + lineHoldMs(line.text), 0) / TICK_MS,
  );

/** Whole seconds as minutes and seconds, "1:05". */
const clockOf = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export class StoryScreen extends BaseScreen {
  readonly name: ScreenId = "Story";

  private lastTick = 0;
  private chapter: Chapter | undefined;
  private hud: StoryHudView | undefined;
  /** The chapter on screen, for tests. */
  chapterIndex(): number | undefined {
    return this.chapter?.index;
  }

  /** The chapter's run, for tests and the inspection hook's bot. */
  run(): StoryRun | undefined {
    return this.chapter?.run;
  }

  /** Hands that play instead of the player's, for tests and the inspection hook's bot; undefined gives them back. */
  steerWith(steer: ((run: StoryRun, tick: number) => InputIntent) | undefined): void {
    this.steer = steer;
  }
  private steer: ((run: StoryRun, tick: number) => InputIntent) | undefined;

  /** The story HUD's model, for tests. */
  hudModel(): ReturnType<StoryHudView["current"]> | undefined {
    return this.hud?.current();
  }

  /** This story as a Ruken round (M1 contracts §6): open until done, skipped or left. The analytics names keep their old "tutorial" spelling, so past counts stay comparable. */
  private roundOpen = false;

  /** The stage's presentation as drawn, for tests; as `GameplayScreen` exposes it. */
  stagePresentation(): StagePresentation | undefined {
    return this.chapter?.scene.presentation;
  }

  /** Opens the pause, for the host's menu button; set while the story runs. */
  private pauseForMenu: (() => void) | undefined;

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
      context.publishPresentationEvent(to === "Lobby" ? "ui.story-closed-to-lobby" : "ui.story-closed-to-title", {});

    const found = context.content.current();
    const story = found?.content.story as Partial<StoryContent> | undefined;
    const chapters: readonly StoryChapter[] = story?.chapters ?? [];
    if (found === undefined || story?.prompts === undefined || story.actors === undefined || chapters.length === 0) {
      // Nothing to tell: a client that never had content. Back the way it came.
      close(origin);
      return;
    }
    const content: GameContentPayload = found.content;
    const actorsContent = story.actors;
    const tuning = content.baseTuning;

    void context.audio.unlock().catch(() => undefined);

    const input = new InputManager();
    input.attach();
    this.bag.add(() => input.dispose());
    context.gamepad.setRaceTarget(input);
    this.bag.add(() => context.gamepad.setRaceTarget(undefined));

    const whoosh = new FastFallWhoosh(() => context.audio.cue(FAST_FALL_CUE.alias, { bus: "effects", gain: FAST_FALL_CUE.gain }));

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

    const profile = context.settings.value.profile;
    const hero = heroLook({ characterId: profile.lastCharacter, colour: profile.lastColour }, actorsContent);
    const actorName = (id: string): string => {
      const character = content.characters.find((candidate) => candidate.id === actorsContent[id]?.characterId);
      return character === undefined ? id : characterName(character);
    };
    /** Who says a line: their name, colour and portrait in the line's mood (the player as the story draws them). */
    const speakerOf = (line: StoryLine): Omit<CutsceneLineView, "text"> => {
      const mood = line.mood ?? "neutral";
      if (line.speaker === undefined) return {};
      if (line.speaker === "you") {
        return { speaker: m.ready_seat_you(), colour: hero.colour, portrait: context.assets.srcOf?.(portraitAliasFor(content, hero.characterId, hero.colour, mood)) };
      }
      const actor = actorsContent[line.speaker];
      return {
        speaker: actorName(line.speaker),
        colour: actor?.colour,
        portrait: actor === undefined ? undefined : context.assets.srcOf?.(portraitAliasFor(content, actor.characterId, actor.colour, mood)),
      };
    };
    /** A bark in the player's language, with its speaker's name and portrait. */
    const lineOf = (chapter: StoryChapter, moment: number, at: number, line: StoryLine): HudLine => {
      const who = speakerOf(line);
      return { speaker: who.speaker, portrait: who.portrait, text: storyBark(chapter.id, moment, at, line.text) };
    };
    /** A cutscene's panels as the player sees them. */
    const panelsOf = (cutscene: StoryCutscene): CutscenePanelView[] =>
      cutscene.panels.map((panel, panelIndex) => ({
        src: context.assets.srcOf?.(panel.art),
        move: panel.move,
        glims: panel.glims === true,
        lines: panel.lines.map((line, lineIndex) => ({ ...speakerOf(line), text: storyCutLine(cutscene.id, panelIndex, lineIndex, line.text) })),
      }));

    /** The story's clock for its screens: each frame's milliseconds, held while paused. */
    const clockListeners = new Set<(ms: number) => void>();
    const clock = (step: (ms: number) => void): (() => void) => {
      clockListeners.add(step);
      return () => clockListeners.delete(step);
    };
    /** The step on screen, and what it mounted. */
    let step: FlowStep | undefined;
    /** Stars the last results showed as new, for the hub to pop in. */
    let freshStars: { chapter: number; stars: readonly [boolean, boolean, boolean] } | undefined;
    let shown: ReturnType<typeof mount> | undefined;
    const clearShown = (): void => {
      if (shown !== undefined) void unmount(shown);
      shown = undefined;
    };
    this.bag.add(clearShown);

    let paused = false;
    let pauseOverlay: ReturnType<typeof mount> | undefined;
    const setPaused = (next: boolean): void => {
      if (next === paused) return;
      paused = next;
      this.hud?.setPaused(next);
      this.chapter?.run.setPaused(next);
      this.chapter?.scene.setPaused(next);
      input.setSuspended(next);
      context.gamepad.setRaceTarget(next || step?.kind !== "climb" ? undefined : input);
      if (next) {
        pauseOverlay = mount(PauseOverlay, {
          target: context.stage.overlay,
          props: {
            settings: context.settings,
            status: null,
            get leaveLabel() {
              return m.story_exit();
            },
            confirmLeave: false,
            onResume: () => setPaused(false),
            onRestart: () => {
              const chapter = step?.kind === "climb" ? step.chapter : this.chapter?.index;
              setPaused(false);
              if (chapter !== undefined) go({ kind: "climb", chapter });
            },
            // Out of the chapter, to the hub; the story's round stays open until the story itself is left.
            onLeave: () => {
              const chapter = this.chapter?.index ?? 0;
              setPaused(false);
              go({ kind: "hub", focus: chapter });
            },
          },
        });
      } else if (pauseOverlay !== undefined) {
        void unmount(pauseOverlay, { outro: true });
        pauseOverlay = undefined;
      }
    };

    const hud = new StoryHudView(context.stage.overlay, { prompts: story.prompts, settings: context.settings });
    this.hud = hud;
    this.bag.add(() => {
      hud.destroy();
      this.hud = undefined;
    });

    const cursor = new CursorRunner(document.body, { paused: () => paused });
    this.bag.add(cursor.attach(window));
    let cursorMethod: InputMethod | undefined;

    let loading = false;
    const closeChapter = (): void => {
      const chapter = this.chapter;
      this.chapter = undefined;
      chapter?.bag.dispose();
    };
    this.bag.add(closeChapter);

    const openChapter = async (index: number): Promise<void> => {
      const spec = chapters[index]!;
      loading = true;
      hud.setHidden(true);
      try {
        await loadRaceAssets(context, m.shell_loading_story(), {
          songAlias: spec.song.audioAlias,
          songGroup: `song-${spec.song.id}`,
          stageId: spec.stage.id,
        });
      } finally {
        loading = false;
      }
      if (this.bag.isDisposed) return;

      const bag = new DisposeBag();
      const run = new StoryRun({
        chapter: spec,
        actors: actorsContent,
        tuning,
        characterId: hero.characterId,
        colour: hero.colour,
        names: { you: m.ready_seat_you(), actor: actorName },
        revisions: { contentRevision: found.contentRevision, rulesetRevision: found.rulesetRevision },
        sample: () => {
          const intent = this.steer === undefined ? input.sample() : this.steer(run, run.state.tick);
          whoosh.observe(intent);
          return intent;
        },
      });
      bag.add(() => run.dispose());
      const bed = bedForStage(spec.stage);
      context.audio.playBed?.(bed);
      bag.add(() => context.audio.stopBed?.(bed));
      const scene = new RaceScene(context, {
        tuning,
        localPlayerId: () => run.playerId,
        stage: spec.stage,
        song: spec.song,
        isStory: true,
        hud: { settings: context.settings, solo: true, onPause: () => setPaused(true) },
      });
      scene.startSong();
      bag.add(() => scene.destroy());
      const layer = new StoryLayer(scene.storyLayer(), spec);
      bag.add(() => layer.destroy());
      const feel = new StoryFeel({
        play: (moment) => scene.playMoment(moment),
        cue: (alias, options) => context.audio.cue(alias, { bus: alias.startsWith("ui.") ? "ui" : "effects", ...options }),
        player: () => run.state.players[run.playerId]!,
        floorsOnScreen: () =>
          run.state.course.floors.flatMap((floor) => {
            const top = run.director.floorTopY(floor.index);
            return scene.pagePoint({ x: 0, y: top }).onScreen ? [{ x: floorXOf(run, floor.index), y: top + tuning.PLAYER_HEIGHT / 2 }] : [];
          }),
      });
      const touch = mountTouchInput(context, input);
      if (touch !== undefined) bag.add(() => touch.release());
      hud.setGlims(0, run.director.glims.total);
      hud.setSnow(spec.stage.id === "snow-shrine");
      hud.setObjective(undefined);
      hud.setPointer(undefined);
      hud.setChip(undefined);
      hud.setLine(undefined);
      // The HUD stays hidden until the stage's first frames are drawn and its band measured (in draw).
      anchorAtMs = Number.NEGATIVE_INFINITY;
      this.chapter = {
        index,
        spec,
        run,
        scene,
        layer,
        feel,
        talk: new StoryTalk<HudLine>(),
        bag,
        clockMs: 0,
        finished: false,
        finishedAtTick: undefined,
        chip: spec.teaches.includes("move") ? "move" : undefined,
        lookUntilMs: undefined,
        result: undefined,
        drawn: 0,
        onShown: undefined,
      };
      if (paused) run.setPaused(true);
    };

    this.bag.addListener(window, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Escape" || key.defaultPrevented) return;
      // Out of a climb Escape is the cutscene's and the credits' Skip; only a pause already open hears it.
      if (step?.kind !== "climb" && !paused) return;
      key.preventDefault();
      setPaused(!paused);
    });
    this.bag.add(() => {
      if (pauseOverlay !== undefined) void unmount(pauseOverlay);
      pauseOverlay = undefined;
    });
    this.pauseForMenu = () => setPaused(true);
    this.bag.add(() => (this.pauseForMenu = undefined));
    const releaseLifecycle = context.hosting?.onLifecycle((lifecycle) => {
      if (lifecycle.state === "background") setPaused(true);
    });
    if (releaseLifecycle !== undefined) this.bag.add(releaseLifecycle);

    let anchorAtMs = Number.NEGATIVE_INFINITY;
    let doneAtMs: number | undefined;

    const cutsceneNamed = (id: string): StoryCutscene | undefined => story.cutscenes?.find((cutscene) => cutscene.id === id);
    /** The glims the save holds, over every chapter: the ones that rise at the top. */
    const savedGlims = (): number => Object.values(context.settings.value.story.chapters).reduce((sum, record) => sum + record.glims, 0);
    /** Plays a cutscene's bed: an ambience loops in the bed slot, a song in the music slot. Returns its stop. */
    const playBed = (alias: string): (() => void) => {
      if (alias.startsWith("ambience.")) {
        context.audio.playBed?.(alias);
        return () => context.audio.stopBed?.(alias);
      }
      const song = chapters.map((chapter) => chapter.song).find((candidate) => candidate.audioAlias === alias);
      let stopped = false;
      void (async () => {
        if (song !== undefined) await context.audio.load(`song-${song.id}`).catch(() => undefined);
        if (!stopped) context.audio.play(alias);
      })();
      return () => {
        stopped = true;
        context.audio.stop(alias);
      };
    };

    /** Puts a step of the story on screen. */
    const go = (next: FlowStep | undefined): void => {
      clearShown();
      step = next;
      if (next === undefined) return;
      context.gamepad.setRaceTarget(paused || next.kind !== "climb" ? undefined : input);
      input.setSuspended(paused || next.kind !== "climb");
      const reduced = reducedMotion();
      switch (next.kind) {
        case "hub": {
          closeChapter();
          hud.setHidden(true);
          const progress = context.settings.value.story;
          const fresh = freshStars;
          freshStars = undefined;
          const hubChapters: HubChapter[] = chapters.map((chapter, index) => {
            const record = recordOf(progress, chapter.id);
            const first = cutsceneNamed(chapter.before)?.panels[0];
            return {
              title: storyTitle(chapter),
              art: first === undefined ? undefined : context.assets.srcOf?.(first.art),
              stars: record.stars,
              glims: record.glims,
              glimsTotal: chapterGlims(chapter),
              locked: !unlocked(progress, index),
            };
          });
          const sum = totals(progress, chapters.map((chapter) => chapter.id));
          shown = mount(StoryHub, {
            target: context.stage.overlay,
            props: {
              chapters: hubChapters,
              totals: { ...sum, starsTotal: chapters.length * 3, glimsTotal: hubChapters.reduce((total, chapter) => total + chapter.glimsTotal, 0) },
              focus: next.focus,
              fresh,
              reduced,
              onPlay: (chapter: number) => {
                if (step === next && unlocked(context.settings.value.story, chapter)) go(after(story as StoryContent, { kind: "hub", focus: chapter }));
              },
              onBack: () => {
                if (step !== next) return;
                endRound("quit");
                close(origin);
              },
            },
          });
          return;
        }
        case "results": {
          const current = this.chapter;
          const result = current?.result;
          if (current === undefined || result === undefined) {
            go(after(story as StoryContent, next));
            return;
          }
          // The climb freezes under the results.
          current.run.setPaused(true);
          current.scene.setPaused(true);
          hud.setHidden(true);
          let earnedSoFar = 0;
          shown = mount(ChapterResults, {
            target: context.stage.overlay,
            props: {
              number: next.chapter + 1,
              title: storyTitle(current.spec),
              stars: result.stars,
              glims: result.run.glims,
              glimsTotal: result.run.totalGlims,
              time: formatElapsed(Math.round(result.run.ms / TICK_MS)),
              par: clockOf(result.run.parSeconds),
              clock,
              reduced,
              onStar: (_index: number, earned: boolean) => {
                if (!earned) return;
                earnedSoFar += 1;
                context.audio.cue("ui.pop", { bus: "ui", gain: 0.5 + earnedSoFar * 0.15 });
                if (earnedSoFar === 3) context.audio.cue("sfx.crowdCheer", { bus: "effects", gain: 0.2 });
              },
              onNext: () => {
                if (step === next) go(after(story as StoryContent, next));
              },
              onAgain: () => {
                if (step === next) go({ kind: "climb", chapter: next.chapter });
              },
              onChapters: () => {
                if (step !== next) return;
                freshStars = { chapter: next.chapter, stars: result.fresh };
                go({ kind: "hub", focus: next.chapter });
              },
            },
          });
          return;
        }
        case "cutscene":
        case "ending": {
          closeChapter();
          hud.setHidden(true);
          const cutscene = cutsceneNamed(next.cutscene);
          if (cutscene === undefined) {
            go(after(story as StoryContent, next));
            return;
          }
          // The chapter's stage and song load quietly behind its cutscene.
          if (next.kind === "cutscene") {
            const chapter = chapters[next.chapter]!;
            void preloadRaceAssets(context, chapter.stage.id, chapter.song.id).catch(() => undefined);
          }
          const stopBed = playBed(cutscene.bed);
          this.bag.add(stopBed);
          shown = mount(Cutscene, {
            target: context.stage.overlay,
            props: {
              panels: panelsOf(cutscene),
              glims: next.kind === "ending" ? savedGlims() : 0,
              clock,
              reduced,
              onTick: () => context.audio.cue("ui.tick", { bus: "ui", gain: 0.15 }),
              onDone: () => {
                stopBed();
                if (step === next) go(after(story as StoryContent, next));
              },
            },
          });
          return;
        }
        case "climb":
          closeChapter();
          void (async () => {
            await openChapter(next.chapter);
            const current = this.chapter;
            if (step !== next || current === undefined) return;
            // The card shows over the drawn stage, never over a blank screen.
            if (current.drawn < SHOWN_AFTER_FRAMES) await new Promise<void>((resolve) => (current.onShown = resolve));
            if (step !== next || this.chapter !== current) return;
            context.audio.cue("ui.title", { bus: "ui" });
            shown = mount(TitleCard, {
              target: context.stage.overlay,
              props: {
                number: next.chapter + 1,
                title: storyTitle(chapters[next.chapter]!),
                clock,
                reduced,
                onDone: () => {
                  if (step === next) clearShown();
                },
              },
            });
          })();
          return;
        case "finale": {
          closeChapter();
          hud.setHidden(true);
          const ending = story.ending!;
          const lastPanel = cutsceneNamed(ending.cutscene)?.panels.at(-1);
          shown = mount(StoryFinale, {
            target: context.stage.overlay,
            props: {
              thesis: ending.thesis.map((line, index) => storyThesis(index, line)),
              songs: [...new Set(chapters.map((chapter) => chapter.song.displayName))],
              last: { ...speakerOf(ending.last), text: storyLast(ending.last.text) },
              art: lastPanel === undefined ? undefined : context.assets.srcOf?.(lastPanel.art),
              primaryLabel: origin === "Lobby" ? m.story_race_now() : m.story_play_now(),
              clock,
              reduced,
              onLast: () => endRound("complete"),
              onPrimary: () => close("Lobby"),
              onChapters: () => go({ kind: "hub", focus: firstUnfinished(context.settings.value.story, chapters.length) }),
            },
          });
          return;
        }
      }
    };

    /** The story's own reactions to its events: words, chips, the HUD's cues and the camera. */
    const react = (current: Chapter, events: readonly StoryEvent[], intent: { left: boolean; right: boolean; fastFall: boolean }): void => {
      const { run, scene, talk, spec } = current;
      const reduced = reducedMotion();
      for (const event of events) {
        switch (event.kind) {
          case "say":
            // The goal's words come straight after the climb's last: nothing older waits ahead of them.
            if (spec.moments[event.moment]?.when.kind === "goal") talk.finish(current.clockMs);
            // A line that names a lamp's hard landing brings the fast-fall chip back.
            talk.say(
              event.lines.map((line, at) => lineOf(spec, event.moment, at, line)),
              // A goal's and a phase's words are the story's turns: never dropped for a later, smaller line (review R5).
              ["goal", "phase"].includes(spec.moments[event.moment]?.when.kind ?? ""),
            );
            // A beat's first line takes the screen now if nothing is on it, so a beat fired on the same tick as a later one is still heard.
            talk.update(current.clockMs);
            break;
          case "glim": {
            const at = scene.pagePoint(event.at);
            const frame = context.stage.overlay.getBoundingClientRect();
            hud.flyGlim({ left: at.left - frame.left, top: at.top - frame.top }, reduced);
            break;
          }
          case "lampOpen":
            hud.flyGlim(overlayPoint(context, scene, event.at), reduced);
            hud.flyGlim(overlayPoint(context, scene, { x: event.at.x + 16, y: event.at.y + 12 }), reduced);
            if (current.chip === "fastFall") current.chip = undefined;
            break;
          case "lampRattle":
          case "phase":
            break;
          case "safeSpot":
            hud.safeSpot();
            break;
          case "lavaClose":
            hud.lavaClose();
            break;
          case "lookAt":
            scene.lookAt(actorPlayerId(event.actor));
            current.lookUntilMs = current.clockMs + event.ticks * TICK_MS;
            break;
          case "done":
            if (!current.finished) {
              current.finished = true;
              current.finishedAtTick = run.state.tick;
              // A chapter with no words for its goal still ends on time: the old talk goes.
              if (!spec.moments.some((moment) => moment.when.kind === "goal")) talk.finish(current.clockMs);
              const glims = run.director.glims;
              const result: ChapterResult = { glims: glims.carried, totalGlims: glims.total, ms: run.director.elapsedMs, parSeconds: spec.parSeconds };
              const before = recordOf(context.settings.value.story, spec.id).stars;
              const stars = starsFor(result);
              current.result = { run: result, stars, fresh: [stars[0] && !before[0], stars[1] && !before[1], stars[2] && !before[2]] };
              context.settings.update({
                story: recordFinish(context.settings.value.story, current.index, spec.id, result),
                ...(current.index === 0 ? { seen: { tutorial: true } } : {}),
              });
            }
            break;
          default:
            break;
        }
      }
      // The fast-fall lesson: shown when the first lamp comes into sight, and again after soft landings.
      if (spec.teaches.includes("fastFall")) {
        for (const event of events) {
          if (event.kind !== "say") continue;
          const kind = spec.moments[event.moment]?.when.kind;
          if (kind === "lampSeen" || kind === "lampSoft" || kind === "needLamp") current.chip = "fastFall";
        }
      }
      // A chip goes the moment its move is made.
      if (current.chip === "move" && (intent.left || intent.right)) current.chip = undefined;
      if (current.chip === "fastFall" && intent.fastFall) current.chip = undefined;
    };

    /** The objective chip's words and the pointer, from the director's objective. */
    const objective = (current: Chapter): void => {
      const { run, scene, spec } = current;
      const director = run.director;
      const goal = director.objective;
      const offset = spec.floorOffset;
      const frame = context.stage.overlay.getBoundingClientRect();
      const clampLeft = (left: number): number => Math.min(frame.width - 48, Math.max(48, left - frame.left));
      let pointer: HudPointer | undefined;
      let text: string;
      if (director.done) {
        text = m.story_goal_reach({ floor: offset + (goal.kind === "reach" ? goal.floor : 0) });
      } else if (goal.kind === "rescue") {
        text = m.story_goal_rescue({ name: actorName(goal.actor) });
        const racer = run.state.players[actorPlayerId(goal.actor)]!;
        const at = scene.pagePoint(racer);
        if (!at.onScreen) {
          pointer = { direction: racer.y < run.state.players[run.playerId]!.y ? "down" : "up", floors: Math.max(1, Math.abs(director.playerFloor - goal.floor)), left: clampLeft(at.left) };
        }
      } else if (goal.lampsNeeded > 0) {
        text = m.story_goal_lamp();
        const shut = (spec.lamps ?? []).filter((floor) => !director.pickups.open.has(floor));
        const nearest = shut.sort((a, b) => Math.abs(a - director.playerFloor) - Math.abs(b - director.playerFloor))[0];
        if (nearest !== undefined) {
          const y = director.floorTopY(nearest);
          const at = scene.pagePoint({ x: floorXOf(run, nearest), y });
          if (!at.onScreen) {
            pointer = { direction: nearest < director.playerFloor ? "down" : "up", floors: Math.max(1, Math.abs(director.playerFloor - nearest)), left: clampLeft(at.left) };
          }
        }
      } else if (director.phase.lava?.under === "player") {
        text = m.story_goal_climb({ floor: offset + goal.floor });
      } else {
        text = m.story_goal_reach({ floor: offset + goal.floor });
      }
      hud.setObjective(text);
      hud.setPointer(pointer);
      const finalGoal = [...spec.phases].reverse().find((phase) => phase.goal.kind === "reach")?.goal;
      scene.setFloorReading({
        floor: offset + director.playerFloor,
        goal: offset + (finalGoal?.kind === "reach" ? finalGoal.floor : director.playerFloor),
      });
    };

    const draw = (deltaMs: number, elapsedMs: number): void => {
      if (inputMethod.method !== cursorMethod) {
        cursorMethod = inputMethod.method;
        if (cursorMethod === "gamepad") cursor.noteInput("gamepad");
      }
      cursor.tick();
      if (!paused) for (const listener of [...clockListeners]) listener(deltaMs);

      const current = this.chapter;
      if (current === undefined || loading) return;
      const { run, scene, talk, layer, feel } = current;
      const snapshot = run.advance(elapsedMs);
      if (!paused) current.clockMs += elapsedMs;
      this.lastTick = snapshot.tick;
      const events = run.takeStoryEvents();
      for (const { alias, ...options } of cuesForEvents(snapshot.events, run.playerId, snapshot)) context.audio.cue(alias, options);
      for (const event of snapshot.events) {
        if (event.type !== "floorLanded" || event.playerId !== run.playerId) continue;
        for (const { alias, ...options } of landingSounds(event.floorIndex, { floorCount: snapshot.floorCount })) context.audio.cue(alias, options);
      }
      scene.noteResets(snapshot.events);
      scene.noteRoomEvents(snapshot.events);
      scene.setStoryEdge(run.edge);
      scene.showOut(run.out);
      // The HUD's clock is the chapter's own: from the first input to the goal, as its results and stars count it.
      const clockTicks = Math.round(run.director.elapsedMs / TICK_MS);
      scene.draw({ ...snapshot, raceStartedAtTick: snapshot.tick - clockTicks }, deltaMs, undefined, undefined, undefined, false, run.drainSideContacts());
      feel.play(events);
      layer.frame({ state: run.state, director: run.director, events, deltaMs: paused ? 0 : deltaMs, reduced: reducedMotion() });
      react(current, events, input.sample());

      if (current.lookUntilMs !== undefined && current.clockMs >= current.lookUntilMs) {
        current.lookUntilMs = undefined;
        scene.lookAt(undefined);
      }

      const nowMs = current.clockMs;
      let measured = false;
      if (nowMs - anchorAtMs >= ANCHOR_EVERY_MS) {
        const floors = context.stage.overlay.querySelector('[data-testid="hud-floors"]')?.getBoundingClientRect();
        const metrics = context.stage.overlay.querySelector("[data-hud-metrics]")?.getBoundingClientRect();
        const frame = context.stage.overlay.getBoundingClientRect();
        if (floors !== undefined && metrics !== undefined && metrics.height > 0) {
          hud.setAnchor(metrics.bottom - frame.top + 8, floors.left - frame.left);
          // Measured: the next in a while. Not yet laid out: again next frame.
          anchorAtMs = nowMs;
          measured = true;
        }
      }
      hud.setGlims(run.director.glims.carried, run.director.glims.total);
      const gust = run.director.gust;
      hud.setWind(gust.blowing !== undefined ? { direction: gust.blowing, blowing: true } : gust.warned !== undefined ? { direction: gust.warned, blowing: false } : undefined);
      objective(current);
      hud.setChip(current.chip);
      hud.setLine(talk.update(current.clockMs));
      if (current.drawn < SHOWN_AFTER_FRAMES) {
        current.drawn += 1;
        if (current.drawn >= SHOWN_AFTER_FRAMES) {
          if (!measured) anchorAtMs = Number.NEGATIVE_INFINITY;
          hud.setHidden(false);
          const shown = current.onShown;
          current.onShown = undefined;
          shown?.();
        }
      }

      // Done: the last words go by, a breath, then the next chapter or the way out.
      if (current.finished) {
        const since = run.state.tick - (current.finishedAtTick ?? run.state.tick);
        const overdue = since >= AFTER_DONE_TICKS + goalWordsTicks(current.spec);
        if (!overdue) {
          if (!talk.idle) return;
          doneAtMs ??= nowMs;
          if (nowMs - doneAtMs < AFTER_WORDS_MS) return;
        }
        doneAtMs = undefined;
        if (step?.kind === "climb") go(after(story as StoryContent, step));
      }
    };
    // An inspection build publishes the step and the story bot's advice, worked out once a tick on the state just drawn.
    if (VISUAL_INSPECTION_ENABLED) {
      let advice = { left: false, right: false, fastFall: false };
      let advisor: { run: StoryRun; tick: number; bot: (run: StoryRun, tick: number) => typeof advice } | undefined;
      let makeBot: ((chapter: StoryChapter) => (run: StoryRun, tick: number) => typeof advice) | undefined;
      void import("./story-bot").then((module) => (makeBot = (chapter) => module.storyBot(chapter)));
      // The bot at the controls itself, inside the tick: the same run every time, where keys sent from outside land a frame early or late.
      let pilot: { run: StoryRun; bot: (run: StoryRun, tick: number) => typeof advice } | undefined;
      const drive = (on: boolean): boolean => {
        if (makeBot === undefined) return false;
        const make = makeBot;
        this.steerWith(
          on
            ? (run, tick) => {
                const spec = this.chapter?.spec;
                if (pilot?.run !== run && spec !== undefined) pilot = { run, bot: make(spec) };
                return pilot?.run === run ? { ...pilot.bot(run, tick), reset: false } : { left: false, right: false, fastFall: false, reset: false };
              }
            : undefined,
        );
        return true;
      };
      this.bag.add(
        installStoryInspection(() => {
          const current = this.chapter;
          if (current !== undefined && makeBot !== undefined) {
            if (advisor?.run !== current.run) advisor = { run: current.run, tick: -1, bot: makeBot(current.spec) };
            const tick = current.run.state.tick;
            if (tick !== advisor.tick) {
              advisor.tick = tick;
              const { left, right, fastFall } = advisor.bot(current.run, tick);
              advice = { left, right, fastFall };
            }
          }
          const edge = current?.run.director.lavaEdge;
          const lava = edge === undefined || current === undefined ? undefined : { under: edge.under, onScreen: current.scene.pagePoint({ x: 0, y: edge.y - 8 }).onScreen, phaseTicks: current.run.director.phaseTicks };
          return { step: step?.kind, chapter: current?.index, tick: current?.run.state.tick ?? 0, doneAtTick: current?.finishedAtTick, lamps: current?.run.director.pickups.open.size ?? 0, lava, want: advice, drive };
        }),
      );
    }

    const ticker = context.stage.app?.ticker;
    if (ticker !== undefined) {
      this.bag.add(addRenderPass(ticker, "gameplayDraw", () => draw(ticker.deltaMS, ticker.elapsedMS ?? ticker.deltaMS)));
    }

    context.stage.overlay.dataset["screen"] = "story";

    go({ kind: "hub", focus: firstUnfinished(context.settings.value.story, chapters.length) });
  }

  protected override onExit(): void {
    if (this.roundOpen) this.context?.hosting?.roundEnd("quit");
    this.roundOpen = false;
    this.lastTick = 0;
  }
}

/** The x of a floor's centre now (it rides a moving floor). */
function floorXOf(run: StoryRun, index: number): number {
  const state = run.state;
  return floorX(state, state.course.floors[index]!) + state.tuning.FLOOR_WIDTH / 2;
}

/** A world point in the overlay's own pixels. */
function overlayPoint(context: ScreenContext, scene: RaceScene, point: { x: number; y: number }): { left: number; top: number } {
  const at = scene.pagePoint(point);
  const frame = context.stage.overlay.getBoundingClientRect();
  return { left: at.left - frame.left, top: at.top - frame.top };
}
