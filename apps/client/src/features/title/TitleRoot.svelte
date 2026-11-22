<script lang="ts">
  /**
   * The title (launch polish spec §3.1.1): the accepted menu composition with
   * the player's choices in place of the connect form.
   *
   * It composes phase 1d's `MenuHero` and `MenuSheet` in the same
   * `ScreenFrame` and arrangement the lobby's connect form uses, so the hero,
   * the ledge and the sheet sit exactly where they do there on every form
   * factor (UI layout spec §6.1).
   *
   * Quit shows only where closing works -- an installed app -- because a
   * browser tab cannot close itself, and a Quit that does nothing is a lie.
   * Inside Ruken it always shows, and hands the player back to the host
   * (Ruken P6 §4); the title has no race to lose, so it asks nothing first.
   */
  import * as m from "../../paraglide/messages.js";
  import { type AccessOptions, NO_ACCESS } from "../profile/access";
  import { VERSION_TAG } from "../../lib/version";
  import ScreenFrame from "../kit/layout/ScreenFrame.svelte";
  import { menuArrangement, screenLayout } from "../kit/screen-arrangement";
  import { formFactor, heightTier } from "../platform/viewport-tracking.svelte";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import MenuHero from "../lobby/MenuHero.svelte";
  import { menuLineup } from "../select/menu-lineup";
  import MenuSheet from "../settings/MenuSheet.svelte";
  import Modal from "../kit/Modal.svelte";
  import SettingsPanel from "../settings/SettingsPanel.svelte";
  import LanguagePicker from "../settings/LanguagePicker.svelte";
  import { ENDONYMS } from "../i18n/locales";
  import ContactPanel from "../settings/ContactPanel.svelte";
  import Instructions from "../lobby/Instructions.svelte";
  import QuickActions from "../lobby/QuickActions.svelte";
  import CharacterPage from "../select/CharacterPage.svelte";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import { portraitAliasFor } from "../profile/character-art";
  import Button from "../kit/Button.svelte";
  import Panel from "../kit/Panel.svelte";
  import ViewSwitch from "../kit/ViewSwitch.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import type { WordmarkPlaces } from "../boot/wordmark-handoff";
  import { currentHosting } from "../ruken/current";

  let {
    onPlay,
    settings,
    heroRises = true,
    racersDrop = false,
    wordmarkFrom,
    content = () => undefined,
    artSrc = () => undefined,
    access = NO_ACCESS,
  }: {
    onPlay: () => void;
    settings: SettingsStore;
    /** Off when arriving from the lobby, whose hero is already on screen. */
    heroRises?: boolean;
    /** On when arriving from the splash: the racers fall onto the ledge. */
    racersDrop?: boolean;
    /** Where the splash left its wordmark, for the hero's to slide over from. */
    wordmarkFrom?: WordmarkPlaces | undefined;
    /** A getter, because the artifact can be replaced while the title is up. */
    content?: () => GameContentPayload | undefined;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc?: (alias: string) => string | undefined;
    /** What this device may pick: the dev flag, what it earned and what it owns. */
    access?: AccessOptions;
  } = $props();

  /** Which modal is open, if any; one at a time. */
  let open = $state<"settings" | "language" | "contact" | "home-screen" | "instructions" | "character" | undefined>();
  /** A pick in the Language modal, said once it has closed, as the Settings panel says it (languages spec §5). */
  let announcement = $state("");

  /** Opens Settings, for the Ruken host's menu button (P6 §4); a modal already open gives way to it. */
  export function openSettings(): void {
    open = "settings";
  }

  const hosting = currentHosting();
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
</script>

<section
  data-testid="title"
  data-under-page={open === "character" ? "" : undefined}
  class="ff-menu ff-screen overflow-x-hidden font-ui"
