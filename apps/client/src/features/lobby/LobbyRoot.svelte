<script lang="ts">
  /**
   * The lobby, both halves of it (launch polish §3.1.1; the former menu).
   *
   * Which half shows is a question about the room, not about who sent the
   * player here: `Race Again` keeps the room and returns to the ready room,
   * while `Leave room` releases it and returns to create-and-join. So the panel
   * is chosen from `store.roomCode` rather than from a flag someone sets.
   *
   * This component renders state and never navigates. `screen-manager.ts` keeps
   * ownership of which screen is active, and `features/lobby/lobby.ts` is the only
   * thing that asks it to move. Back is a report, not a navigation: the
   * screen publishes it and the authored graph decides where it goes.
   *
   * Nothing here is keyed on snapshot data. Authority broadcasts at 20 Hz while
   * a player sits in the ready room, and a `{#key}` block around a control
   * would rebuild it on every broadcast -- destroying the button under the
   * player's finger, which is the bug the imperative screen was written around.
   */
  import * as m from "../../paraglide/messages.js";
  import { type AccessOptions, NO_ACCESS } from "../profile/access";
  import { ERROR_CODES, errorCopy, unknownErrorCopy, type ErrorCode } from "../screen/error-copy";
  import type { ErrorDetail } from "../net/error-view";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import type { AudioPort } from "../audio";
  import type { NetworkPort } from "../net/network";
  import { refuse } from "../kit/motion";
  import { onRoomError } from "../net/room-gone";
  import type { RoomStore } from "../net/store/room-store.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import ConnectPanel from "./ConnectPanel.svelte";
  import ReadyRoom from "./ReadyRoom.svelte";
  import SelectScreen from "../select/SelectScreen.svelte";
  import CharacterPage from "../select/CharacterPage.svelte";
  import type { SeatColour } from "@floor-fifty/shared/common/seats";
  import { menuLineup } from "../select/menu-lineup";
  import { formFactor, heightTier } from "../platform/viewport-tracking.svelte";
  import ScreenFrame from "../kit/layout/ScreenFrame.svelte";
  import { menuArrangement, roomArrangement, screenLayout } from "../kit/screen-arrangement";
  import Button from "../kit/Button.svelte";
  import Notice from "../kit/Notice.svelte";
  import Panel from "../kit/Panel.svelte";
  import ViewSwitch from "../kit/ViewSwitch.svelte";
  import RoomCode from "./RoomCode.svelte";
  import MenuHero from "./MenuHero.svelte";
  import MenuSheet from "../settings/MenuSheet.svelte";

  let {
    store,
    network,
    audio,
    settings,
    artSrc,
    content,
    onBack,
    onStory,
    heroRises = true,
    access = NO_ACCESS,
    seatedOnEntry = undefined,
  }: {
    store: RoomStore;
    network: NetworkPort;
    /** The select screen's previews and the song's opening. */
    audio: AudioPort;
    settings: SettingsStore;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc: (alias: string) => string | undefined;
    /** A getter, because the artifact can be replaced while the panel is up. */
    content: () => GameContentPayload | undefined;
    onBack: () => void;
    /** Opens the story, which the match gate offers; absent while story mode is hidden. */
    onStory?: () => void;
    /** Off when arriving from the title, whose hero is already on screen. */
    heroRises?: boolean;
    /** What this device may pick: the dev flag, what it earned and what it owns. */
    access?: AccessOptions;
    /** The seat the device already held when the lobby was entered, if any. */
    seatedOnEntry?: string | undefined;
  } = $props();

  /** Held as the words' message, not its text, so a language switch re-words the line. */
  let copy = $state<() => string>(() => "");
  const message = $derived(copy());
  let tone = $state<"info" | "error">("info");
  let statusLine: HTMLElement | undefined = $state();

  function setStatus(next: () => string, nextTone: "info" | "error" = "info"): void {
    copy = next;
    tone = nextTone;
    // A refusal repeated verbatim changes no text at all -- press "Join" twice
    // with a short room code and the screen would otherwise sit perfectly
    // still, which reads as the button being dead rather than as a refusal.
    if (nextTone === "error" && statusLine !== undefined) refuse(statusLine);
  }

  /**
   * Runs a room command, reporting a refusal in place rather than throwing.
   *
   * `store.sync()` on success because creating, joining and leaving all change
   * the room identity with no broadcast to hear it from.
   */
  /**
   * The words for a failure: chosen from its code (and detail) when it has one,
   * never the server's or the library's prose, which is logged instead.
   */
  function failureCopy(error: unknown): () => string {
    const coded = error as { code?: unknown; detail?: ErrorDetail } | undefined;
    if (typeof coded?.code === "string" && (ERROR_CODES as readonly string[]).includes(coded.code)) {
      return errorCopy(coded.code as ErrorCode, coded.detail);
    }
    console.warn("[lobby] failure with no code:", error);
    return () => unknownErrorCopy();
  }

  function attempt(action: () => Promise<void>): void {
    void (async () => {
      try {
        await action();
        store.sync();
        setStatus(() => "");
      } catch (error) {
        setStatus(failureCopy(error), "error");
      }
    })();
  }

  // A refusal the server pushes rather than one it returns. Subscribed here
  // rather than in the screen because the status line lives here, and the
  // effect's teardown releases it with the component.
  // A room that closed under the player is left, so the connect panel returns
  // (audit S10); any other refusal only reports.
  $effect(() =>
    network.subscribe({
      onError: (error) =>
        onRoomError(error, {
          network,
          sync: () => store.sync(),
          report: (reported) => setStatus(failureCopy(reported), "error"),
        }),
    }),
  );

  /**
   * Whether the player is in a room, and so which half to show.
   *
   * Two signals, because either can arrive first. `createRoom` resolves with a
   * room code and no snapshot yet; a client that reconnects mid-race is handed
   * a snapshot before it has asked the port anything. Reading only one of them
   * strands the player on the wrong panel in one of those two cases.
   *
   * Leaving clears both: `store.sync()` retires the last snapshot along with
   * the room code, so this falls back to the connect panel.
   */
  const inRoom = $derived(store.roomCode !== undefined || store.snapshot !== undefined);
  /** Select and the countdown after it replace the ready room (select spec §3). */
  const selecting = $derived(store.snapshot?.phase === "select" || store.snapshot?.phase === "countdown");
  /** Which of the three the body shows: connect, the ready room or select cross-fade as one switch. */
  const subview = $derived(inRoom ? (selecting ? "select" : "ready-room") : "connect");

  /**
   * Whether the connect panel's hero rises in. Only its first showing can be
   * carried over from the title; once the ready room has replaced it, Leave
   * room brings it back as a real entrance.
   */
  // svelte-ignore state_referenced_locally
  let connectHeroRises = $state(heroRises);
  $effect(() => {
    if (inRoom) connectHeroRises = true;
  });

  /**
   * The Character page, opened from your seat (select spec §6.1). Rendered
   * after the section rather than inside the ready room: a fixed page inside
   * the glass panels would take their backdrop filter as its containing block.
   * Leaving the room closes it, so a rejoin never finds it open.
   */
  let characterOpen = $state(false);
  $effect(() => {
    if (!inRoom) characterOpen = false;
  });
  const mySeat = $derived(store.seats.find((seat) => seat.player !== undefined && seat.player.id === store.localPlayerId));
  /** Your colour, asked of the room and remembered (select spec §6.7). */
  function pickColour(colour: SeatColour): void {
    attempt(() => network.pickColour(colour));
    settings.update({ profile: { lastColour: colour } });
  }

  function pickCharacter(id: string): void {
    attempt(() => network.pickCharacter(id));
    // ? is a roll for this room, not a body to remember.
    if (id !== "?") settings.update({ profile: { lastCharacter: id } });
  }
