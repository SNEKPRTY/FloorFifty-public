<script lang="ts" module>
  /** The last seed a stage reveal on this page named; outlives one round's screen. */
  let rememberedSeed: number | undefined;
</script>

<script lang="ts">
  /**
   * The select phase, inside the Lobby (select spec §6.2): one branch per
   * step. The stage and song steps are the fullscreen picker (§6.8). Each
   * reveal is the roulette in the same frame; the song's stays mounted
   * through loading and the countdown, so its spin never replays. The song
   * step's previews follow the slide on screen (§6.4).
   */
  import { type AccessOptions } from "../profile/access";
  import { stageName as localisedStageName } from "../i18n/content";
  import * as m from "../../paraglide/messages.js";
  import { formFactor } from "../platform/viewport-tracking.svelte";
  import { screenLayout } from "../kit/screen-arrangement";
  import { RANDOM_PICK } from "@floor-fifty/shared/common/constants";
  import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import type { AudioPort } from "../audio";
  import type { NetworkPort } from "../net/network";
  import { PreviewDeck } from "../audio/preview-deck";
  import { MENU_MUSIC } from "../audio/menu-cues";
  import { reducedMotion } from "../kit/motion";
  import { songItems, stageItems, type PickerItem } from "./picker-model";
  import { playerRows, revealByline, revealCoversToFetch } from "./select-model";
  import type { RoomStore } from "../net/store/room-store.svelte";
  import ViewSwitch from "../kit/ViewSwitch.svelte";
  import RouletteReveal from "./RouletteReveal.svelte";
  import SongSlide from "./SongSlide.svelte";
  import SongStep from "./SongStep.svelte";
  import StageSlide from "./StageSlide.svelte";
  import StageStep from "./StageStep.svelte";

  let {
    store,
    network,
    audio,
    attempt,
    content,
    artSrc,
    access,
  }: {
    store: RoomStore;
    network: NetworkPort;
    audio: AudioPort;
    attempt: (action: () => Promise<void>) => void;
    content: () => GameContentPayload | undefined;
    artSrc: (alias: string) => string | undefined;
    access: AccessOptions;
  } = $props();

  const snapshot = $derived(store.snapshot);
  /**
   * The last snapshot that carried the select. The room drops `select` at the
   * countdown, and the reveal still shows its rows and whose pick it was
   * until the Lobby hands over to the stage. A plain variable, not state: it
   * only remembers.
   */
  let lastSelect: RoomSnapshot | undefined;
  /**
   * The round whose song reveal this mounting saw. A reload that lands in
   * loading or the countdown has missed the reveal's moment: the race starts the song at GO.
   * Set in `revealFrom`, which the reveal's branch reads before the reveal
   * mounts. A plain variable, like `lastSelect`: it only remembers.
   */
  let revealedRound: number | undefined;
  /** The round whose song has started: the reveal stays mounted, and a re-render never starts it twice. */
  let openedRound: number | undefined;
  /** The song the reveal started, for stopping it if the room goes back rather than on to the race. */
  let openedAlias: string | undefined;
  /** False once the screen has gone: a song still loading then never starts over the race. */
  let mounted = true;
  /**
   * The last seed this page saw a stage raced on: the seed editor opens on it,
   * so "the same climb again" is one press of Use seed (stage seeds spec §3.4).
   * Recorded by an effect, eagerly, from the reveal on: the stage step that
   * reads it never carries the seed itself (final review I2). Kept at module
   * level too, because the screen is mounted afresh for each round.
   */
  let lastSeed = $state(rememberedSeed);
  $effect(() => {
    const seed = snapshot?.select?.stage?.seed;
    if (seed === undefined) return;
    rememberedSeed = seed;
    lastSeed = seed;
  });
  const revealFrom = $derived.by(() => {
    if (snapshot?.select !== undefined) lastSelect = snapshot;
    if (snapshot?.select?.step === "songReveal") revealedRound = snapshot.round;
    return snapshot?.select !== undefined ? snapshot : (lastSelect ?? snapshot);
  });
  /**
   * The song reveal's large covers come in while the players pick (Owner,
   * 2026-10-10): each picked song's, once, so the reveal lands on its cover
   * loaded. The images are held so the browser does not drop the requests.
   */
  const coverFetches = new Map<string, HTMLImageElement>();
  $effect(() => {
    if (snapshot === undefined) return;
    for (const url of revealCoversToFetch(snapshot, content(), artSrc)) {
      if (coverFetches.has(url)) continue;
      const image = new Image();
      image.src = url;
      coverFetches.set(url, image);
    }
  });
  /** The song's reveal stays one view through loading and the countdown, so its spin never replays. */
  const viewOf = (step: string): string => (step === "stage" || step === "stageReveal" || step === "song" ? step : "songReveal");
  const step = $derived(snapshot?.phase === "countdown" ? "countdown" : (snapshot?.select?.step ?? "stage"));
  /** The stages and songs, built once for the reveals' scenes rather than at every hop of the highlight. */
  const revealStages = $derived.by(() => {
    const loaded = content();
    return loaded === undefined ? [] : stageItems(loaded, artSrc, access);
  });
  const revealSongs = $derived.by(() => {
    const loaded = content();
    return loaded === undefined ? [] : songItems(loaded, artSrc, access);
  });
  const stageName = (id: string | undefined) => {
    const stage = content()?.stages.find((entry) => entry.id === id);
    return stage === undefined ? "" : localisedStageName(stage);
  };
  const songName = (id: string | undefined) => content()?.songs.find((song) => song.id === id)?.displayName ?? "";
  /**
   * A stage's still or a song's cover, for the reveal's full-bleed result. A
   * song's is its 1200 px cover, so the frame never stretches the panel's
   * 640; the panel's stands in under it while it loads.
   */
  const stageArt = (id: string) => revealStages.find((entry) => entry.id === id)?.art;
  const songArt = (id: string) => {
    const alias = content()?.songs.find((song) => song.id === id)?.coverAlias;
    return alias === undefined ? undefined : (artSrc(`${alias}Full`) ?? songPanelArt(id));
  };
  const songPanelArt = (id: string) => revealSongs.find((entry) => entry.id === id)?.art;
  const spectrum = () => audio.musicSpectrum?.();
  const connected = (from: RoomSnapshot) => from.players.filter((player) => player.status === "connected").length;
  /** The room as the roulette sees it: people only. A CPU makes no pick and is never drawn (CPU players spec D-C6). */
  const people = (from: RoomSnapshot): RoomSnapshot => ({ ...from, players: from.players.filter((player) => !player.cpu) });

  /** One deck for the screen's life, reaching the port through the prop. */
  const deck = new PreviewDeck({
    playPreview: (alias) => audio.playPreview?.(alias),
    stopPreview: () => audio.stopPreview?.(),
    releaseTrack: (alias) => audio.releaseTrack?.(alias),
  });
  /** The preview clips are aliases in the shell group, mapped once, on the song step. */
  let previewsMapped = $state(false);
  let mapping = false;
  /** The clip of the slide on screen: every song's, locked and DLC ones too, so a player hears what they can unlock; none for Random. */
  let onScreen = $state<string | undefined>(undefined);

  function previewOf(item: PickerItem): string | undefined {
    if (item.id === RANDOM_PICK) return undefined;
    const song = content()?.songs.find((entry) => entry.id === item.id);
    return song === undefined ? undefined : `${song.audioAlias}Preview`;
  }

  $effect(() => {
    if (step !== "song" || mapping) return;
    mapping = true;
    void audio
      .load("shell")
      .catch(() => undefined)
      .then(() => (previewsMapped = true));
  });
  // The step's own clip while it lasts; nothing once it ends: the reveal ends previews (§6.4).
  $effect(() => {
    if (step === "song" && previewsMapped) deck.focus(onScreen);
    else deck.stop();
  });
  // The menu theme is the ready room's and the stage step's (§6.4). A reload
  // claims it in the Splash, before the room's snapshot is in, and a focus on
  // Random starts no preview to end it, so the screen ends it itself. Scoped
  // to the theme: the race's song, started at the reveal, is left alone.
  $effect(() => {
    if (step !== "stage" && step !== "stageReveal") audio.stop(MENU_MUSIC);
  });
  $effect(() => () => {
    mounted = false;
    deck.stop();
    // The song plays on into the race, which takes it over at the countdown.
    // A room that goes back to the ready room, or a player who leaves before
    // the count, ends it here. Scoped to the song: the race may already hold the slot.
    const phase = store.snapshot?.phase;
    if (openedAlias !== undefined && phase !== "countdown" && phase !== "racing") audio.stop(openedAlias);
  });

  /**
   * The chosen song as the reveal lands (§6.4), once a round. It loops in
   * the music slot as the race would play it, and runs on through loading
   * and the countdown: the race leaves it playing rather than starting it
   * over at GO.
   */
  function playOpening(): void {
    const from = revealFrom ?? snapshot;
    if (from === undefined || from.round !== revealedRound || from.round === openedRound) return;
    const song = content()?.songs.find((entry) => entry.id === (from.select?.song?.id ?? from.songId));
    if (song === undefined) return;
    openedRound = from.round;
    deck.stop();
    void audio
      .load(`song-${song.id}`)
      .then(() => {
        if (!mounted) return;
        openedAlias = song.audioAlias;
        audio.play(song.audioAlias);
      })
      .catch(() => undefined);
  }
