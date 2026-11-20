<script lang="ts">
  /**
   * A button that is only a picture (Owner, 2026-11-19 01:08Z: no words on the
   * contact icons or on the replay's download and share). The name is
   * required and is the `aria-label` and the tooltip; there is no slot for
   * visible text, so a word cannot be added by accident.
   *
   * `done` swaps the picture for a tick (replay download and share).
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Button from "./Button.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { confirm } from "./motion";

  let {
    icon,
    label,
    kind = "ghost",
    done = false,
    href,
    class: className = "",
    ...rest
  }: {
    icon: IconName;
    label: string;
    kind?: "go" | "stop" | "plain" | "ghost";
    done?: boolean;
    /** Makes it a link that opens in another tab (the contact icons). */
    href?: string;
    class?: string;
  } & Omit<HTMLButtonAttributes, "children" | "class" | "aria-label" | "title"> = $props();

  let ref: HTMLButtonElement | undefined = $state();
  let handle: ReturnType<typeof confirm> | undefined;

  $effect(() => {
    const active = done;
    // A link has no done state to swap: only a button confirms.
    if (ref === undefined) return;
    if (handle === undefined) handle = confirm(ref, { active });
    else handle.update({ active });
  });
</script>

<Button bind:ref {kind} {href} class="ff-icon-button {className}" aria-label={label} title={label} {...rest}>
  <span data-confirm-label="idle" class="ff-icon-button__cell"><Icon name={icon} /></span>
  {#if href === undefined}<span data-confirm-label="done" class="ff-icon-button__cell"><Icon name="check" /></span>{/if}
</Button>

<style>
  /* A square target, never narrower than the touch floor. */
  :global(.ff-icon-button) {
    min-width: var(--ff-aq-target);
    min-height: var(--ff-aq-target);
    padding: 0;
  }
  .ff-icon-button__cell {
    display: grid;
    place-items: center;
  }
</style>
