<script lang="ts">
  /**
   * A short message that comes and goes by itself: a glass panel that rises
   * in and falls out (the idle warning, a copied line, a refusal). Sized for
   * a toast slot, never a screen.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import Panel from "./Panel.svelte";

  let {
    tone = "hud",
    order = 0,
    class: className = "",
    children,
    ...rest
  }: {
    tone?: "menu" | "hud";
    order?: number;
    class?: string;
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLElement>, "children" | "class"> = $props();
</script>

<Panel {tone} {order} arrive="rise" leave="fall" class="ff-toast {className}" role="status" {...rest}>{@render children()}</Panel>

<style>
  :global(.ff-toast) {
    width: fit-content;
    max-width: min(var(--ff-content-max, 560px), calc(100% - 2 * var(--ff-gutter, 16px)));
    padding: 8px 16px;
    font-family: var(--ff-font-ui);
    overflow-wrap: anywhere;
  }
</style>
