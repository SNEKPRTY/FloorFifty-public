<script lang="ts">
  /**
   * The character select as a showcase (stage, song and character select
   * spec §6.1, amended again 2026-09-30): the viewed character on the title's
   * rooftop in the open city, and one glass panel with its name, one action
   * line and every pack as chips. Opened from the title's Character button
   * and from your own seat in the ready room; it has no effects of its own --
   * a pick is `onPick`, then `onClose` once the hop has played.
   *
   * A tap views; "Pick", or a second tap on the viewed chip, picks. Keyboard
   * or pad focus views, and Enter or A (the focused chip's click) picks.
   * A pointer's own focus is not a view: Chrome focuses a button on
   * pointer-down, and viewing then would make that tap's click a pick.
   *
   * The page draws no sheet: its callers hide their screens while it is open,
   * so only the city canvas shows behind it. It is modal: focus moves in,
   * Tab wraps, Escape (and the pad's Back, which arrives as Escape) closes,
   * and focus goes back to whatever opened it.
   */
  import { characterName, packTitle } from "../i18n/content";
  import * as m from "../../paraglide/messages.js";
  import { onMount } from "svelte";
  import { SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";
  import { SEAT_COLOUR_NAMES } from "../../lib/constants";
  import type { GameContentPayload, PackContent } from "@floor-fifty/shared/content/game-content";
  import { tileAccess, type AccessOptions } from "../profile/access";
  import { characterById, portraitAliasFor, sheetAliasFor } from "../profile/character-art";
  import { focusControl, tabbables } from "../platform/focus-nav";
  import Button from "../kit/Button.svelte";
  import { reducedMotion } from "../kit/motion";
  import Panel from "../kit/Panel.svelte";
  import { lockOverscroll } from "../platform/lock-overscroll";
  import type { StageMove } from "./stage-motion";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import type { PackGroup, Shape } from "./tile-pages";
  import type { ScreenLayout } from "../kit/screen-arrangement";
  import CharacterStage from "./CharacterStage.svelte";
  import ComingSoonSheet from "./ComingSoonSheet.svelte";
  import ScreenFrame from "../kit/layout/ScreenFrame.svelte";
  import { heightTier } from "../platform/viewport-tracking.svelte";
  import TileGrid from "./TileGrid.svelte";

  let {
    content,
    artSrc,
    colour,
    current,
    access,
    seat,
    random,
    settings,
    onPick,
    onClose,
    taken = [],
    onPickColour = () => {},
    layout,
  }: {
    content: () => GameContentPayload | undefined;
    artSrc: (alias: string) => string | undefined;
    colour: SeatColour;
    current: string;
    access: AccessOptions;
    seat: number;
    random: boolean;
    settings: SettingsStore;
    onPick: (id: string) => void;
    onClose: () => void;
    /** Colours other players in the room hold, with their seats; none at the title (select spec §6.7). */
    taken?: readonly { colour: SeatColour; seat: number }[];
    /** A free colour tapped: the caller takes it (the room's pickColour, or only the device's memory). */
    onPickColour?: (colour: SeatColour) => void;
    /** How the page lays out, which its root decides (spec §2.1 rule 1). */
    layout: ScreenLayout;
  } = $props();

  const RANDOM_ID = "?";

  // The chips across, and the most a page holds if the packs ever outgrow
  // the panel and it pages (select spec §6.3).
  const MOST: Record<ScreenLayout, Shape> = {
    tablet: { columns: 5, rows: 2 },
    upright: { columns: 4, rows: 2 },
    // Held sideways: the same grid as everywhere else; it pages only where the
    // packs do not fit even at the smallest tile.
    sideways: { columns: 5, rows: 2 },
    desk: { columns: 4, rows: 2 },
  };

  /** The sprite's whole-number scale per layout (§6.1). */
  const SCALE: Record<ScreenLayout, number> = { desk: 6, tablet: 6, upright: 5, sideways: 3 };
  /** A short phone upright (an iPhone SE): the stage is a strip above the panel, and at 5 the
      character stood behind the panel with only her head showing (review R6/R7); at 3 she is whole. */
  const stageScale = $derived(layout === "upright" && heightTier.current !== undefined ? 3 : SCALE[layout]);

  /** How long the hop plays before the page closes; a short pause with reduced motion (§6.1). */
  const CLOSE_MS = 500;
  const CLOSE_REDUCED_MS = 250;

  const groups = $derived.by((): PackGroup[] => {
    const loaded = content();
    if (loaded === undefined) return [];
    return loaded.packs
      .filter((pack) => pack.characters.length > 0)
      .map((pack) => ({
        packId: pack.id,
        title: packTitle(pack),
        items: pack.characters.flatMap((id) => {
          const character = characterById(loaded, id);
          if (character === undefined) return [];
          const tile = tileAccess(loaded, "character", id, access);
          return [
            {
              id,
              label: characterName(character),
              state: tile.state,
              art: artSrc(portraitAliasFor(loaded, id, colour, "neutral")),
              hint: tile.state === "locked" ? tile.hint : undefined,
              progress: tile.state === "locked" ? tile.progress : undefined,
              isNew: tile.state === "open" && tile.isNew === true ? true : undefined,
            },
          ];
        }),
      }));
  });

  type Action =
    | { kind: "pick" }
    | { kind: "picked" }
    | { kind: "locked"; hint: string; goal: number; count: number | undefined }
    | { kind: "dlc"; pack: string; packId: string };
  type Viewed = { name: string; sheet: string | undefined; tone: "colour" | "dimmed" | "grey"; action: Action };

  // The stage starts on the worn body, then follows the player.
  // svelte-ignore state_referenced_locally
  let viewedId = $state(current);
  let move = $state<StageMove>("drop");
  let cue = $state(0);
  let picking = $state<string | undefined>();

  const viewed = $derived.by((): Viewed => {
    const loaded = content();
    const worn = viewedId === current || viewedId === picking;
    if (viewedId === RANDOM_ID) return { name: m.ready_random(), sheet: undefined, tone: "colour", action: { kind: worn ? "picked" : "pick" } };
    const viewedCharacter = characterById(loaded, viewedId);
    const name = viewedCharacter === undefined ? "" : characterName(viewedCharacter);
    if (loaded === undefined) return { name, sheet: undefined, tone: "colour", action: { kind: "picked" } };
    const sheet = artSrc(sheetAliasFor(loaded, viewedId, colour));
    const tile = tileAccess(loaded, "character", viewedId, access);
    if (tile.state === "locked")
      return { name, sheet, tone: "dimmed", action: { kind: "locked", hint: tile.hint, goal: tile.goal, count: tile.count } };
    if (tile.state === "dlc") {
      const owner = loaded.packs.find((candidate) => candidate.characters.includes(viewedId));
      return { name, sheet, tone: "grey", action: { kind: "dlc", pack: owner === undefined ? "" : packTitle(owner), packId: owner?.id ?? "" } };
    }
    return { name, sheet, tone: "colour", action: { kind: worn ? "picked" : "pick" } };
  });
  const action = $derived(viewed.action);

  function pickable(id: string): boolean {
    if (id === RANDOM_ID) return true;
    const loaded = content();
    return loaded !== undefined && tileAccess(loaded, "character", id, access).state === "open";
  }

  function view(id: string): void {
    if (picking !== undefined || id === viewedId) return;
    viewedId = id;
    move = "drop";
    cue += 1;
  }

  let closing: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(closing);
    onClose();
  }

  function pick(id: string): void {
    if (picking !== undefined || !pickable(id)) return;
    picking = id;
    onPick(id);
    move = "hop";
    cue += 1;
    closing = setTimeout(close, reducedMotion() ? CLOSE_REDUCED_MS : CLOSE_MS);
  }

  /** A free colour is taken at once, and the page stays open (select spec §6.7). */
  function chooseColour(option: SeatColour): void {
    if (picking !== undefined || option === colour) return;
    if (taken.some((held) => held.colour === option)) return;
    onPickColour(option);
  }

  /**
   * The pack a DLC character belongs to, shown as Coming soon (unlockables
   * spec §7.3). The sheet is the page's own; the pick never moves.
   */
  let teaser = $state<PackContent | undefined>(undefined);
  function openTeaser(packId: string): void {
    teaser = content()?.packs.find((candidate) => candidate.id === packId && candidate.dlc);
  }

  /** A tap on a chip or on ?: the viewed one picks (or, for DLC, shows its pack), any other is viewed. */
  function press(id: string): void {
    pressed = undefined;
    if (id === viewedId && pickable(id)) pick(id);
    else if (id === viewedId && action.kind === "dlc") openTeaser(action.packId);
    else view(id);
  }

  // A pointer's focus is not a view (see the header). The chip a pointer
  // pressed ignores its next focus, once: a mouse focuses it on the press, and
  // Android's touch focuses it after the finger lifts, so no timer can tell
  // when that focus is done. A tap, a key, a cancel or the next press forgets it.
  let pressed: HTMLElement | undefined;
  const chipOf = (target: EventTarget | null): HTMLElement | undefined =>
    (target instanceof Element ? target.closest<HTMLElement>("[data-testid=tile], [data-testid=tile-random]") : null) ?? undefined;
  function follow(event: FocusEvent): void {
    const tile = chipOf(event.target);
    if (tile === undefined) return;
    if (tile === pressed) {
      pressed = undefined;
      return;
    }
    view(tile.dataset["testid"] === "tile-random" ? RANDOM_ID : (tile.dataset["id"] ?? viewedId));
  }

  let page: HTMLElement | undefined = $state();
  let announcement = $state("");

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (page !== undefined) {
      const worn =
        current === RANDOM_ID
          ? page.querySelector<HTMLElement>("[data-testid=tile-random]")
          : page.querySelector<HTMLElement>(`[data-testid=tile][data-id="${current}"]`);
      focusControl(worn ?? tabbables(page)[0], { within: false });
    }
    return () => {
      clearTimeout(closing);
      focusControl(opener, { within: false });
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    pressed = undefined;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || page === undefined) return;
    const items = tabbables(page);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
    event.preventDefault();
    focusControl(items[next], { within: false });
  }
