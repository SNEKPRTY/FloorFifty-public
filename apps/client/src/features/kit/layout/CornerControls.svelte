<script lang="ts">
  /**
   * Back and Mute, in the same two corners on every shell screen (UI layout
   * system spec §2.1 rule 4, audit m2). A screen does not render its own.
   * The pause menu and the Settings checkbox keep theirs; the M key stays.
   * `header` sits between them in the same row: the ready room's code, so a
   * short screen spends no row of its own on it. `headerAt` says where: on
   * the screen's centre line, or at the start, against the panel's left edge
   * (a portrait room, whose panel spans the row).
   */
  import * as m from "../../../paraglide/messages.js";
  import type { Snippet } from "svelte";
  import { ENDONYMS, LOCALE_FLAGS } from "../../i18n/locales";
  import { activeLocale } from "../../i18n/strategy";
  import LanguageFlag from "../LanguageFlag.svelte";
  import Button from "../Button.svelte";
  import MuteButton from "../MuteButton.svelte";
  import type { SettingsStore } from "../../profile/store/settings.svelte";

  let {
    settings,
    back,
    backTestId = "corner-back",
    mute = true,
    language,
    header,
    headerAt = "centre",
  }: {
    settings: SettingsStore;
    back?: () => void;
    backTestId?: string;
    mute?: boolean;
    /** Beside Mute, a flag for the language in play, which opens the picker (the title). */
    language?: () => void;
    /** Between the corners, in the same row: the ready room's code. */
    header?: Snippet;
    headerAt?: "centre" | "start";
  } = $props();
</script>

<div data-corner-controls data-header-at={headerAt} class="ff-corners">
  <div class="ff-corners__start">
    {#if back !== undefined}
      <Button kind="ghost" data-testid={backTestId} data-sfx="back" onclick={back}>
        <span aria-hidden="true">←</span> {m.shell_back()}
      </Button>
    {/if}
  </div>
  <div class="ff-corners__middle">{#if header !== undefined}{@render header()}{/if}</div>
  <div class="ff-corners__end">
    {#if language !== undefined}
      <!-- The flag finds the way out for a player lost in a language, and its
           own name, beside it, says what it is (every button has a word). The
           name is without a bracketed region ("Português"): the corner row is
           narrow. Quiet: the modal it opens plays ui.open (polish spec §8.2). -->
      <Button kind="ghost" data-testid="title-language" data-sfx="none" class="ff-corners__language" onclick={language}>
        <LanguageFlag country={LOCALE_FLAGS[activeLocale()]} size="corner" />
        <span class="ff-corners__language-word">{ENDONYMS[activeLocale()].replace(/\s*\(.*\)/, "")}</span>
      </Button>
    {/if}
    {#if mute}<MuteButton {settings} />{/if}
  </div>
</div>

<style>
  /* One row, the same height on every screen: the touch target, and no more.
     A size container, so the Mute word can give way on a narrow row. The two
     corners share what the middle leaves equally, so the middle stands on the
     screen's centre line, over the content, whether or not there is a Back:
     with `auto` corners, Mute's width alone pushed the room code left. */
  .ff-corners {
    container-type: inline-size;
    display: grid;
    grid-template-columns: 1fr minmax(0, max-content) 1fr;
    align-items: center;
    gap: 8px;
    min-height: var(--ff-corner-h);
  }
  .ff-corners__middle {
    min-width: 0;
  }
  /* Nothing between the corners (the title, a lone Back): the end takes the
     room it needs, not half the row, so the language and Mute share one row
     on the narrowest phone. */
  .ff-corners:has(.ff-corners__middle:empty) {
    grid-template-columns: 1fr max-content;
  }
  .ff-corners[data-header-at] .ff-corners__middle:empty {
    display: none;
  }
  .ff-corners[data-header-at="start"] .ff-corners__middle:empty ~ .ff-corners__end {
    margin-inline-start: auto;
  }
  /* Back is one word on one line, whatever the header beside it asks for:
     the start corner keeps the room Back needs, so "Volver" is never split. */
  .ff-corners__start {
    flex: none;
  }
  .ff-corners__start > :global(.ff-aq-control) {
    white-space: nowrap;
  }
  /* The narrowest phones (a row under 300 px, the small iPhone's 286): with
     Back one line wide, a long Back and a long Mute ("Volver", "Silenciar")
     share the row only if Back takes snugger sides (8 px, not 12). Mute keeps
     its 12 px; Back alone gives up the room. */
  @container (max-width: 300px) {
    .ff-corners__start > :global(.ff-aq-control) {
      padding-inline: 8px;
    }
  }
  .ff-corners__end {
    justify-self: end;
    display: flex;
    /* A row too narrow for both words puts the second under the first, whole. */
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  /* Snug sides, so the language and Mute, each with its word, share one row
     on the narrowest phone (320 px) in every language. */
  .ff-corners__end > :global(.ff-aq-control) {
    padding-inline: 12px;
  }
  :global(.ff-corners__language) {
    min-inline-size: var(--ff-aq-target);
    justify-content: center;
    gap: 8px;
  }
  .ff-corners__language-word {
    white-space: nowrap;
  }
  /* Phones held upright (a row of 400 px or less): the language's word sits
     small under its flag, as Mute's does beside the room code, so the two
     share one row in every language and each keeps its word. Both words
     side by side wrapped to two rows in Spanish and Portuguese, which pushed
     the title's racers down behind its menu (review R6/R7), and side by side
     they ran under the version tag on a Pixel 7 in Spanish. */
  @container (max-width: 400px) {
    :global(.ff-corners__language) {
      flex-direction: column;
      gap: 2px;
      padding-inline: 6px;
    }
    .ff-corners__language-word {
      font-size: var(--ff-type-hint);
      line-height: 1;
    }
    /* Mute beside it the same way, so the pair stays clear of the version
       tag in the title's top-left corner. */
    .ff-corners:has(:global(.ff-corners__language)) .ff-corners__end > :global(.ff-mute) {
      flex-direction: column;
      gap: 2px;
      padding-inline: 6px;
    }
    .ff-corners:has(:global(.ff-corners__language)) .ff-corners__end :global(.ff-mute__word) {
      font-size: var(--ff-type-hint);
      line-height: 1;
    }
  }
  /* At the start: the header takes the row's left, after Back when there is
     one (an empty start holds no column, so the code meets the panel's edge),
     and Mute keeps its corner. */
  .ff-corners[data-header-at="start"] {
    display: flex;
  }
  .ff-corners[data-header-at="start"] .ff-corners__start:empty {
    display: none;
  }
  /* Its own size container: the header gives way by the room it has between
     Back's place and Mute, not by the whole row's (Mute's word is wider in
     some languages). */
  .ff-corners[data-header-at="start"] .ff-corners__middle {
    display: flex;
    flex: 1;
    container-type: inline-size;
    /* Under the panel's left edge and inside its padding: the panel is no
       wider than the content maximum and is centred, while the row spans the
       band. */
    margin-inline-start: calc(max(0px, (100cqw - var(--ff-content-max, 100cqw)) / 2) + var(--ff-panel-pad));
  }
</style>
