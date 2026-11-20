<script lang="ts">
  /**
   * The one button (UI overhaul spec, "Buttons"): green is the one step
   * forward on a screen (`go`), red leaves or gives something up (`stop`),
   * blue is everything else (`plain`). It is the only component allowed to
   * write `ff-aq-control` (`one-look.test.ts`).
   *
   * With an `href` it is a link drawn as the same button (a studio's social
   * page): it opens in another tab, so it always carries `target="_blank"` and `noopener noreferrer`.
   *
   * Press, hover, sound and refusal are not wired here: `ui-motion.ts` and
   * `ui-sounds.ts` install them once for every control, so a button added
   * tomorrow has them already.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "./Icon.svelte";

  let {
    kind = "plain",
    split = false,
    icon,
    type = "button",
    disabled = false,
    selected = false,
    href,
    class: className = "",
    ref = $bindable(),
    children,
    ...rest
  }: {
    kind?: "go" | "stop" | "plain" | "ghost";
    /** A wide action: the words at the left edge, the arrow at the right. */
    split?: boolean;
    icon?: IconName;
    type?: "button" | "submit";
    disabled?: boolean;
    /** The chosen tab: the face is the panel's, ringed and underlined (a chosen option in an `OptionGroup` is its own). */
    selected?: boolean;
    /** Makes it a link that opens in another tab, so a race in this one is never navigated away. */
    href?: string;
    class?: string;
    /** The button element, for a caller that focuses or measures it. */
    ref?: HTMLButtonElement | undefined;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes, "children" | "class" | "type" | "disabled"> = $props();

  const look = $derived(
    `ff-aq-control ${kind === "plain" ? "" : `ff-aq-control--${kind}`} ${split ? "ff-aq-control--split" : ""} ${selected ? "ff-aq-control--selected" : ""} ${className}`,
  );
</script>

{#if href !== undefined}
  <a {href} class={look} target="_blank" rel="noopener noreferrer" {...rest as HTMLAnchorAttributes}>
    {#if icon !== undefined}<Icon name={icon} />{/if}{@render children?.()}
  </a>
{:else}
  <!-- Green is where a pad or the arrow keys land on its screen (`landing` in focus-nav). -->
  <button bind:this={ref} {type} {disabled} class={look} data-main-action={kind === "go" ? "" : undefined} {...rest}>
    {#if icon !== undefined}<Icon name={icon} />{/if}{@render children?.()}
  </button>
{/if}
