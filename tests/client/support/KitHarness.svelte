<script lang="ts">
  /**
   * One kit piece behind a toggle, for the kit's own tests: `toggle` shows and
   * hides it (a panel leaving, a toast going), `swap` changes the view a
   * `ViewSwitch` shows.
   */
  import Panel from "../../../apps/client/src/features/kit/Panel.svelte";
  import Toast from "../../../apps/client/src/features/kit/Toast.svelte";
  import ViewSwitch from "../../../apps/client/src/features/kit/ViewSwitch.svelte";

  let {
    piece,
    panel = {},
  }: {
    piece: "panel" | "toast" | "view";
    panel?: Record<string, unknown>;
  } = $props();

  let shown = $state(true);
  let view = $state("menu");
</script>

<button type="button" data-testid="toggle" onclick={() => (shown = !shown)}>Toggle</button>
<button type="button" data-testid="swap" onclick={() => (view = view === "menu" ? "settings" : "menu")}>Swap</button>

{#if piece === "panel" && shown}
  <Panel data-testid="piece" {...panel}>Hello</Panel>
{:else if piece === "toast" && shown}
  <Toast data-testid="piece" {...panel}>Copied</Toast>
{:else if piece === "view"}
  <ViewSwitch {view}>
    {#snippet children(current)}<button type="button" data-testid="view-{current}">{current}</button>{/snippet}
  </ViewSwitch>
{/if}