</script>

<!-- Escape, and a controller's B (which arrives as Escape), goes back the way
     Back does -- only outside a room, where Back is offered. In a room the
     way out is Leave room, which releases the seat, so no key does it. -->
<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented && !inRoom) onBack();
  }}
/>

<!-- The menu's hero, outside a room only: an empty hero would still take a
     column of the frame and squeeze the room into the sheet's place. -->
{#snippet menuHero()}
  <MenuHero
    rise={connectHeroRises}
    centred={formFactor.current === "tablet-portrait" || formFactor.current === "phone-portrait"}
    tagline={formFactor.current !== "phone-portrait"}
    racers={menuLineup(
      { characterId: settings.value.profile.lastCharacter, colour: settings.value.profile.lastColour },
      settings.value.profile.lastSeen,
    )}
  />
{/snippet}

<section
  data-testid="lobby"
  data-under-page={characterOpen && inRoom && mySeat?.player !== undefined ? "" : undefined}
  data-subview={subview}
  data-connection={store.connection}
  class="ff-menu ff-screen grid content-end overflow-x-hidden font-ui"
>
  <ScreenFrame
    arrangement={inRoom ? roomArrangement(formFactor.current) : menuArrangement(formFactor.current, heightTier.current)}
    {settings}
    back={inRoom ? undefined : onBack}
    backTestId="lobby-back"
    hero={inRoom ? undefined : menuHero}
    headerAt={inRoom ? "start" : undefined}
  >
    {#snippet header()}
      {#if inRoom && !selecting}<RoomCode {store} {network} {setStatus} />{/if}
    {/snippet}
    {#snippet body()}
      <!-- Connect, the ready room and select are one switch, so the panel being left fades out while
           the next one fades in, instead of vanishing. -->
      <ViewSwitch view={subview} class="ff-lobby__views">
        {#snippet children(view)}
          {#if view === "select"}
            <SelectScreen {store} {network} {audio} {attempt} {content} {artSrc} {access} />
          {:else if view === "ready-room"}
            <ReadyRoom
              arrangement={roomArrangement(formFactor.current)}
              {store}
              {network}
              {attempt}
              {setStatus}
              {settings}
              {artSrc}
              {content}
              {access}
              {seatedOnEntry}
              onChangeCharacter={() => (characterOpen = true)}
            />
          {:else}
            <!-- The form as one group: where a stack puts it (a phone's foot, under a
                 tablet's hero), centred beside the hero in a split. -->
            <div class="ff-lobby__connect">
              <MenuSheet>
                <ConnectPanel
                  {network}
                  {attempt}
                  {setStatus}
                  touchMode={settings.value.input.touchMode}
                  {settings}
                  prompts={content()?.story?.prompts}
                  {artSrc}
                  {...onStory === undefined ? {} : { onStory }}
                />
              </MenuSheet>
            </div>
          {/if}
        {/snippet}
      </ViewSwitch>
    {/snippet}
  </ScreenFrame>

  <!-- A refusal and an ordinary update differ in their words first. Both are
       the one notice, at the top under the corner buttons, so neither lands on
       a button or a corner of the screen; empty, it is hidden and takes no row. -->
  <Notice
    bind:node={statusLine}
    testId="menu-status"
    tone={tone === "error" ? "problem" : "info"}
    {message}
    hidden={message === ""}
    onClose={() => setStatus(() => "")}
  />
</section>

{#if characterOpen && inRoom && mySeat?.player !== undefined}
  <CharacterPage
    layout={screenLayout(formFactor.current)}
    {content}
    {artSrc}
    colour={mySeat.scarf}
    current={mySeat.player.characterId}
    {access}
    seat={mySeat.index}
    random={true}
    {settings}
    onPick={pickCharacter}
    taken={store.seats.flatMap((seat) =>
      seat.player === undefined || seat.player.id === store.localPlayerId ? [] : [{ colour: seat.player.colour, seat: seat.index }],
    )}
    onPickColour={pickColour}
    onClose={() => (characterOpen = false)}
  />
{/if}

<style>
  /* Under the Character page, which draws no sheet of its own: the city
     canvas is its backdrop, and nothing of this screen shows through. */
  .ff-menu[data-under-page] {
    opacity: 0;
    pointer-events: none;
  }
  /* The switch fills the frame's body, and each view fills the switch as the body's grid did. */
  :global(.ff-lobby__views) {
    height: 100%;
    grid-template-rows: minmax(0, 1fr);
  }
  :global(.ff-lobby__views > .ff-view) {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
    justify-items: stretch;
    align-content: stretch;
  }
  /* The form scrolls inside only under the soft keyboard. */
  .ff-lobby__connect {
    display: grid;
    height: 100%;
    min-height: 0;
    gap: var(--ff-panel-gap);
    /* Never shorter than a few rows of the form: squeezed under a bar the
       browser lays over the page, the frame scrolls instead of the sheet
       shrinking past its own buttons. */
    grid-template-rows: minmax(7.5rem, max-content);
    align-content: var(--ff-stack-sheet-align);
  }
  :global([data-arrangement="split"]) .ff-lobby__connect {
    align-content: center;
  }
  /* A phone held upright: the hero's cell is what the form
     leave, so it is a size container the hero shrinks to (MenuHero sets the
     wordmark on one line there). Only here: elsewhere the stack sizes the
     hero's row to the hero, and a size container would collapse it. */
  :global([data-form-factor="phone-portrait"]) .ff-menu :global(.ff-screen-frame[data-arrangement="stack"] > .ff-screen-frame__content > .ff-screen-frame__hero) {
    container: ff-hero / size;
  }
  /* The screen holds only the status line now (the frame is fixed to the
     band on its own), so it keeps to the band as the frame does: inset to the
     viewport, the line sat on the letterbox's bottom bar. */
  .ff-menu {
    top: var(--ff-band-top);
    bottom: auto;
    height: min(var(--ff-band-height), calc(100dvh - var(--ff-band-top) - var(--ff-visual-inset-bottom, 0px)));
  }
</style>
