<script lang="ts">
  /**
   * The language step, before the photosensitivity warning on a device's
   * first visit (`SplashScreen`): a player who cannot read English must be
   * able to read the warning. Automatic, the browser's guess, starts chosen;
   * a flag applies at once (`LanguagePicker`), so this step and the warning
   * after it read in the language picked. Continue, the Close and Escape all
   * go on.
   *
   * The flags say "language" to a player who reads none of the words. Like
   * the warning, it sits over the world the splash draws behind it.
   */
  import * as m from "../../paraglide/messages.js";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import LanguagePicker from "../settings/LanguagePicker.svelte";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";

  let { settings, onContinue }: { settings: SettingsStore; onContinue: () => void } = $props();
</script>

<div class="ff-language-first" data-testid="language-first">
  <Modal title={m.settings_language()} testId="language-first-dialog" onClose={onContinue}>
    <LanguagePicker {settings} testIdPrefix="first-language" large />
    {#snippet actions()}
      <Button kind="go" data-testid="language-first-continue" onclick={onContinue}>{m.photosensitivity_continue()}</Button>
    {/snippet}
  </Modal>
</div>

<style>
  /* As the photosensitivity warning: over the world the splash has drawn. */
  .ff-language-first {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
</style>
