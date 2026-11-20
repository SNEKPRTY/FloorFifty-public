<script lang="ts">
  /**
   * The photosensitivity warning, before the first splash on a device
   * (`SplashScreen`). It says the race flashes and shakes, and offers the two
   * switches that stop most of it -- the character and stage effects, the
   * same ones the settings hold -- before anything has played. Continue, the
   * Close and Escape all go on; the switches keep whatever was set.
   *
   * It sits over the menu world the splash draws behind it, since nothing else is on
   * screen yet.
   */
  import * as m from "../../paraglide/messages.js";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";

  let { settings, onContinue }: { settings: SettingsStore; onContinue: () => void } = $props();
</script>

<div class="ff-photosensitivity" data-testid="photosensitivity">
  <Modal title={m.photosensitivity_title()} testId="photosensitivity-warning" onClose={onContinue}>
    <p class="ff-aq-body m-0">{m.photosensitivity_body()}</p>
    <fieldset class="ff-photosensitivity__group">
      <legend class="ff-aq-label">{m.photosensitivity_choose()}</legend>
      <label class="ff-photosensitivity__row">
        <input
          type="checkbox"
          data-testid="photosensitivity-character-effects"
          checked={settings.value.display.characterEffects}
          onchange={(event) => settings.update({ display: { characterEffects: event.currentTarget.checked } })}
        />
        <span class="ff-aq-body">{m.settings_character_effects()}</span>
      </label>
      <label class="ff-photosensitivity__row">
        <input
          type="checkbox"
          data-testid="photosensitivity-stage-effects"
          checked={settings.value.display.stageEffects}
          onchange={(event) => settings.update({ display: { stageEffects: event.currentTarget.checked } })}
        />
        <span class="ff-aq-body">{m.settings_stage_effects()}</span>
      </label>
    </fieldset>
    <p class="ff-aq-secondary m-0">{m.photosensitivity_later()}</p>
    {#snippet actions()}
      <Button kind="go" data-testid="photosensitivity-continue" onclick={onContinue}>{m.photosensitivity_continue()}</Button>
    {/snippet}
  </Modal>
</div>

<style>
  /* Over the menu's world, which the splash draws behind the first-visit steps. */
  .ff-photosensitivity {
    position: fixed;
    inset: 0;
    z-index: 60;
  }

  .ff-photosensitivity__group {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  /* A phone held sideways has no room for a second row under the body text
     and the pinned Continue: set the two switches side by side. */
  @container ff-modal (max-height: 400px) {
    .ff-photosensitivity__group {
      grid-template-columns: 1fr 1fr;
      column-gap: 16px;
    }

    .ff-photosensitivity__group > legend {
      grid-column: 1 / -1;
    }
  }

  /* Every row is a 44 px target at least, as the settings' are. */
  .ff-photosensitivity__row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
</style>
