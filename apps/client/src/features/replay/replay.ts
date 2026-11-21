/**
 * Replay: the race just finished, watched again (race-options spec §7).
 *
 * The same scene a race draws, fed by a `ReplayRun` re-simulating the room's
 * record here rather than by the room, as the story is fed by its run. The
 * viewer is the client's own (D-O6): it keeps playing whatever the room does,
 * says so when the room is back in the ready room, and leaves for the room
 * when the room moves past it.
 */

import { stageName } from "../i18n/content";
import * as m from "../../paraglide/messages.js";
import { TICK_HZ, TICK_MS } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { ScreenId } from "../profile/screen-state";
import { raceSong } from "../audio";
import { DroneHold } from "../race/drone-hold";
import { FinishSequence } from "../race/finish-sequence";
import { RaceAnnouncer } from "../race/race-announcer";
import { bedForStage, cuesForEvents, ladderHeight, landingSounds, type Sound } from "../race/race-cues";
import { RaceScene, loadRaceAssets } from "../race/race-scene";
import { addRenderPass } from "../platform/render-order";
import { ReplayRun } from "./replay-run";
import { reducedMotion } from "../kit/motion";
import { ReplayControlsView, nextSpeed, type ReplayControlsActions } from "./replay-controls.svelte";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { raceKey } from "@floor-fifty/shared/unlocks/conditions";
import { ReplayShare } from "./replay-share.svelte";
import { ReplayVideoView } from "./replay-video.svelte";
import { winnerName } from "../race/results";

export class ReplayScreen extends BaseScreen {
  readonly name: ScreenId = "Replay";

  private run: ReplayRun | undefined;

  /** The tick the replay shows, for tests. */
  tick(): number | undefined {
    return this.run?.tick;
  }

  /** Whether a seek is still catching up, for tests. */
  seeking(): boolean {
    return this.run?.seeking === true;
  }

