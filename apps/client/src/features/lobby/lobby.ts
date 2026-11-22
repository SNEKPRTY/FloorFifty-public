/**
 * Lobby: room formation (launch polish §3.1.1), the former menu.
 *
 * The title's Play leads here, and Race again returns here. Lifecycle only.
 * This screen creates the room store, mounts the Svelte tree
 * that draws both halves of room formation, and forwards two decisions to the
 * screen manager: the countdown has begun, so leave for the stage, where the
 * race counts in (race-flow spec §3); and the race has finished, for a Lobby
 * that a late snapshot reaches after it.
 *
 * Everything shown comes from a snapshot. The screen never decides who the host
 * is, how many laps are selected, or when the race begins. The component tree
 * renders state and never navigates; `screen-manager.ts` keeps ownership of
 * which screen is active.
 *
 * The 20 Hz rebuild bug this file used to be written around is gone with the
 * imperative DOM. Svelte patches attributes and text in place, so a control
 * survives a broadcast by default -- see `LobbyRoot.svelte` for the one way that
 * guarantee can still be thrown away.
 */

import { SongPreloader } from "../audio/song-preloader";
import { songById } from "../audio/songs";
import { NO_ACCESS } from "../profile/access";
import type { RoomPhase, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { RevisionHash } from "@floor-fifty/shared/content/game-content";
import { mount, unmount } from "svelte";
import type { ScreenId } from "../profile/screen-state";
import LobbyRoot from "./LobbyRoot.svelte";
import { ErrorView } from "../screen/error-panel.svelte";
import { createRoomStore } from "../net/store/room-store.svelte";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { RoomCalls } from "../race/room-calls";
import { preloadRaceAssets } from "../race/race-scene";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { claimMenuBackdrop } from "../boot/menu-backdrop";
import { claimMenuBed, claimMenuMusic } from "../boot/menu-music";
import { afterSeeing } from "../select/menu-lineup";

export class LobbyScreen extends BaseScreen {
  readonly name: ScreenId = "Lobby";

  /**
   * The last room phase this mounting of the screen acted on.
   *
   * Screen-local and reset on entry. Authority broadcasts at 20 Hz, so
   * without it a finished room would publish `room.finished` twenty times a
   * second; with it, one phase edge is one event. The snapshot remains the
   * source -- this suppresses repetition, it does not invent a phase.
   *
   * Seeded on entry from whatever snapshot is already on hand, without
   * publishing it. A screen reports phase changes that happen while it is
   * mounted, never the state of the world it arrived into -- the lobby is
   * reached *from* a finished room by `Race Again`, and republishing that
   * finished phase would send the player straight back to the results they
   * just dismissed. The same seeding keeps a room that was closed under a
   * player from bouncing them back into a race that no longer exists. The one
   * exception is a seat resumed at boot; see `onEnter`.
   */
  private lastPhase: RoomPhase | undefined;

  /**
   * The snapshot revision this mounting has already asked the server about.
   *
   * Screen-local and reset on entry, like `lastPhase`, and for the same
   * reason. A room freezes its content for life, so a lobby whose room was
   * created before a rebuild names a revision this client can never hold: the
   * cache moves to the server's newer artifact and the broadcast keeps the
   * older one. Comparing against the cache alone therefore re-asks at 20 Hz
   * forever. Remembering the revision a refresh was issued *for* makes it one
   * request per revision the client has not yet reacted to, which is what the
   * durable trigger was always meant to be.
   */
  private lastRequestedRevision: RevisionHash | undefined;

  /** Arrivals and the countdown, called aloud; see `room-calls.ts`. */
  private calls: RoomCalls | undefined;

  /**
   * The round whose loading step this mounting has answered. Reset on entry,
   * so a reload in the loading step loads and says so again.
   */
  private loadedRound: number | undefined;
  private songPreloader: SongPreloader | undefined;

  protected async onEnter(context: ScreenContext): Promise<void> {
    this.lastPhase = undefined;
    this.lastRequestedRevision = undefined;
    this.loadedRound = undefined;
    const songPreloader = new SongPreloader(context.audio);
    this.songPreloader = songPreloader;
    this.bag.add(() => {
      const latest = context.network.latestSnapshot();
      const handingOff = latest?.phase === "countdown" || latest?.phase === "racing";
      const song = handingOff ? songById(context.content.current(), latest.songId) : undefined;
      songPreloader.dispose(song?.audioAlias);
    });
    await context.assets.loadBundle("menu");
    // The select art and every character, loaded behind the ready room (select spec §6.5); nothing waits on it.
    void context.assets.loadBundle("shell").catch(() => undefined);
    // Shared with the other menu screen, so the switch keeps the sky and the song.
    this.bag.add(claimMenuBackdrop(context));
    this.bag.add(claimMenuMusic(context));
    this.bag.add(claimMenuBed(context));

    // Owned by the bag rather than by a field: nothing outside `enter` and
    // `exit` reads it, and a field would only invite something to.
    const store = createRoomStore(context.network);
    this.bag.add(() => store.dispose());

    const app = mount(LobbyRoot, {
      target: context.stage.overlay,
      props: {
        store,
        network: context.network,
        audio: context.audio,
        settings: context.settings,
        artSrc: (alias: string) => context.assets.srcOf?.(alias),
        content: () => context.content.current()?.content,
        access: context.access ?? NO_ACCESS,
        // A seat the device already holds on entry -- resumed from Splash, or
        // back from Race again -- keeps the body it has; only a seat taken
        // here is dressed in the remembered character.
        seatedOnEntry: context.network.localPlayerId,
        // Play from the title: its hero is on screen already, so only the
        // panel changes.
        heroRises: context.previousScreen !== "MainMenu",
        onBack: () => context.publishPresentationEvent("ui.back-requested", {}),
      },
    });
    this.bag.add(() => void unmount(app));

    context.stage.overlay.dataset["screen"] = "lobby";

    // A sibling of the menu rather than a child of it, so swapping between the
    // connect panel and the ready room never clears an explanation the player
    // has not read. Still imperative; Task 14 moves it into the component tree.
    const errorHost = document.createElement("div");
    context.stage.overlay.append(errorHost);
    const errorView = new ErrorView(errorHost);
    this.bag.add(() => {
      errorView.hide();
      errorHost.remove();
    });

    // Content is refreshed on entry, on the server's notification, and on a
    // snapshot that names content this client has not fetched. The three
    // overlap on purpose: the notification reaches a client sitting outside a
    // room, where no snapshot ever arrives, and the snapshot comparison
    // reaches a client that joined after the notification fired or missed it.
    // Both funnel into one idempotent refresh.
    this.refreshContent(context);

    this.bag.add(
      context.network.subscribe({
        onSnapshot: (snapshot) => this.onSnapshot(snapshot),
        onContentRevision: () => this.refreshContent(context),
        // Leaving the room mid-countdown sends no snapshot to call it off, so
        // the countdown stops here, mid-word (the owner, 2026-09-30).
        onConnectionState: (state) => {
          if (state === "offline") this.stopCountdown(context);
        },
      }),
    );

    // A room resumed at boot may already be racing or finished. Treat the
    // entry snapshot as news, so the flow forwards rather than stranding the
    // player in a lobby for a race that is running without them. Only for a
    // live seat that Splash resumed: Race again arrives from GameEnd with the
    // finished snapshot still on hand, and a seat that ended keeps its last
    // snapshot too -- forwarding either would bounce the player back to the
    // screen they just left. Otherwise the entry snapshot is the baseline.
    const entry = context.network.latestSnapshot();
    this.calls = new RoomCalls(() => {
      const id = context.network.localPlayerId;
      return id === undefined ? undefined : asPlayerId(id);
    });
    this.calls.seed(entry);
    const resumed = context.previousScreen === "Splash" && context.network.connectionState === "connected";
    if (entry !== undefined && resumed) this.onSnapshot(entry);
    else this.lastPhase = entry?.phase;

    // Something may have ejected a player from a race; say what it was.
    const pending = context.errors.take();
    if (pending !== undefined) errorView.show(pending, { onDismiss: () => {} });
  }

  /**
   * Refreshes public content, tolerating a failure.
   *
   * A refusal leaves the previous cache in place, which is the right outcome:
   * the menu keeps showing the content it already has rather than emptying
   * itself because one request failed.
   */
  private refreshContent(context: ScreenContext): void {
    void context.content.refresh().catch(() => undefined);
  }

  /**
   * The one thing this screen decides: whether it is still the right screen.
   *
   * The server owns the phase, and the client only ever follows it.
   */
  /** The other players in the room, remembered for the title's lineup (select spec §6.7). */
  private remember(context: ScreenContext, snapshot: RoomSnapshot): void {
    const local = context.network.localPlayerId;
    if (local === undefined) return;
    const others = snapshot.players.filter((player) => player.id !== local);
    const next = afterSeeing(context.settings.value.profile.lastSeen, others);
    if (next !== undefined) context.settings.update({ profile: { lastSeen: next } });
  }

  /** Silences the countdown now: the number speaking and the ones queued behind it. */
  private stopCountdown(context: ScreenContext): void {
    if (context.audio.stopCues !== undefined) context.audio.stopCues("countdown:");
    else context.audio.cancelPending?.("countdown:");
  }

  private onSnapshot(snapshot: RoomSnapshot): void {
    const context = this.requireContext();
    if (
      snapshot.contentRevision !== context.content.current()?.contentRevision &&
      snapshot.contentRevision !== this.lastRequestedRevision
    ) {
      this.lastRequestedRevision = snapshot.contentRevision;
      this.refreshContent(context);
    }

    // iPad can spend twenty seconds decoding a race song. Start with the
    // local pick during song select, then follow the room's resolved song.
    // Random has no file until the reveal; never guess its outcome.
    const songId = snapshot.phase === "select"
      ? snapshot.select?.step === "song"
        ? snapshot.select.picks[context.network.localPlayerId ?? ""]?.focus
        : snapshot.select?.song?.id
      : snapshot.phase === "countdown" || snapshot.phase === "racing" ? snapshot.songId : undefined;
    this.songPreloader?.focus(songById(context.content.current(), songId));

    this.remember(context, snapshot);
    for (const cue of this.calls?.observe(snapshot) ?? []) {
      const { alias, ...options } = cue;
      context.audio.cue(alias, options);
    }

    // The loading step (select spec §6.5): load the chosen stage, then say so,
    // once per round. A reload lands here again and sends again only if this
    // round has not heard from it.
    if (snapshot.select?.step === "loading" && this.loadedRound !== snapshot.round) {
      this.loadedRound = snapshot.round;
      const stageId = snapshot.select.stage?.id ?? snapshot.stageId;
      const songId = snapshot.select.song?.id ?? snapshot.songId;
      // Quietly, behind the reveal: a failure sends nothing, and the race's
      // own loader retries once the room goes on without this seat.
      void preloadRaceAssets(context, stageId, songId)
        .then(() => context.network.loaded())
        .catch(() => undefined);
    }

    if (snapshot.phase === this.lastPhase) return;
    const previous = this.lastPhase;
    this.lastPhase = snapshot.phase;

    // The countdown happens on the stage (race-flow spec §3, D-F1), so the
    // Lobby hands over as it begins. A Lobby resumed into a race already
    // running forwards too; one that has handed over says nothing more.
    const live = (phase: RoomPhase | undefined) => phase === "countdown" || phase === "racing";
    if (live(snapshot.phase) && !live(previous)) context.publishPresentationEvent("room.racing", {});
    if (snapshot.phase === "finished")
      context.publishPresentationEvent("room.finished", {
        ...(snapshot.winnerId === undefined ? {} : { winnerId: snapshot.winnerId }),
      });
  }
}
