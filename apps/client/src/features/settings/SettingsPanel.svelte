<script lang="ts">
  /**
   * Settings and controls (launch polish §3.1.2).
   *
   * Every control reads `settings.value` and writes through
   * `settings.update`, which saves and applies live: there is no Apply
   * button, because there is nothing to hold back. The Controls tab leads
   * with the input the player last used (`inputMethod`), and names a
   * controller's buttons in its own family's labels.
   */
  import * as m from "../../paraglide/messages.js";
  import type { QualitySetting } from "../profile/settings";
  import { formatPercent } from "../i18n/format";
  import { ENDONYMS } from "../i18n/locales";
  import { GLYPHS } from "../i18n/glyphs";
  import { requestUiSound } from "../kit/ui-sounds";
  import { inputMethod, type InputMethod } from "../platform/input-method.svelte";
  import LanguagePicker from "./LanguagePicker.svelte";
  import TouchGuide from "./TouchGuide.svelte";
  import Button from "../kit/Button.svelte";
  import { pickPulse } from "../kit/pick-pulse";
  import InfoSheet from "../kit/layout/InfoSheet.svelte";
  import ScrollList from "../kit/layout/ScrollList.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";

  let { settings, initialTab = "settings" }: { settings: SettingsStore; initialTab?: "settings" | "controls" } =
    $props();

  let tab = $state<"settings" | "controls">(initialTab);

  /** The touch mode only means something where a finger is the pointer. */
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  // Message functions, called in the template, so the labels follow a language switch.
  const QUALITIES: { value: QualitySetting; label: () => string }[] = [
    { value: "high", label: m.settings_quality_high },
    { value: "medium", label: m.settings_quality_medium },
    { value: "low", label: m.settings_quality_low },
  ];

  /** The three ways to play, with the one in the player's hand first. */
  const SECTIONS: InputMethod[] = ["keyboard", "gamepad", "touch"];
  const order = $derived([inputMethod.method, ...SECTIONS.filter((method) => method !== inputMethod.method)]);
  const glyphs = $derived(GLYPHS[inputMethod.family]);

  /** Said once, after a switch, in the new language: read after the switch, so it is spoken in the language just chosen. */
  let announcement = $state("");

  /** Rows each section holds, for the list's reserve: the touch row only on a touch screen, Automatic and the three language lines. */
  const rowCount = $derived(tab === "settings" ? (coarse ? 9 : 8) + 5 : 11);

  /** The privacy note's lines, each a row of the list. */
  const PRIVACY = [m.shell_privacy_name, m.shell_privacy_device, m.shell_privacy_no_cookies, m.shell_privacy_errors, m.shell_privacy_contact, m.shell_privacy_ruken];
</script>

<!-- The tabs stay put and the section scrolls under them, in the one list
     that fades and counts what is below (ui layout spec §5): on a phone held
     sideways the dialog holds two rows, and a scroll with no sign of it hid
     every setting after Music. -->