</script>

<div
  bind:this={page}
  use:lockOverscroll
  role="dialog"
  aria-modal="true"
  aria-labelledby="ff-character-page-title"
  data-testid="character-page"
  data-layout={layout}
  tabindex="-1"
  class="ff-character-page fixed inset-0 z-40 font-ui"
  onkeydown={onKeydown}
>
  <h2 id="ff-character-page-title" class="sr-only">{m.ready_character()}</h2>
  <ScreenFrame arrangement="stack" {settings} back={close} backTestId="character-back" testId="character-frame">
    {#snippet body()}
      <div class="ff-character-page__frame">
        <div class="ff-character-page__stage">
          <CharacterStage
            sheet={viewed.sheet}
            scale={stageScale}
            tone={viewed.tone}
            held={viewed.tone !== "colour"}
            random={viewedId === RANDOM_ID}
            {move}
            {cue}
          />
        </div>

        <!-- The page arrives and leaves as one (the title's `ViewSwitch`), so its panel neither rises nor falls on its own. -->
        <Panel as="section" arrive="none" leave="none" data-testid="character-preview" class="ff-character-page__panel" aria-label={m.ready_character()}>
          <div class="ff-character-page__lead">
            <p data-testid="character-preview-name" class="ff-character-page__name m-0 text-aq-ink" aria-live="polite">{viewed.name}</p>
            <div data-testid="colour-row" class="ff-character-page__colours" role="radiogroup" aria-label={m.ready_colour()}>
              {#each SEAT_COLOURS as option (option)}
                {@const holder = taken.find((held) => held.colour === option)}
                <button
                  type="button"
                  role="radio"
                  data-testid="colour-swatch"
                  data-colour={option}
                  aria-checked={String(option === colour)}
                  aria-label={holder === undefined ? SEAT_COLOUR_NAMES[option]() : m.ready_colour_held({ colour: SEAT_COLOUR_NAMES[option](), seat: holder.seat + 1 })}
                  disabled={holder !== undefined}
                  data-motion="none"
                  class="ff-character-page__colour"
                  onclick={() => chooseColour(option)}
                >
                  <span class="ff-character-page__dot" style:background={`var(--ff-player-${option})`} aria-hidden="true"></span>
                  {#if holder !== undefined}<span class="ff-character-page__holder" aria-hidden="true">{m.ready_seat_short({ seat: holder.seat + 1 })}</span>{/if}
                </button>
              {/each}
            </div>
            {#if action.kind === "picked"}
              <p data-testid="character-pick" role="status" class="ff-character-page__picked m-0">
                <span aria-hidden="true">✓</span> {m.ready_picked()}
              </p>
            {:else if action.kind === "pick"}
              <Button kind="go" data-testid="character-pick" class="ff-character-page__pick" onclick={() => pick(viewedId)}>
                {m.ready_pick({ name: viewed.name })}
              </Button>
            {:else}
              <!-- One row, as tall as Pick: the note and its bar or button share it, so viewing a
                   locked or DLC character leaves the roster where it was. -->
              <div class="ff-character-page__gate">
              <p data-testid="character-preview-access" class="ff-character-page__access m-0">
                {#if action.kind === "locked"}<span data-testid="character-preview-lock" aria-hidden="true">🔒</span>{action.hint}{:else}{m.select_dlc_pack({ pack: action.pack })}{/if}
              </p>
              {#if action.kind === "dlc"}
                {@const packId = action.packId}
                <Button data-testid="character-coming-soon" data-sfx="none" class="ff-character-page__pick" onclick={() => openTeaser(packId)}>
                  {m.select_coming_soon()}
                </Button>
              {/if}
              {#if action.kind === "locked" && action.count !== undefined}
                <div
                  data-testid="character-preview-bar"
                  class="ff-character-page__bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={action.goal}
                  aria-valuenow={action.count}
                  aria-label={m.ready_progress({ count: action.count, goal: action.goal })}
                  style:--ff-progress={`${(action.count / action.goal) * 100}%`}
                >
                  <span class="ff-character-page__count">{action.count}/{action.goal}</span>
                </div>
              {/if}
              </div>
            {/if}
          </div>

          <div
            class="ff-character-page__roster"
            onfocusin={follow}
            onpointerdowncapture={(event) => (pressed = chipOf(event.target))}
            onpointercancelcapture={() => (pressed = undefined)}
          >
            <TileGrid
              onReveal={(id: string) => access.progress?.reveal?.(`character:${id}`)}
              label={m.ready_character()}
              {groups}
              most={MOST[layout]}
              focusedId={current}
              cursors={[{ itemId: current, seat, colour }]}
              random={random ? { label: m.ready_random_character() } : undefined}
              onPress={press}
              announce={(message) => (announcement = message)}
              fitHeight
              previewId={viewedId}
              opensSheet={action.kind === "dlc" ? viewedId : undefined}
              stack
            />
          </div>
        </Panel>
      </div>
    {/snippet}
  </ScreenFrame>
  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

{#if teaser !== undefined}
  {@const loaded = content()}
  {#if loaded !== undefined}
    <ComingSoonSheet pack={teaser} content={loaded} {artSrc} onClose={() => (teaser = undefined)} />
  {/if}
{/if}

<style>
  /* The whole viewport; the ScreenFrame inside lays the page out in the
     visible band, inside the safe area and the gutter, with Back and Mute in
     its corners. No scrim: the callers hide their screens, and the city
     canvas is the page's backdrop. `--ff-page-foot` is the frame's foot
     padding, which the frame below reaches back across so the stage's
     building stands on the band's edge rather than above it. */
  .ff-character-page {
    --ff-page-foot: max(var(--ff-gutter), env(safe-area-inset-bottom));
    /* The dialog spans the visible band, not the bars around it. */
    top: var(--ff-band-top);
    height: var(--ff-band-height);
    bottom: auto;
    background: transparent;
    container: ff-character / inline-size;
  }

  /* Portrait: the stage, the panel. The stage's facade hangs down behind
     the panel, and the frame clips it. */
  .ff-character-page__frame {
    position: relative;
    display: grid;
    min-height: 0;
    /* Clips the facade art hanging behind the panel: art, so paint
       containment rather than overflow, which the screen contract would read
       as hidden; and unlike a clip-path it keeps the art out of the frame's
       scrollable overflow. */
    contain: paint;
    /* Down to the band's edge, so the clip the building hangs into ends
       there; the padding keeps the layout where it was. The height grows by
       the foot too: a box sized to its cell does not grow into a negative
       margin, and the clip stopped a gutter above the band's edge. */
    height: calc(100% + var(--ff-page-foot));
    margin-bottom: calc(-1 * var(--ff-page-foot));
    padding-bottom: var(--ff-page-foot);
    gap: 12px;
    grid-template-areas: "stage" "panel";
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 45fr) minmax(0, 55fr);
  }
  /* A phone upright: the roster needs the height the name, colours and action
     leave, so the stage gives way first (the P1 tile was cut at the bottom). */
  .ff-character-page[data-layout="upright"] .ff-character-page__frame {
    grid-template-rows: minmax(0, 32fr) minmax(0, 68fr);
  }
  /* The smallest phone upright (an iPhone SE): the stage gives way further still, so the
     chosen tile is whole above the panel's bottom edge (review R14). */
  @container ff-screen (max-height: 640px) and (max-width: 599px) {
    .ff-character-page[data-layout="upright"] .ff-character-page__frame {
      grid-template-rows: minmax(0, 28fr) minmax(0, 72fr);
      gap: 8px;
    }
    :global(.ff-character-page[data-layout="upright"] .ff-character-page__panel) { gap: 8px; padding: 12px; }
  }
  .ff-character-page[data-layout="tablet"] .ff-character-page__frame {
    /* The panel gets the larger share: held upright, an iPad's roster needs the height
       to stand every pack as a section (three rows), or it pages three tiles at a time
       and leaves its right third empty. */
    grid-template-rows: minmax(0, 40fr) minmax(0, 60fr);
    gap: 16px;
  }
  /* Wide: the stage on the left above an open strip of building, the panel
     on the right, where the title's panel sits. */
  .ff-character-page:where([data-layout="sideways"], [data-layout="desk"]) .ff-character-page__frame {
    grid-template-areas: "stage panel" "floor panel";
    grid-template-rows: minmax(0, 5fr) minmax(0, 2fr);
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__frame {
    grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);
    gap: 0 8px;
  }
  /* A narrow phone held sideways (667 px, or a 200% zoomed window): the
     lead's one line (name, four swatches, Picked or Coming soon) needs about
     400 px, so the panel takes more of the width (visual audit, 2026-10-05:
     the name ran to "ニン…" and Coming soon off the screen's edge). */
  @container ff-character (max-width: 720px) {
    .ff-character-page[data-layout="sideways"] .ff-character-page__frame {
      grid-template-columns: minmax(0, 35fr) minmax(0, 65fr);
    }
  }
  .ff-character-page[data-layout="desk"] .ff-character-page__frame {
    width: min(100%, 1180px);
    justify-self: center;
    grid-template-columns: minmax(0, 1fr) minmax(0, 480px);
    gap: 16px 40px;
  }

  .ff-character-page__stage {
    grid-area: stage;
    position: relative;
    z-index: 0;
    min-height: 0;
  }
  .ff-character-page[data-layout="desk"] .ff-character-page__stage {
    --ff-roof-left: -4%;
    --ff-roof-right: 10%;
  }

  :global(.ff-character-page__panel) {
    grid-area: panel;
    position: relative;
    z-index: 1;
    display: grid;
    /* One column no wider than the panel: an automatic one grew to the lead
       line's min-content when a locked character's hint joined it, and pushed
       the roster's next arrow off a 667 px screen. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    padding: 16px;
  }
  :global(.ff-character-page[data-layout="sideways"] .ff-character-page__panel) {
    gap: 4px;
    padding: 6px 10px;
    /* As tall as its one line and one row of tiles, centred on the stage, not a tall card
       with the tiles floating in its middle (Owner, 2026-11-19). */
    align-self: center;
  }

  /* Packed, with no row kept empty: the access note and the action follow the colours only when
     there is one, so a chosen character's panel has no blank band between its colours and
     "Picked" (Owner, 2026-11-19: "we don't need that empty space in the middle"). Every action is
     one row as tall as Pick (a locked character's note with its bar, a DLC one's with Coming
     soon), so viewing any character leaves the roster and its tiles where they were. */
  .ff-character-page__lead {
    display: grid;
    justify-items: center;
    align-items: center;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  /* Upright phones are short: the name and the colours share a line, so the
     roster gets the height for rows of tiles, not one tile between arrows. */
  .ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) .ff-character-page__lead {
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 8px;
  }
  .ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) .ff-character-page__name { grid-column: 1; grid-row: 1; justify-self: start; line-height: 1.1; text-align: start; }
  .ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) .ff-character-page__colours { gap: 0; }
  .ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) .ff-character-page__colours { grid-column: 2; grid-row: 1; }
  :global(.ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) :is(.ff-character-page__gate, .ff-character-page__pick, .ff-character-page__picked)) { grid-column: 1 / -1; }
  .ff-character-page[data-layout="desk"] .ff-character-page__lead {
    justify-items: start;
  }
  /* Held sideways, the name, the colours and the action always share one
     line, so the roster below never jumps as the browser's bars come and go:
     the colours and the action keep their size, and a long name gives way
     with an ellipsis. At 667 px wide the panel's line is about 343 px: the
     tight gaps, the action's padding and the name's floor below are what let
     the four 44 px swatches and "Picked ✓" fit beside a name. */
  .ff-character-page[data-layout="sideways"] .ff-character-page__lead {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__name {
    flex: 1 1 auto;
    min-width: 3em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__colours,
  :global(.ff-character-page[data-layout="sideways"] .ff-character-page__pick),
  .ff-character-page[data-layout="sideways"] .ff-character-page__picked {
    flex: none;
  }
  /* One line each: "✓ 選択中" stood on two lines once squeezed. */
  :global(.ff-character-page[data-layout="sideways"] .ff-character-page__pick),
  .ff-character-page[data-layout="sideways"] .ff-character-page__picked {
    padding-inline: 10px;
    white-space: nowrap;
  }
  /* A locked character's hint gives way before the name does; the bar has no
     room on the line, so its count is left to the other form factors. */
  .ff-character-page[data-layout="sideways"] .ff-character-page__gate {
    /* Its own width on the line, not the whole of it: at 100% it took the
       shrink from the name, which then cut before the hint did. */
    width: auto;
    flex: 0 1 auto;
    min-width: 0;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__access {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__bar {
    display: none;
  }
  .ff-character-page__name {
    font: 800 var(--ff-type-hero) / 1.05 var(--ff-font-ui);
  }
  .ff-character-page:where([data-layout="upright"], [data-layout="tablet"]) .ff-character-page__name { font-size: var(--ff-type-title); }
  .ff-character-page[data-layout="tablet"] .ff-character-page__name {
    font-size: var(--ff-type-display);
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__name {
    font-size: var(--ff-type-title);
    /* Room for the descenders the one-line clip would cut. */
    line-height: 1.25;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__colours {
    gap: 0;
  }
  .ff-character-page[data-layout="sideways"] .ff-character-page__dot {
    width: 22px;
    height: 22px;
  }
  /* Four 44 px swatches: the dot is the colour; yours carries a ring, and one
     another player holds is dimmed under their flag. */
  .ff-character-page__colours {
    display: flex;
    gap: 4px;
  }
  .ff-character-page__colour {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--ff-aq-target);
    height: var(--ff-aq-target);
    border: 0;
    border-radius: var(--ff-control-radius);
    background: transparent;
  }
  /* Rounded squares, as the controls around them are; the rings follow. */
  .ff-character-page__dot {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    box-shadow: 0 0 0 2px var(--ff-panel-fill);
  }
  /* A colour another player holds stays at full strength: flagged with the
     holder's seat, never faded or struck (audit m5). The global disabled
     fade is undone. */
  .ff-character-page__colour:disabled { opacity: 1; }
  .ff-character-page__colour:not(:disabled) .ff-character-page__dot {
    box-shadow: 0 0 0 2px var(--ff-panel-fill), 0 0 0 3px var(--ff-text);
  }
  /* Chosen: plain text with a tick, so nothing about it asks to be pressed. */
  .ff-character-page__picked {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--ff-aq-target);
    padding: 0 8px;
    font: 600 var(--ff-type-body) / 1 var(--ff-font-ui);
    color: var(--ff-text);
  }
  /* Your own colour reads strongest: after the available ring, which it outranks. */
  .ff-character-page__colour[aria-checked="true"] .ff-character-page__dot {
    box-shadow: 0 0 0 2px var(--ff-panel-fill), 0 0 0 4px var(--ff-text);
  }
  .ff-character-page__holder {
    position: absolute;
    inset: auto 0 0 0;
    padding: 0 2px;
    border-radius: 4px;
    text-align: center;
    font: 600 var(--ff-type-hint) / 16px var(--ff-font-ui);
    color: var(--ff-text);
    /* Ink, not a panel: a seat tag on a swatch. */
    background: var(--ff-panel-border);
  }
  :global(.ff-character-page__pick) {
    width: 100%;
    min-height: var(--ff-aq-target);
  }
  :global(.ff-character-page[data-layout="sideways"] .ff-character-page__pick) {
    width: auto;
    padding-inline: 8px;
  }
  .ff-character-page__gate {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    min-width: 0;
    height: var(--ff-aq-target);
  }
  .ff-character-page[data-layout="desk"] .ff-character-page__gate {
    justify-content: flex-start;
  }
  .ff-character-page__gate :global(.ff-character-page__pick) {
    flex: none;
    width: auto;
  }
  .ff-character-page__access {
    min-width: 0;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: var(--ff-aq-target);
    font-size: var(--ff-type-hint);
    color: var(--ff-text-2);
  }
  .ff-character-page__bar {
    position: relative;
    flex: 0 1 160px;
    min-width: 64px;
    height: 6px;
    /* Room above for its count, inside the row. */
    margin-top: 16px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--ff-plain) var(--ff-progress), color-mix(in srgb, var(--ff-plain) 20%, transparent) 0);
  }
  .ff-character-page__count {
    position: absolute;
    bottom: 8px;
    left: 0;
    font-size: var(--ff-type-tag);
    color: var(--ff-text-2);
  }
  /* The tiles sit right under the ? chip, not centred in the roster with a gap above them;
     held sideways the row is one line between its arrows, centred on them. */
  .ff-character-page:not([data-layout="sideways"]) .ff-character-page__roster :global(.ff-tiles--fill .ff-tiles__viewport) {
    justify-content: flex-start;
  }
  /* Room under the tiles for the chosen tile's outline, which a roster sized to its tiles
     would otherwise clip at its foot. */
  .ff-character-page__roster :global(.ff-tiles__viewport) {
    padding-bottom: 4px;
  }
  .ff-character-page__roster {
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
</style>
