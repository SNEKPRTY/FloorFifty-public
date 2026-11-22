<script lang="ts">
  /**
   * The pause overlay (launch polish §3.1.1, "Pause").
   *
   * A networked race cannot stop for one player, so this is honest about it:
   * the status line says the race continues, and the race goes on drawing
   * underneath. Leaving asks first, because a player who leaves cannot rejoin.
   * Built on `Modal`, so focus, Escape and the controller behave as they do
   * on every other dialog. Escape steps back one level: from Settings or
   * Leave to the menu, and from the menu it resumes.
   */
  import * as m from "../../paraglide/messages.js";
  import { tick } from "svelte";
  import { PAD_FOCUS, tabbables } from "../platform/focus-nav";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import ViewSwitch from "../kit/ViewSwitch.svelte";
  import SettingsPanel from "../settings/SettingsPanel.svelte";
  import RichText from "../kit/RichText.svelte";
  import SpeakerIcon from "../kit/SpeakerIcon.svelte";

  let {
    settings,
    onResume,
    onLeave,
  }: {
    settings: SettingsStore;
    onResume: () => void;
    onLeave: () => void;
  } = $props();

  let view = $state<"menu" | "settings" | "leave">("menu");
  const muted = $derived(settings.value.audio.muted);
  let views: HTMLElement | undefined = $state();

  /**
   * Shows a view and puts focus in it: its first control, or the button
   * named. The button a view was opened from disappears with it, and focus
   * left on nothing gave a controller player nowhere to stand.
   */
  async function show(next: "menu" | "settings" | "leave", focusTestId?: string): Promise<void> {
    view = next;
    await tick();
    // The buttons are in the dialog's action row, beside the view, not in it.
    const dialog = views?.closest<HTMLElement>('[role="dialog"]');
    if (dialog == null) return;
    const target =
      focusTestId === undefined
        ? tabbables(dialog).find((node) => node.dataset["testid"] !== "modal-close")
        : dialog.querySelector<HTMLElement>(`[data-testid="${focusTestId}"]`);
    target?.focus(PAD_FOCUS);
  }

  /** Back one level: from a view to the menu, on the button that opened it. */
  const back = (): void => void show("menu", view === "settings" ? "pause-settings" : "pause-leave");

  /**
   * The foot of the HUD's metric row, which the dialog stays below in
   * portrait. The settings view is taller than a tablet's centre can hold,
   * and centred it rose until its Close sat on the Floors chip. Measured
   * rather than derived: the row's height is the chips' type and padding.
   */
  let hudFoot = $state<number | undefined>(undefined);

  function measureHud(): void {
    // Portrait as `letterbox.ts` decides it: strictly taller than wide. A
    // landscape dialog sits inside the band, already clear of the bars.
    const portrait = window.innerHeight > window.innerWidth;
    hudFoot = portrait ? document.querySelector("[data-hud-metrics]")?.getBoundingClientRect().bottom : undefined;
  }

  $effect(measureHud);
</script>

<svelte:window onresize={measureHud} />

<Modal title={m.pause_title()} testId="pause-overlay" fade onClose={view === "menu" ? onResume : back} clearTop={hudFoot}>
  <p role="status" class="ff-aq-body m-0 text-aq-ink">
    <RichText parts={m.pause_race_continues.parts({})} />
  </p>

  <div bind:this={views} class="contents">
    <ViewSwitch {view} class="ff-pause__views">
      {#snippet children(shown)}
        {#if shown === "settings"}
          <SettingsPanel {settings} />
        {:else if shown === "leave"}
          <p class="ff-aq-body m-0 text-aq-ink">{m.pause_leave_confirm()}</p>
        {/if}
      {/snippet}
    </ViewSwitch>
  </div>

  {#snippet actions()}
    <ViewSwitch {view} class="ff-pause__actions">
      {#snippet children(shown)}
        {#if shown === "menu"}
          <!-- Two across once the dialog is 340 px wide (a phone held sideways, a
               tablet, a desktop), so every choice fits the 270 px a browser leaves
               without scrolling (spec §5.7). -->
          <div class="ff-pause__menu grid gap-8">
            <Button kind="go" data-testid="pause-resume" onclick={onResume}>{m.pause_resume()}</Button>
            <Button
              kind="ghost"
              data-testid="pause-mute"
              aria-pressed={muted}
              class="flex items-center justify-center gap-8"
              onclick={() => settings.update({ audio: { muted: !muted } })}
            >
              <SpeakerIcon {muted} />
              {muted ? m.shell_unmute() : m.shell_mute()}
            </Button>
            <Button kind="ghost" data-testid="pause-settings" onclick={() => void show("settings")}>{m.pause_settings()}</Button>
            <Button kind="stop" data-testid="pause-leave" data-sfx="back" onclick={() => void show("leave", "pause-leave-cancel")}>
              {m.pause_leave_race()}
            </Button>
          </div>
        {:else if shown === "settings"}
          <Button kind="ghost" data-testid="pause-settings-back" data-sfx="back" onclick={back}>
            <span aria-hidden="true">←</span> {m.shell_back()}
          </Button>
        {:else}
          <div class="grid gap-8">
            <Button kind="stop" data-testid="pause-leave-confirm" data-sfx="back" onclick={onLeave}>{m.pause_leave_race()}</Button>
            <Button kind="ghost" data-testid="pause-leave-cancel" data-sfx="back" onclick={back}>{m.pause_cancel()}</Button>
          </div>
        {/if}
      {/snippet}
    </ViewSwitch>
  {/snippet}
</Modal>

<style>
  /* The settings list is a body that fills a sheet (`[data-dialog-body]`, `Modal`): the switch
     and its view carry that fill down, or the list is cut mid-row and its "more" hint goes. */
  :global(.ff-modal__body .ff-view-switch.ff-pause__views),
  :global(.ff-modal__body .ff-view-switch.ff-pause__views > .ff-view) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  :global(.ff-modal__body .ff-pause__views [data-dialog-body]) {
    flex: 1 1 auto;
  }
  /* The action row is a grid whose buttons fill its width; the view stands in for it. */
  :global(.ff-modal__actions .ff-pause__actions > .ff-view) {
    display: grid;
    gap: var(--ff-dialog-gap);
  }
  /* Led by the dialog's own width (its `ff-dialog` container), not the form
     factor: two across where a whole word fits in each (about 230 px a
     column; at 340 "Configuración" split), one column below. */
  @container ff-dialog (min-width: 460px) {
    .ff-pause__menu {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