<div class="ff-settings text-aq-ink" data-dialog-body data-two-up>
  <div role="tablist" aria-label={m.settings_sections()} class="flex gap-8">
    <Button
      kind="ghost"
      role="tab"
      data-testid="settings-tab-settings"
      aria-selected={tab === "settings"}
      selected={tab === "settings"}
      class="ff-settings__tab"
      onclick={() => (tab = "settings")}
    >
      {m.settings_tab_settings()}
    </Button>
    <Button
      kind="ghost"
      role="tab"
      data-testid="settings-tab-controls"
      aria-selected={tab === "controls"}
      selected={tab === "controls"}
      class="ff-settings__tab"
      onclick={() => (tab = "controls")}
    >
      {m.settings_tab_controls()}
    </Button>
  </div>

  <ScrollList minRows={2} {rowCount} label={tab === "settings" ? m.settings_tab_settings() : m.settings_tab_controls()} testId="settings-scroll">
  {#if tab === "settings"}
    <div role="tabpanel" class="grid gap-16">
      <fieldset class="ff-settings__group">
        <legend class="ff-aq-label">{m.settings_language()}</legend>
        <LanguagePicker {settings} onChosen={(locale) => (announcement = m.settings_language_changed({ language: ENDONYMS[locale] }))} />
      </fieldset>

      <fieldset class="ff-settings__group" use:pickPulse>
        <legend class="ff-aq-label">{m.settings_audio()}</legend>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-mute"
            checked={settings.value.audio.muted}
            onchange={(event) => settings.update({ audio: { muted: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_mute()}</span>
        </label>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-mute-unfocused"
            checked={settings.value.audio.muteUnfocused}
            onchange={(event) => settings.update({ audio: { muteUnfocused: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_mute_unfocused()}</span>
        </label>
        <div class="ff-settings__row" data-row>
          <label for="ff-settings-music" class="ff-aq-body ff-settings__name">{m.settings_music()}</label>
          <input
            id="ff-settings-music"
            type="range"
            min="0"
            max="1"
            step="0.05"
            data-testid="settings-music"
            value={settings.value.audio.music}
            oninput={(event) => settings.update({ audio: { music: Number(event.currentTarget.value) } })}
          />
          <span class="ff-aq-secondary ff-settings__value">{formatPercent(settings.value.audio.music)}</span>
        </div>
        <div class="ff-settings__row" data-row>
          <label for="ff-settings-sfx" class="ff-aq-body ff-settings__name">{m.settings_effects()}</label>
          <input
            id="ff-settings-sfx"
            type="range"
            min="0"
            max="1"
            step="0.05"
            data-testid="settings-sfx"
            value={settings.value.audio.sfx}
            oninput={(event) => settings.update({ audio: { sfx: Number(event.currentTarget.value) } })}
            onchange={(event) => requestUiSound(event.currentTarget, "effectsSample")}
          />
          <span class="ff-aq-secondary ff-settings__value">{formatPercent(settings.value.audio.sfx)}</span>
        </div>
        <div class="ff-settings__row" data-row>
          <label for="ff-settings-announcer" class="ff-aq-body ff-settings__name">{m.settings_announcer()}</label>
          <input
            id="ff-settings-announcer"
            type="range"
            min="0"
            max="1"
            step="0.05"
            data-testid="settings-announcer"
            value={settings.value.audio.announcer}
            oninput={(event) => settings.update({ audio: { announcer: Number(event.currentTarget.value) } })}
            onchange={(event) => requestUiSound(event.currentTarget, "voiceSample")}
          />
          <span class="ff-aq-secondary ff-settings__value">{formatPercent(settings.value.audio.announcer)}</span>
        </div>
        <!-- The controller's rumble and a phone's buzz: feedback beside the sound. -->
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-rumble"
            checked={settings.value.input.rumble}
            onchange={(event) => settings.update({ input: { rumble: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_rumble()}</span>
        </label>
      </fieldset>

      <fieldset class="ff-settings__group" use:pickPulse>
        <legend class="ff-aq-label">{m.settings_display()}</legend>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-lcd"
            checked={settings.value.display.lcdPanel}
            onchange={(event) => settings.update({ display: { lcdPanel: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_lcd_panel()}</span>
        </label>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-character-effects"
            checked={settings.value.display.characterEffects}
            onchange={(event) => settings.update({ display: { characterEffects: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_character_effects()}</span>
        </label>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-stage-effects"
            checked={settings.value.display.stageEffects}
            onchange={(event) => settings.update({ display: { stageEffects: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_stage_effects()}</span>
        </label>
        <label class="ff-settings__row" data-row>
          <input
            type="checkbox"
            data-testid="settings-trajectory-guide"
            checked={settings.value.display.trajectoryGuide}
            onchange={(event) => settings.update({ display: { trajectoryGuide: event.currentTarget.checked } })}
          />
          <span class="ff-aq-body">{m.settings_trajectory_guide()}</span>
        </label>

        <!-- The name on its row and the three choices together on the row
             under it: wrapped beside the name, Low alone fell to a second
             line and split the set. -->
        <div role="radiogroup" aria-label={m.settings_graphics_quality()} class="ff-settings__stack" data-row>
          <span class="ff-aq-body ff-settings__name" aria-hidden="true">{m.settings_graphics_quality()}</span>
          <div class="ff-settings__choices">
            {#each QUALITIES as quality (quality.value)}
              <label class="ff-settings__choice">
                <input
                  type="radio"
                  name="ff-settings-quality"
                  data-testid={`settings-quality-${quality.value}`}
                  checked={settings.value.display.quality === quality.value}
                  onchange={() => settings.update({ display: { quality: quality.value } })}
                />
                <span class="ff-aq-body">{quality.label()}</span>
              </label>
            {/each}
          </div>
        </div>
      </fieldset>

      {#if coarse}
        <fieldset class="ff-settings__group" use:pickPulse>
          <legend class="ff-aq-label">{m.settings_touch_controls()}</legend>
          <div role="radiogroup" aria-label={m.settings_touch_controls()} class="ff-settings__row flex-wrap" data-row>
            <label class="ff-settings__choice">
              <input
                type="radio"
                name="ff-settings-touch"
                data-testid="settings-touch-swipe"
                checked={settings.value.input.touchMode === "swipe"}
                onchange={() => settings.update({ input: { touchMode: "swipe" } })}
              />
              <span class="ff-aq-body">{m.settings_touch_swipe()}</span>
            </label>
            <label class="ff-settings__choice">
              <input
                type="radio"
                name="ff-settings-touch"
                data-testid="settings-touch-buttons"
                checked={settings.value.input.touchMode === "buttons"}
                onchange={() => settings.update({ input: { touchMode: "buttons" } })}
              />
              <span class="ff-aq-body">{m.settings_touch_buttons()}</span>
            </label>
          </div>
        </fieldset>
      {/if}

      <!-- What the game keeps, where, and for how long (release readiness
           §7.4), behind its own button at the bottom so Settings is not a
           wall of text. -->
      <div data-row class="col-span-full">
        <InfoSheet title={m.shell_privacy_title()} testId="settings-privacy-open">
          <section data-testid="settings-privacy" class="grid gap-8">
            <ul class="ff-aq-body m-0 grid gap-4 pl-16">
              {#each PRIVACY as line, index (index)}
                <li>{line()}</li>
              {/each}
            </ul>
            <p class="ff-aq-secondary m-0 text-aq-muted">{m.shell_privacy_reset()}</p>
          </section>
        </InfoSheet>
      </div>
    </div>
  {:else}
    <div role="tabpanel" class="grid gap-16">
      {#each order as method (method)}
        <section data-controls-section={method === "gamepad" ? "controller" : method} class="ff-settings__group">
          <h3 class="ff-aq-label m-0">
            {method === "keyboard" ? m.settings_method_keyboard() : method === "gamepad" ? m.settings_method_gamepad() : m.settings_method_touch()}
            {#if method === inputMethod.method}
              <span class="ff-aq-secondary">{m.settings_current_input()}</span>
            {/if}
          </h3>
          {#if method === "keyboard"}
            <dl class="m-0 grid gap-8">
              <div class="flex items-center gap-8" data-row>
                <dt class="m-0 flex gap-4"><kbd class="ff-keycap">A</kbd><kbd class="ff-keycap">D</kbd> {m.settings_keys_or()} <kbd class="ff-keycap">←</kbd><kbd class="ff-keycap">→</kbd></dt>
                <dd class="ff-aq-body m-0">{m.settings_action_move()}</dd>
              </div>
              <div class="flex items-center gap-8" data-row>
                <dt class="m-0 flex gap-4"><kbd class="ff-keycap">S</kbd> {m.settings_keys_or()} <kbd class="ff-keycap">↓</kbd></dt>
                <dd class="ff-aq-body m-0">{m.settings_action_fast_fall()}</dd>
              </div>
              <div class="flex items-center gap-8" data-row>
                <dt class="m-0"><kbd class="ff-keycap">R</kbd></dt>
                <dd class="ff-aq-body m-0">{m.settings_action_restart()}</dd>
              </div>
              <div class="flex items-center gap-8" data-row>
                <dt class="m-0"><kbd class="ff-keycap">M</kbd></dt>
                <dd class="ff-aq-body m-0">{m.settings_action_mute()}</dd>
              </div>
              <div class="flex items-center gap-8" data-row>
                <dt class="m-0"><kbd class="ff-keycap">Esc</kbd></dt>
                <dd class="ff-aq-body m-0">{m.settings_action_pause()}</dd>
              </div>
            </dl>
          {:else if method === "gamepad"}
            <!-- A controller's buttons as keys, as the keyboard's are: the room
                 code's spaced face spread "Left stick" across the dialog. -->
            <dl class="m-0 grid gap-8">
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.move()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_move()}</dd></div>
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.fastFall()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_fast_fall()}</dd></div>
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.restart()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_restart()}</dd></div>
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.pause()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_pause()}</dd></div>
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.confirm()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_choose()}</dd></div>
              <div class="flex items-center gap-8" data-row><dt class="m-0"><kbd class="ff-keycap whitespace-nowrap">{glyphs.back()}</kbd></dt><dd class="ff-aq-body m-0">{m.settings_action_back()}</dd></div>
            </dl>
          {:else}
            <TouchGuide mode={settings.value.input.touchMode} />
          {/if}
        </section>
      {/each}
    </div>
  {/if}
  </ScrollList>
  <p class="sr-only" role="status" aria-live="polite" data-testid="settings-announcer-region">{announcement}</p>
</div>

<style>
  /* A column the list takes the rest of: inside a dialog held to the band, the
     list shrinks to its reserve before the tabs move. */
  .ff-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  .ff-settings > :global(.ff-scroll-list) {
    flex: 1 1 auto;
  }
  /* The two tabs share the row, and a tab's word stays whole ("Ajustes", never
     "Ajus-tes"); on a narrow dialog the word steps down to the body size to fit (review R3). */
  .ff-settings :global(.ff-settings__tab) {
    flex: 1 1 0;
    min-width: 0;
    hyphens: none;
    overflow-wrap: normal;
    word-break: keep-all;
  }
  @container ff-dialog (max-width: 360px) {
    .ff-settings :global(.ff-settings__tab) {
      font-size: var(--ff-type-body);
      padding-inline: 8px;
    }
  }

  /* Two groups across where the dialog is wide enough (Modal widens it on
     a short, wide band): Language beside Audio, Display beside Touch. The
     words take the button size there, so a 44 px row is not mostly air
     (Owner, 2026-11-19: "way too much empty space"). */
  @container ff-dialog (min-width: 560px) {
    .ff-settings [role="tabpanel"] {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      column-gap: 24px;
    }
    .ff-settings :global(.ff-aq-body),
    .ff-settings :global(.ff-aq-secondary) {
      font-size: var(--ff-type-button);
    }
  }

  .ff-settings__group {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  /* Every row is a 44 px target at least, whatever its control. */
  .ff-settings__row,
  .ff-settings__choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }

  .ff-settings__row input[type="range"] {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    accent-color: var(--ff-plain);
  }

  .ff-settings__stack {
    display: grid;
    gap: 0;
  }

  .ff-settings__choices {
    display: flex;
    gap: 16px;
  }

  .ff-settings__name {
    min-width: 6ch;
  }

  .ff-settings__value {
    min-width: 4ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
