/**
 * GameEnd.
 *
 * Lifecycle only. It creates the room store, mounts the results panel, and
 * forwards the two ways out.
 *
 * There is no code path here that orders players or picks a winner: the order
 * comes from `snapshot.standings` and the winner from `snapshot.winnerId`, both
 * read by `features/race/results.ts`. If the snapshot does not say, this screen does not
 * say either.
 *
 * The room clock runs in every phase, so a finished room keeps broadcasting at
 * 20 Hz for as long as the results are on screen. The actions survive that
 * because `ResultsPanel` keys nothing on snapshot data -- see its header.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerSnapshot } from "@floor-fifty/shared/common/protocol";
import { mount, unmount } from "svelte";
import type { ScreenId } from "../profile/screen-state";
import ResultsPanel from "./ResultsPanel.svelte";
import { orderedResults, winnerName } from "../race/results";
import { createRoomStore, type RoomStore } from "../net/store/room-store.svelte";
import { NonGameplayBackdrop } from "../render/non-gameplay-backdrop";
import { effectiveQuality, rebuildOnQuality } from "../render/quality-rebuild";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { raceSong } from "../audio";
import { raceKey } from "@floor-fifty/shared/unlocks/conditions";
import { grantOf, raceFactsOf, type UnlockGrant } from "../net/unlock-grant";
import { UnlockHolder } from "../net/unlock-holder.svelte";
import { UnlockPreview } from "../audio/unlock-preview";
import { ReplayRun } from "../replay/replay-run";
import { createRefusal, createReplayAvailability } from "../replay/store/replay-availability.svelte";

export class GameEndScreen extends BaseScreen {
  readonly name: ScreenId = "GameEnd";

  private store: RoomStore | undefined;
  private unlockHolder: UnlockHolder | undefined;

  protected async onEnter(context: ScreenContext): Promise<void> {
    await context.assets.loadBundle("menu");
    // Rebuilt live when the player changes the graphics quality (§3.1.2).
    const backdrop = rebuildOnQuality(context.settings, (quality) =>
      new NonGameplayBackdrop(context.stage, {
        quality: effectiveQuality(quality),
        still: () => !context.settings.value.display.stageEffects,
      }),
    );
    this.bag.add(() => backdrop.dispose());

    const store = createRoomStore(context.network);
    this.store = store;
    this.bag.add(() => {
      store.dispose();
      this.store = undefined;
    });

    // This device's unlocks (unlockables spec §5.2): the finished race is
    // judged once, by its key, so a reload onto these results grants nothing
    // twice. The round's one grant, if any, waits in the holder for the banner.
    // A friend's Race again may have taken the room back to the lobby before
    // these results mounted; the race is still judged, from the room's last
    // finished snapshot.
    const unlock = new UnlockHolder();
    this.unlockHolder = unlock;
    this.bag.add(() => {
      this.unlockHolder = undefined;
    });
    const latest = context.network.latestSnapshot();
    const finished = latest?.phase === "finished" ? latest : context.network.latestFinished?.();
    // A seat this client does not know yet is not judged: the key would be
    // spent on a race that could grant nothing, and results that learn the
    // seat later could not count it.
    const local = context.network.localPlayerId;
    if (finished !== undefined && local !== undefined && context.progress !== undefined) {
      const granted = context.progress.judge(raceFactsOf(finished, local), raceKey(finished));
      const current = context.content.current()?.content;
      const colour = finished.players.find((player) => player.id === local)?.colour ?? "scarlet";
      if (granted !== undefined && current !== undefined) unlock.current = grantOf(current, granted, colour);
    }

    // A granted song's results window plays under its banner (§7.1), once the
    // race song's own results section has started, so neither overwrites the
    // other in the one music slot.
    const preview = new UnlockPreview(context.audio);
    this.bag.add(() => preview.dispose());
    let markResultsReady: () => void = () => {};
    const resultsReady = new Promise<void>((resolve) => {
      markResultsReady = resolve;
    });

    // The replay of this race (race-options spec §7.1): watched from here once
    // it has arrived, and asked for if a reload landed here without it. A
    // refused ask (the room mid-reconnect) is asked again on a later snapshot,
    // at most once a second of room time and three times in all; after that
    // the button keeps its reason (audit remediation B5).
    const replay = createReplayAvailability(context.network);
    this.bag.add(() => replay.dispose());
    const refusal = createRefusal();
    const ASK_LIMIT = 3;
    let asks = 0;
    let askedAtTick: number | undefined;
    let settled = false;
    let inFlight = false;
    const ask = (): void => {
      const snapshot = context.network.latestSnapshot();
      if (settled || inFlight || replay.available || snapshot?.phase !== "finished" || asks >= ASK_LIMIT) return;
      if (askedAtTick !== undefined && snapshot.tick < askedAtTick + TICK_HZ) return;
      asks += 1;
      askedAtTick = snapshot.tick;
      inFlight = true;
      context.network.getReplay().then(
        () => {
          inFlight = false;
          settled = true;
        },
        () => {
          inFlight = false;
        },
      );
    };
    ask();
    this.bag.add(context.network.subscribe({ onSnapshot: ask }));

    // One check at a time: a double tap opens the replay once.
    let opening = false;

    // Inside Ruken, either way out first gives the host its one natural
    // break, after results (P6 §4, D-05). The room waits in its ready lobby
    // meanwhile, and nothing here moves until the break is over; a second
    // press during it is ignored, so the player gets one break and one route.
    // Standalone there is no break and the route follows at once, as before.
    let leaving = false;
    const afterBreak = (route: () => void): void => {
      if (context.hosting?.hosted !== true) {
        route();
        return;
      }
      if (leaving) return;
      leaving = true;
      void context.hosting.naturalBreak().then(route);
    };
    const app = mount(ResultsPanel, {
      target: context.stage.overlay,
      props: {
        store,
        settings: context.settings,
        artSrc: (alias: string) => context.assets.srcOf?.(alias),
        content: () => context.content.current()?.content,
        replay,
        refusal,
        // Checked here, so a replay this client cannot play exactly is said on
        // Results rather than opened and abandoned.
        onWatchReplay: () => {
          const bytes = context.network.latestReplay();
          const content = context.content.current();
          if (opening || bytes === undefined || content === undefined) return;
          opening = true;
          void ReplayRun.open(bytes, content).then((run) => {
            opening = false;
            if (this.context !== context) {
              if (run instanceof ReplayRun) run.dispose();
              return;
            }
            if (!(run instanceof ReplayRun)) {
              refusal.message = run.message;
              return;
            }
            run.dispose();
            context.publishPresentationEvent("ui.watch-replay", {});
          });
        },
        onRaceAgain: () =>
          afterBreak(() => {
            // The room and its socket survive: `Race Again` returns to the same
            // ready room rather than making the players swap a code again.
            //
            // Published once the network call has settled either way, so a
            // route can never overtake the room lifecycle it depends on. A
            // refusal still leaves the screen, with the room's own state
            // deciding what the menu then shows.
            void context.network
              .raceAgain()
              .catch(() => undefined)
              .finally(() => context.publishPresentationEvent("ui.race-again-settled", {}));
          }),
        onReturnToMenu: () =>
          afterBreak(() => {
            void context.network
              .leaveRoom()
              .catch(() => undefined)
              .finally(() => context.publishPresentationEvent("ui.return-to-menu-settled", {}));
          }),
        unlock,
        onUnlockShown: (grant: UnlockGrant) => {
          if (grant.kind === "song") void preview.start(grant.song, resultsReady);
        },
        onUnlockDone: () => preview.end(),
      },
    });
    this.bag.add(() => void unmount(app));

    context.stage.overlay.dataset["screen"] = "game-end";

    // The room's song's results section, once, under "[name] wins". The race
    // loop stopped when the race screen left; a song with no section authored
    // leaves the results quiet, as they always were.
    const song = raceSong(context.content.current(), context.network.latestSnapshot()?.songId);
    if (song?.resultsStartMs !== undefined && song.resultsEndMs !== undefined) {
      // The song's own group: mapped already after a race, but not after a
      // reload that lands on the results straight from the room.
      await context.audio.load(`song-${song.id}`);
      // Left while it loaded: there are no results to play under.
      if (this.context !== context) return;
      context.audio.playSection(song.audioAlias, song.resultsStartMs, song.resultsEndMs);
      preview.resultsSection({ alias: song.audioAlias, startMs: song.resultsStartMs, endMs: song.resultsEndMs });
      this.bag.add(() => context.audio.stop());
    }
    markResultsReady();

    return Promise.resolve();
  }

  /** The grant this round made on these results, for the banner; nothing when none was made. */
  unlock(): UnlockGrant | undefined {
    return this.unlockHolder?.current;
  }

  /** The winner's name as the server named them, or nothing. */
  winnerName(): string | undefined {
    return winnerName(this.store?.snapshot);
  }

  /** Results in the server's finish order, unplaced players last. */
  results(): PlayerSnapshot[] {
    return orderedResults(this.store?.snapshot);
  }
}