>
  <ScreenFrame
    arrangement={menuArrangement(formFactor.current, heightTier.current)}
    {settings}
    language={() => (open = "language")}
    testId="title-frame"
  >
    {#snippet hero()}
      <MenuHero
        rise={heroRises}
        drop={racersDrop}
        {wordmarkFrom}
        centred={formFactor.current === "tablet-portrait" || formFactor.current === "phone-portrait"}
        racers={menuLineup(
          { characterId: settings.value.profile.lastCharacter, colour: settings.value.profile.lastColour },
          settings.value.profile.lastSeen,
        )}
      />
    {/snippet}
    {#snippet body()}
      <MenuSheet>
        <nav aria-label={m.title_nav()} class="ff-title__panel">
          <!-- Gap and padding are the cards' tokens (12 / 16 on a phone held
               upright, 8 / 12 on a short screen, 20 / 24 otherwise); a phone
               held sideways sets Character beside Play and Settings across the row under them.
               The kit panel: it rises first (stagger 1) and falls out as Play, Character or a sheet
               takes over. -->
          <Panel
            order={1}
            class="ff-title__card grid gap-[var(--ff-panel-gap)] p-[var(--ff-panel-pad)] phone-l:grid-cols-2"
          >
            <Button kind="go" split data-testid="title-play" class="ff-title__play" onclick={onPlay}>
              <span>{m.title_play()}</span> <span aria-hidden="true">→</span>
            </Button>
            <!-- The character select's own page (select spec §6.1): at the title
                 a pick is only remembered, and the first join wears it. A phone
                 held sideways sets it beside Play, so the panel gains no row. -->
            <Button kind="ghost" data-testid="title-character" class="ff-title__character" onclick={() => (open = "character")}>
              <AsyncImage
                src={artSrc(portraitAliasFor(content(), settings.value.profile.lastCharacter, settings.value.profile.lastColour, "neutral"))}
                width={28}
                height={28}
                class="ff-portrait"
                ring={false}
              />
              {m.title_character()}
            </Button>
            <Button kind="ghost" data-testid="title-settings" data-sfx="none" class="phone-l:col-span-2" onclick={() => (open = "settings")}>
              {m.title_settings()}
            </Button>
            {#if hosting.hosted || standalone}
              <Button
                kind="ghost"
                data-testid="title-quit"
                class="phone-l:col-span-2"
                onclick={() => (hosting.hosted ? void hosting.exit() : window.close())}
              >
                {m.title_quit()}
              </Button>
            {/if}
            <!-- The quick actions close the panel, on its glass: over the
                 building's dark windows their words lost their contrast. -->
            <!-- `min-w-0`: the quick actions' unwrapped row must not widen the
                 card; the bar measures what the card gives it and gives way. -->
            <div class="min-w-0 phone-l:col-span-2">
              <QuickActions
                onInstructions={() => (open = "instructions")}
                onContact={() => (open = "contact")}
                onHomeScreen={() => (open = "home-screen")}
              />
            </div>
          </Panel>
        </nav>
      </MenuSheet>
    {/snippet}
  </ScreenFrame>
  <!-- What the player is on, for a bug report: tiny, in the top-left corner
       above the corner row (which the title leaves empty at that side), and
       no stop for focus or the pointer. Never near the menu panel. -->
  <Panel order={2} class="ff-title__version" data-testid="title-version">{VERSION_TAG}</Panel>
</section>

<!-- The Character page cross-fades in and out over the menu instead of cutting (audit, batch 2). The
     switch holds nothing while the menu shows, and the page is fixed over the screen. -->
<ViewSwitch view={open === "character" ? "character" : "menu"}>
  {#snippet children(view)}
    {#if view === "character"}
      <CharacterPage
        layout={screenLayout(formFactor.current)}
        {content}
        {artSrc}
        colour={settings.value.profile.lastColour}
        current={settings.value.profile.lastCharacter}
        {access}
        seat={0}
        random={false}
        {settings}
        onPick={(id) => settings.update({ profile: { lastCharacter: id } })}
        onPickColour={(colour) => settings.update({ profile: { lastColour: colour } })}
        onClose={() => (open = undefined)}
      />
    {/if}
  {/snippet}
</ViewSwitch>

{#if open === "settings"}
  <Modal title={m.title_settings()} testId="settings-modal" onClose={() => (open = undefined)}>
    <SettingsPanel {settings} />
  </Modal>
{:else if open === "language"}
  <!-- The flags alone, larger: a pick applies and closes, and focus goes back
       to the flag, now the new language's. -->
  <Modal title={m.settings_language()} testId="language-modal" onClose={() => (open = undefined)}>
    <LanguagePicker
      {settings}
      testIdPrefix="title-language"
      large
      onChosen={(locale) => {
        open = undefined;
        announcement = m.settings_language_changed({ language: ENDONYMS[locale] });
      }}
    />
  </Modal>
{:else if open === "instructions"}
  <Instructions {settings} prompts={content()?.prompts} {artSrc} onClose={() => (open = undefined)} />
{:else if open === "contact"}
  <Modal title={m.title_contact()} testId="contact-modal" onClose={() => (open = undefined)}>
    <ContactPanel />
  </Modal>
{:else if open === "home-screen"}
  <Modal title={m.shell_fullscreen_ios_title()} testId="home-screen-modal" onClose={() => (open = undefined)}>
    <p class="ff-aq-body m-0 text-aq-ink">
      {m.shell_fullscreen_ios_body()}
    </p>
  </Modal>
{/if}

<p class="sr-only" role="status" aria-live="polite" data-testid="title-announcer-region">{announcement}</p>

<style>
  /* Under the Character page, which draws no sheet of its own: the city
     canvas is its backdrop, and nothing of this screen shows through. */
  .ff-menu[data-under-page] {
    opacity: 0;
    pointer-events: none;
  }
  /* The menu and the page cross-fade over the screen fade's 200 ms, in the chrome's steps, and are
     a cut under reduced motion. The page's own half is the `ViewSwitch` below. */
  .ff-menu {
    transition: opacity 200ms steps(8);
  }
  @media (prefers-reduced-motion: reduce) {
    .ff-menu {
      transition: none;
    }
  }
  /* A phone held upright: the hero's cell is a size container the wordmark
     shrinks to (MenuHero), as in the lobby, so a notice at the top (which
     takes the hero's room) never leaves the wordmark under the menu panel. */
  :global([data-form-factor="phone-portrait"]) .ff-menu :global(.ff-screen-frame[data-arrangement="stack"] > .ff-screen-frame__content > .ff-screen-frame__hero) {
    container: ff-hero / size;
  }
  /* The 12 px label floor (responsive spec §4.7): readable on any sky because it sits
     on a panel strip, never because of a size a phone cannot read. It sits in the strip above the corner
     row (the frame's top gutter is 12 px at least), clear of a notch, and
     never under the panel or the racers. */
  /* The kit panel's own root takes these classes, so they are `:global`. */
  :global(.ff-title__version) {
    position: absolute;
    left: max(8px, env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    top: max(0px, env(safe-area-inset-top));
    font-size: var(--ff-type-hint);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--ff-text);
    /* The glass panel, like the tagline: white holds its contrast on any sky. */
    border-width: 1px;
    padding: 2px 6px;
    border-radius: 4px;
    pointer-events: none;
    user-select: none;
  }
  :global(.ff-title__character) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .ff-title__panel {
    display: block;
    width: 100%;
  }

  /* Character and Settings: the control's height, taller on a
     tablet held upright (`--ff-title-tile-height`, aquarian-tokens.css). */
  :global(.ff-title__card > .ff-aq-control--ghost) {
    min-height: var(--ff-title-tile-height);
  }

  /* The SE upright: six rows and the words on every button are a lot for 568
     px, so the card's gap and padding close up (6 / 8) and the racers keep
     their room above it. */
  :global([data-form-factor="phone-portrait"][data-height="short"] .ff-title__card) {
    gap: 6px;
    padding: 8px;
  }
  /* The quick actions' own rows (two bars, each wrapping) close up with it. */
  :global([data-form-factor="phone-portrait"][data-height="short"] .ff-quick),
  :global([data-form-factor="phone-portrait"][data-height="short"] .ff-quick [data-row="visible"]) {
    gap: 3px;
  }

  /* A phone held sideways, or upright on a short screen (the SE): the choices at
     the 44 px touch floor rather than 48 / 52, as the connect form sets its
     controls there, so the racers keep their room above the panel. Unlayered, so it
     outranks the components-layer control sizes. */
  :global([data-form-factor="phone-landscape"] .ff-title__card .ff-aq-control),
  :global([data-form-factor="phone-portrait"][data-height="short"] .ff-title__card .ff-aq-control) {
    min-height: var(--ff-aq-target);
  }

  /* The panel's other choices centre their words, so Play does too, with its
     arrow still at the right edge: the word takes the middle of three
     columns, and the outer two share what is left evenly. */
  :global(.ff-title__play) {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
  }

  :global(.ff-title__play > :first-child) {
    grid-column: 2;
  }

  :global(.ff-title__play > :last-child) {
    justify-self: end;
  }

  /* A phone held sideways has no room for a notice above the menu, which it covered half of
     (review R33: "lost your seat" over Play and Character). On the title it sits at the foot of
     the wordmark's column instead, over art and never over a button. */
  /* The notice covers the tagline's column there: the line goes while it
     shows, rather than a sliver of half-cut words above it (R38 re-check). */
  :global(:root[data-form-factor="phone-landscape"]:has(.ff-notice:not([hidden])) [data-testid="title"] .ff-tagline) {
    visibility: hidden;
  }

  :global(:root[data-form-factor="phone-landscape"]:has([data-testid="title"]) .ff-notice) {
    top: auto;
    bottom: max(var(--ff-gutter), env(safe-area-inset-bottom));
    margin-inline: 0;
    left: max(var(--ff-gutter), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    right: auto;
    /* As wide as the wordmark's column (the window less the menu sheet and
       the gutters), so it reads in whole lines (review R38: at 29% the SE
       read one word a line). */
    max-width: calc(
      100% - var(--ff-sheet-width) * var(--ff-ui-zoom, 1) - 3 * var(--ff-gutter) - env(safe-area-inset-left, 0px) -
        env(safe-area-inset-right, 0px)
    );
  }
</style>