  protected async onEnter(context: ScreenContext): Promise<void> {
    let left = false;
    /** Leaves once: for the room when it has moved on, else back to results. */
    const exit = (toRoom: boolean): void => {
      if (left) return;
      left = true;
      context.publishPresentationEvent(toRoom || roomMoved ? "ui.replay-exit-to-room" : "ui.replay-exit", {});
    };
    let roomMoved = false;

    const bytes = context.network.latestReplay();
    const content = context.content.current();
    if (bytes === undefined || content === undefined) {
      exit(false);
      return;
    }
    // Results checked the replay before coming here; a refusal now means the
    // content changed under it, and results is where that is said.
    const opened = await ReplayRun.open(bytes, content);
    if (!(opened instanceof ReplayRun)) {
      exit(false);
      return;
    }
    const run = opened;
    this.run = run;
    // Registered first, so it is released last: everything after reads it.
    this.bag.add(() => {
      run.dispose();
      this.run = undefined;
    });
    const { header } = run.replay;

    const stage = content.content.stages.find((entry) => entry.id === header.stageId) ?? content.content.stages[0];
    const song = raceSong(content, header.songId);
    await loadRaceAssets(context, m.shell_loading_replay(), {
      songAlias: song?.audioAlias,
      songGroup: song === undefined ? undefined : `song-${song.id}`,
      stageId: header.stageId,
    });
    // Not waited on: a refused resume never settles (see `gameplay.ts`).
    void context.audio.unlock().catch(() => undefined);
    if (this.context !== context) return;

    const seats = header.seats;
    const watching = seats.find((seat) => seat === context.network.localPlayerId);
    let follow: PlayerId = watching ?? seats[0]!;
    const nameOf = (id: PlayerId): string => header.go.players[id]?.name ?? "";

    const bed = bedForStage(stage);
    context.audio.playBed?.(bed);
    this.bag.add(() => context.audio.stopBed?.(bed));

    const scene = new RaceScene(context, {
      tuning: header.go.tuning,
      localPlayerId: () => follow,
      stage,
      song,
      hud: { settings: context.settings, solo: seats.length === 1, replay: true },
      // The juice's own sounds follow the replay's keys, so they sound in each playthrough.
      cueKeyPrefix: () => `replay:${run.playthrough}:`,
    });
    this.bag.add(() => scene.destroy());

    // The song from GO, at the replay's rate (spec §7.2). It plays while the
    // race does: a pause or a seek stops it, and it starts again where the
    // race is. The rate is the engine's to keep across those restarts.
    let songPlaying = false;
    const syncSong = (): void => {
      if (song === undefined) return;
      const wanted = !run.isPaused && !run.seeking;
      if (wanted && !songPlaying) context.audio.play(song.audioAlias, run.position * TICK_MS);
      else if (!wanted && songPlaying) context.audio.stop(song.audioAlias);
      songPlaying = wanted;
    };
    const stopSong = (): void => {
      if (song !== undefined && songPlaying) context.audio.stop(song.audioAlias);
      songPlaying = false;
    };
    context.audio.setMusicRate?.(run.speed);
    syncSong();

    let announcer = new RaceAnnouncer();
    /** The finish's slow motion, from the winner's landing until the end card. */
    let finish: FinishSequence | undefined;
    /** Presentation time, which stands still while the replay is paused or seeking. */
    let wallMs = 0;
    /** Holding on the last frame, with Watch again and Back to results. */
    let finished = false;
    // The same hum the race plays, for the racer followed, on the replay's
    // own clock; quiet while paused, seeking or held on the last frame.
    const drone = new DroneHold(context.audio);
    this.bag.add(() => drone.stop());
    const clearFinish = (): void => {
      if (finish !== undefined) context.audio.slowMusic?.(1);
      finish = undefined;
      finished = false;
    };
    /**
     * Silences this replay's cues, the line speaking and the ones queued behind
     * it: the winner's calls wait seconds behind GAME, and a seek, a restart or
     * a leave must not let them be said over another moment or another screen.
     */
    const silenceCues = (): void => {
      if (context.audio.stopCues !== undefined) context.audio.stopCues("replay:");
      else context.audio.cancelPending?.("replay:");
    };
    this.bag.add(() => {
      stopSong();
      silenceCues();
      if (finish !== undefined) context.audio.slowMusic?.(1);
      context.audio.setMusicRate?.(1);
    });

    const restart = (): void => {
      silenceCues();
      run.restart();
      run.setPaused(false);
      announcer = new RaceAnnouncer();
      clearFinish();
      scene.focusOn(follow, true);
      stopSong();
      syncSong();
    };
    const setPaused = (paused: boolean): void => {
      run.setPaused(paused);
      syncSong();
    };
    // A finger or the mouse on the bar holds the replay, and letting go plays
    // on if it was playing. The keyboard and the controller only seek.
    let scrub: { resume: boolean } | undefined;

    const actions: ReplayControlsActions = {
      // On the end card there is nothing to play; Watch again is the way back in.
      onPlayPause: () => {
        if (!finished) setPaused(!run.isPaused);
      },
      onSpeed: () => {
        run.speed = nextSpeed(run.speed);
        context.audio.setMusicRate?.(run.speed);
      },
      onRestart: restart,
      onFollow: (step) => {
        // Alone in the race there is no one else to follow.
        if (seats.length < 2) return;
        follow = seats[(seats.indexOf(follow) + step + seats.length) % seats.length]!;
        scene.focusOn(follow, true);
      },
      onExit: () => exit(false),
      onWatchAgain: restart,
      onBack: () => exit(false),
      onSeek: (seconds) => {
        silenceCues();
        run.seek(seconds * TICK_HZ);
        syncSong();
      },
      onScrub: (active) => {
        if (active && scrub === undefined) {
          scrub = { resume: !run.isPaused };
          if (scrub.resume) setPaused(true);
        } else if (!active && scrub !== undefined) {
          if (scrub.resume) setPaused(false);
          scrub = undefined;
        }
      },
    };
    const controls = new ReplayControlsView(context.stage, actions);
    this.bag.add(() => controls.destroy());

    // Save video and Share video (unlockables spec §6.4, amended): the race's
    // live recording, counted for the results' round while the room still
    // shows them.
    const latest = context.network.latestSnapshot();
    const results = latest?.phase === "finished" ? latest : undefined;
    const share = new ReplayShare({
      video: () => context.raceVideo?.current,
      winner: winnerName(results),
      stageName: () => (stage === undefined ? header.stageId : stageName(stage)),
      round: results === undefined ? undefined : raceKey(results),
      progress: context.progress,
      settings: context.settings,
      content: () => context.content.current()?.content,
      colour: results?.players.find((player) => player.id === watching)?.colour ?? "scarlet",
    });
    const videoButtons = new ReplayVideoView(context.stage, share, context.raceVideo);
    this.bag.add(() => videoButtons.destroy());

    // The room, watched: back in the ready room is said, and past it the
    // viewer goes there (departure 13: a public room's clock readies everyone).
    this.bag.add(
      context.network.subscribe({
        onSnapshot: (snapshot) => {
          if (snapshot.phase === "lobby" && !roomMoved) {
            roomMoved = true;
            controls.setRoomMoved(true);
          }
          if (snapshot.phase === "select" || snapshot.phase === "countdown" || snapshot.phase === "racing") exit(true);
        },
      }),
    );

    const draw = (deltaMs: number, elapsedMs: number): void => {
      const seeking = run.seeking;
      if (!run.isPaused && !seeking) wallMs += elapsedMs;
      const slowing = finish !== undefined && !finished;
      const scale = slowing ? finish!.scale(wallMs) : 1;
      // The finish's slow motion, under the replay's own rate, as the race
      // plays it (race-flow spec §5.2), with its filter.
      if (slowing) context.audio.slowMusic?.(scale);
      const frame = run.advance(elapsedMs, scale);
      if (seeking && !frame.seeking) {
        // Landed: wherever the finish was, it is not now, unless this is the end.
        clearFinish();
        finished = frame.finished;
        scene.focusOn(follow, true);
        syncSong();
      }
      // Each cue carries its re-keyed event ID, so it sounds in this
      // playthrough though the live race sounded the same event.
      for (const { alias, ...options } of cuesForEvents(frame.events, follow, frame.snapshot)) context.audio.cue(alias, options);
      // The followed racer's landings wait for the draw, so a slam the draw
      // hears can replace them, as in the live race (Wonder spec §3.2).
      const landingCues: Sound[] = [];
      for (const event of frame.events) {
        if (event.type === "raceFinished" && finish === undefined) {
          finish = new FinishSequence(wallMs, reducedMotion());
          scene.focusOn(event.winnerId, reducedMotion());
        }
        if (event.type !== "floorLanded" || event.playerId !== follow) continue;
        landingCues.push(...landingSounds(event.floorIndex, { floorCount: ladderHeight(frame.snapshot) }));
      }
      scene.noteResets(frame.events);
      // The re-simulation is this replay's authority: its events reach the
      // juice as the room's do, so the pops and bursts play (polish spec §4.1).
      scene.noteRoomEvents(frame.events);
      scene.announce(announcer.observe(frame.snapshot));
      scene.draw(frame.snapshot, deltaMs * scale, undefined, undefined, frame.snapshot.tick, landingCues.length > 0);
      if (!scene.localSlammed) for (const { alias, ...options } of landingCues) context.audio.cue(alias, options);
      if (run.isPaused || frame.seeking || finished) drone.stop();
      else drone.update(frame.snapshot, follow, frame.snapshot.tick);
      if (frame.driftedNow) controls.notice(m.replay_drifted());
      if (frame.finished && !finished && (finish === undefined || finish.done(wallMs))) {
        finished = true;
        // The end card plays the song on at the replay's own rate.
        if (finish !== undefined) context.audio.slowMusic?.(1);
      }
      controls.update({
        positionS: (run.progress() * run.length) / TICK_HZ,
        lengthS: run.length / TICK_HZ,
        paused: run.isPaused,
        speed: run.speed,
        following: nameOf(follow),
        // The colour the followed racer chose, from the race's opening state.
        followingColour: header.go.players[follow]?.colour ?? "scarlet",
        held: finished,
        // The end card's standings, in Results' order (audit remediation).
        standings: finished ? frame.snapshot.standings.map((id) => nameOf(id)) : [],
      });
    };
    const ticker = context.stage.app?.ticker;
    if (ticker !== undefined) {
      this.bag.add(addRenderPass(ticker, "gameplayDraw", () => draw(ticker.deltaMS, ticker.elapsedMS ?? ticker.deltaMS)));
    }

    context.stage.overlay.dataset["screen"] = "replay";
  }
}