</script>

<!-- A stage by ID, for the reveal's scene: its still, or the Random slide. -->
{#snippet stageScene(id: string)}
  {@const found = revealStages.find((entry) => entry.id === id)}
  <!-- The room's stage, drawn open: whatever this player may pick, the room races it (review 2). -->
  <StageSlide item={found === undefined ? { id: "?", label: m.select_random_stage(), state: "open" } : { id: found.id, label: found.label, state: "open", ...(found.art === undefined ? {} : { art: found.art }) }} pan={false} />
{/snippet}

<!-- A song by ID, for the reveal's scene: its player, or the Random slide. -->
{#snippet songScene(id: string)}
  {@const found = revealSongs.find((entry) => entry.id === id)}
  <!-- The room's song, drawn open: whatever this player may pick, the room races it. -->
  <SongSlide
    item={found === undefined ? { id: RANDOM_PICK, label: m.select_random_song(), state: "open" } : { id: found.id, label: found.label, state: "open", ...(found.art === undefined ? {} : { art: found.art }) }}
    {spectrum}
    live={!reducedMotion()}
  />
{/snippet}

<section class="ff-select" data-testid="select-screen" data-step={step} data-layout={screenLayout(formFactor.current)}>
  {#if snapshot !== undefined}
   <!-- The steps cross-fade into one another, and the first one fades in with the screen (the ready room does not hand it a fade of its own). -->
   <ViewSwitch view={viewOf(step)} class="ff-select__steps">
    {#snippet children(view)}
    {#if view === "stage"}
      <!-- The fullscreen picker draws its own headline, seconds, players and Lock in. -->
      <StageStep
        {snapshot}
        localPlayerId={store.localPlayerId}
        content={content()}
        {artSrc}
        {access}
        onPick={(id) => attempt(() => network.pickStage(id))}
        onLockIn={() => attempt(() => network.lockIn())}
        onSeed={(choice) => attempt(() => network.pickSeed(choice))}
        {lastSeed}
      />
    {:else if view === "stageReveal"}
      {@const from = people(revealFrom ?? snapshot)}
      {@const result = from.select?.stage}
      <!-- -1 when the winner has left: no byline, no row to land on, never seat 0's. -->
      {@const winner = from.players.findIndex((player) => player.id === (result?.pickedBy ?? ""))}
      {@const rows = playerRows(from, content(), artSrc, store.localPlayerId, "stage")}
      <!-- Keyed on the round: the reveal takes its rows once, on mount, so a
           round that changed under it must remount it, never reuse it. -->
      {#key `stage:${from.round}`}
        <RouletteReveal
          heading={m.select_stage_kind()}
          {rows}
          winnerSeat={winner}
          resultId={result?.id ?? snapshot.stageId}
          resultLabel={stageName(result?.id ?? snapshot.stageId)}
          resultByline={revealByline(rows, winner)}
          solo={connected(from) <= 1}
          art={stageArt}
          scene={stageScene}
        />
      {/key}
    {:else if view === "song"}
      <SongStep
        {snapshot}
        localPlayerId={store.localPlayerId}
        content={content()}
        {artSrc}
        {access}
        {spectrum}
        onPick={(id) => attempt(() => network.pickSong(id))}
        onLockIn={() => attempt(() => network.lockIn())}
        onView={(item) => (onScreen = previewOf(item))}
      />
    {:else}
      <!-- The song's reveal, loading and the countdown in one branch, so the
           reveal stays mounted across them and its spin never replays. The
           countdown shows the settled result for the moment before the
           Lobby hands over; the count is the race's (race-flow spec §3). -->
      {@const from = people(revealFrom ?? snapshot)}
      {@const result = from.select?.song}
      {@const winner = from.players.findIndex((player) => player.id === (result?.pickedBy ?? ""))}
      {@const rows = playerRows(from, content(), artSrc, store.localPlayerId, "song")}
      {#key `song:${from.round}`}
        <RouletteReveal
          heading={m.select_song_kind()}
          {rows}
          winnerSeat={winner}
          resultId={result?.id ?? snapshot.songId}
          resultLabel={songName(result?.id ?? snapshot.songId)}
          resultByline={revealByline(rows, winner)}
          solo={connected(from) <= 1}
          onSettled={playOpening}
          art={songArt}
          artBehind={songPanelArt}
          scene={songScene}
        />
      {/key}
    {/if}
    {/snippet}
   </ViewSwitch>
  {/if}
</section>

<style>
  /* One area: the step fills it. The stage and song steps' fullscreen picker
     lays out its own headline, panel, dots, players and Lock in per form
     factor; the reveals fill the same area. Nothing scrolls, except that a browser bar
     laid over the foot (gate round 3) scrolls what does not fit into view, as
     the ready room does. */
  .ff-select {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    /* In the frame's body, under its corner row, like every shell screen:
       pinned to the whole viewport, the art and the picker's panel were drawn
       over Mute. The frame keeps it inside the visible band. */
    width: 100%;
    height: 100%;
    max-width: 720px;
    margin-inline: auto;
    min-height: 0;
    overflow-y: auto;
  }
  /* Every step in the one area, stacked: a step paging out (polish spec §5.3)
     lies over the next, never beside it. Laid out in a second row, the stage's
     reveal mounted a strip tall, and its art grew to that strip. */
  .ff-select > :global(*) {
    grid-area: 1 / 1;
  }
  /* The steps' switch fills the one area, and each view fills the switch, so a view fading out
     (lifted out of the flow by the switch) and the one fading in lie over each other at full size. */
  .ff-select :global(.ff-select__steps) {
    height: 100%;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .ff-select :global(.ff-select__steps > .ff-view) {
    height: 100%;
    min-height: 0;
  }
  /* A phone held sideways uses the whole width. */
  :global([data-form-factor="phone-landscape"]) .ff-select {
    max-width: none;
  }
  :global([data-form-factor="desktop"]) .ff-select {
    max-width: 1200px;
  }
</style>
