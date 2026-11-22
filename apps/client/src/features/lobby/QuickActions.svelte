<script lang="ts">
  /**
   * The title's quick actions (spec §3.1.1, §3.1.5): fullscreen,
   * instructions and contact, as one row of utilities (UI layout spec §6.1). Mute is the
   * corner's, as on every screen. Fullscreen is offered as the browser allows
   * it: a toggle where element fullscreen exists, Add to Home Screen help on
   * an iPhone or iPad, and absent elsewhere rather than dead. The help is the
   * screen's to open (`onHomeScreen`): a fixed dialog mounted here sits inside
   * the card's glass, whose backdrop filter is the box it is placed in.
   */
  import * as m from "../../paraglide/messages.js";
  import Icon from "../kit/Icon.svelte";
  import { onMount } from "svelte";
  import { fullscreenSupport, isFullscreen, onFullscreenChange, toggleFullscreen } from "../platform/fullscreen";
  import ActionBar from "../kit/layout/ActionBar.svelte";
  import type { BarAction } from "../kit/layout/action-bar";

  let {
    onInstructions,
    onContact,
    onHomeScreen,
  }: { onInstructions?: () => void; onContact: () => void; onHomeScreen: () => void } = $props();

  // State, because inside Ruken the host's answer to the first press can
  // change it (to the Home Screen help on an iPhone).
  let support = $state(fullscreenSupport());
  let fullscreen = $state(isFullscreen());

  onMount(() => onFullscreenChange(() => void (fullscreen = isFullscreen())));

  const actions = $derived<BarAction[]>([
    ...(support === "element"
      ? [
          {
            id: "quick-fullscreen",
            label: fullscreen ? m.shell_fullscreen_exit() : m.shell_fullscreen(),
            icon: fullscreenIcon,
            kind: "utility" as const,
            pressed: fullscreen,
            // Guarded: it reaches past the game, so a pad's A clicks it only
            // when the pad walked there (see focus-nav). It lets go of focus
            // once pressed, so a later A meant for the game cannot land on it.
            padGuard: true,
            onSelect: async (event: MouseEvent) => {
              const button = event.currentTarget as HTMLButtonElement;
              await toggleFullscreen();
              support = fullscreenSupport();
              button.blur();
            },
          },
        ]
      : support === "ios-home-screen"
        ? // Quiet: the modal it opens plays ui.open (polish spec §8.2).
          [{ id: "quick-home-screen", label: m.shell_fullscreen(), icon: fullscreenIcon, kind: "utility" as const, sfx: "none", onSelect: onHomeScreen }]
        : []),
  ]);

  /** Socials, a bar of its own. */
  const contact = $derived<BarAction[]>([
    // Quiet: the modal it opens plays ui.open (polish spec §8.2).
    { id: "quick-contact", label: m.shell_contact(), icon: contactIcon, kind: "utility" as const, sfx: "none", onSelect: onContact },
  ]);

  /** How to play: the instructions, a bar of their own so each bar stays one row. */
  const learn = $derived<BarAction[]>([
    // Quiet: the carousel it opens plays ui.open (polish spec §8.2).
    ...(onInstructions !== undefined ? [{ id: "quick-instructions", label: m.shell_instructions(), icon: instructionsIcon, kind: "utility" as const, sfx: "none", onSelect: onInstructions }] : []),
  ]);
</script>

{#snippet fullscreenIcon()}<Icon name={fullscreen ? "collapse" : "expand"} />{/snippet}
{#snippet instructionsIcon()}<Icon name="help" />{/snippet}
{#snippet contactIcon()}<Icon name="at" />{/snippet}

<div role="toolbar" aria-label={m.shell_quick_actions()} class="ff-quick">
  {#if learn.length > 0}<ActionBar actions={learn} testId="quick-learn" keepWords />{/if}
  {#if actions.length > 0}<ActionBar {actions} testId="quick-actions" keepWords />{/if}
  <ActionBar actions={contact} testId="quick-contact-bar" keepWords />
</div>

<style>
  /* Bars of a button or two, each one row (the contract: an action bar never wraps). Where they fit on one
     line they share it; where they do not, they stack. */
  .ff-quick {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ff-quick > :global(.ff-action-bar) {
    flex: 1 1 auto;
  }
</style>
