<script lang="ts">
  /**
   * The title's quick actions (spec §3.1.1, §3.1.5): fullscreen, tutorial and
   * contact, as one row of utilities (UI layout spec §6.1). Mute is the
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
    onTutorial,
    onContact,
    onHomeScreen,
  }: { onTutorial?: () => void; onContact: () => void; onHomeScreen: () => void } = $props();

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
    ...(onTutorial !== undefined ? [{ id: "quick-tutorial", label: m.shell_tutorial(), icon: tutorialIcon, kind: "utility" as const, onSelect: onTutorial }] : []),
    // Quiet: the modal it opens plays ui.open (polish spec §8.2).
    { id: "quick-contact", label: m.shell_contact(), icon: contactIcon, kind: "utility" as const, sfx: "none", onSelect: onContact },
  ]);
</script>

{#snippet fullscreenIcon()}<Icon name={fullscreen ? "collapse" : "expand"} />{/snippet}
{#snippet tutorialIcon()}<Icon name="help" />{/snippet}
{#snippet contactIcon()}<Icon name="at" />{/snippet}

<div role="toolbar" aria-label={m.shell_quick_actions()} class="ff-quick">
  <ActionBar {actions} testId="quick-actions" keepWords />
</div>
