<script lang="ts">
  /**
   * The language radio group (languages spec §5): "Automatic", in words
   * alone, then the six languages, a flag and its name, two to a line. Settings holds it among its
   * groups; the title's flag button opens it alone, larger, in a modal.
   * Each option keeps its endonym, in its own `lang`, as its accessible
   * name. Picking one applies at once; nothing remounts, so focus stays on
   * it until `onChosen` says what to do next.
   */
  import * as m from "../../paraglide/messages.js";
  import { ENDONYMS, LOCALE_FLAGS, LOCALE_TAGS, type LocaleTag } from "../i18n/locales";
  import { applyLocale, detectedLocale } from "../i18n/strategy";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import LanguageFlag from "../kit/LanguageFlag.svelte";
  import { pickPulse } from "../kit/pick-pulse";

  let {
    settings,
    testIdPrefix = "settings-language",
    large = false,
    onChosen,
  }: {
    settings: SettingsStore;
    testIdPrefix?: string;
    /** The modal's tiles: bigger flags, more room between them. */
    large?: boolean;
    /** After a pick has applied (not one a later pick overtook), with the language now in play. */
    onChosen?: (locale: LocaleTag) => void;
  } = $props();

  /** What Automatic would choose: the browser's first language the game has. */
  const detected = detectedLocale();

  /** The six languages, two to a line now each carries its name: a line is one row to a scroll list. */
  const FLAG_LINES = [LOCALE_TAGS.slice(0, 2), LOCALE_TAGS.slice(2, 4), LOCALE_TAGS.slice(4)];

  async function choose(choice: LocaleTag | null): Promise<void> {
    // A pick overtaken by a later one (its face still loading) says nothing.
    if (!(await applyLocale(choice))) return;
    onChosen?.(choice ?? detected);
  }
</script>

<div use:pickPulse role="radiogroup" aria-label={m.settings_language()} class="ff-language-picker" data-large={large ? "" : undefined}>
  <label class="ff-language-picker__option" data-row>
    <input
      type="radio"
      name="ff-language"
      data-testid={`${testIdPrefix}-auto`}
      checked={settings.value.locale === null}
      onchange={() => void choose(null)}
    />
    <!-- A word alone, with no flag: a country's flag on the default read as
         that country being everyone's. Screen readers still hear which
         language it answers. -->
    <span class="ff-aq-body">
      {m.settings_language_automatic()}
      <span class="sr-only" lang={detected}>{ENDONYMS[detected]}</span>
    </span>
  </label>
  {#each FLAG_LINES as line, i (i)}
    <div class="ff-language-picker__flags" data-row>
      {#each line as tag (tag)}
        <label class="ff-language-picker__option" lang={tag}>
          <input
            type="radio"
            name="ff-language"
            data-testid={`${testIdPrefix}-${tag}`}
            checked={settings.value.locale === tag}
            onchange={() => void choose(tag)}
          />
          <LanguageFlag country={LOCALE_FLAGS[tag]} size={large ? "large" : "medium"} />
          <span class="ff-aq-body ff-language-picker__name">{ENDONYMS[tag]}</span>
        </label>
      {/each}
    </div>
  {/each}
</div>

<style>
  /* Automatic on its own row, then the languages two to a line (a scroll list
     counts lines for its reserve); each choice a full 44 px target. */
  .ff-language-picker {
    display: grid;
    gap: 4px;
  }
  .ff-language-picker__option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-block-size: 44px;
    cursor: pointer;
  }
  /* The language's own name, in the face that carries every script. */
  .ff-language-picker__name {
    min-width: 0;
    font-family: var(--ff-font-endonym);
    /* A name breaks only at a space ("Português / (Brasil)"), never inside a
       word: "日本 / 語" and "Ajus-tes" read as two words (review R3). */
    hyphens: none;
    word-break: keep-all;
    overflow-wrap: normal;
  }
  .ff-language-picker__flags {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 16px;
  }
  .ff-language-picker[data-large] {
    gap: 12px;
  }
  .ff-language-picker[data-large] .ff-language-picker__flags {
    gap: 12px 20px;
  }

  /* A narrow dialog (a small phone upright): a smaller flag and a tighter
     line, so each name has the room to stand whole beside it (review R4). */
  @container ff-dialog (max-width: 360px) {
    .ff-language-picker__option {
      gap: 6px;
    }
    .ff-language-picker__flags,
    .ff-language-picker[data-large] .ff-language-picker__flags {
      gap: 4px 8px;
    }
    .ff-language-picker__option :global(.ff-flag) {
      inline-size: 36px;
      block-size: 24px;
    }
  }

  /* On a short, wide band (a phone held sideways), in a one-column dialog:
     Automatic and the six languages four to a line, so all seven show in two
     lines with none cut, above Continue or the settings' next group (review
     R4/R5). Each line steps aside (`contents`) and its two choices join one
     four-column grid. A wider dialog sets the settings two across instead,
     where a column is too narrow for this. */
  @container ff-modal (max-height: 480px) and (min-width: 520px) {
    @container ff-dialog (min-width: 460px) and (max-width: 680px) {
      .ff-language-picker,
      .ff-language-picker[data-large] {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 4px 10px;
      }
      .ff-language-picker__flags {
        display: contents;
      }
      .ff-language-picker__option {
        gap: 6px;
      }
      .ff-language-picker__option :global(.ff-flag) {
        inline-size: 30px;
        block-size: 20px;
      }
    }
  }
</style>
