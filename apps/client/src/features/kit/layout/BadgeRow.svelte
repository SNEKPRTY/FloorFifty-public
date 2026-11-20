<script lang="ts">
  /**
   * A racer's badges on their own line under the name (UI layout system
   * spec §5, audit M12), so they never take the name's width. Every badge is
   * a rounded square. An action badge (Change) is a button when it has a
   * handler; without one it is drawn as a button but is a span, for a row
   * that is itself the control (the ready room's seat), so there is one tab
   * stop.
   */
  import Button from "../Button.svelte";

  let {
    badges,
  }: { badges: { text: string; kind: "status" | "action"; onSelect?: () => void; testId?: string }[] } = $props();
</script>

<div class="ff-badge-row" data-badge-row>
  {#each badges as badge (badge.text)}
    {#if badge.kind === "action" && badge.onSelect !== undefined}
      <Button kind="ghost" class="ff-badge ff-badge--action" data-testid={badge.testId} onclick={badge.onSelect}>
        {badge.text}
      </Button>
    {:else if badge.kind === "action"}
      <span class="ff-badge ff-badge--action" data-testid={badge.testId}>{badge.text}</span>
    {:else}
      <span class="ff-badge" data-testid={badge.testId}>{badge.text}</span>
    {/if}
  {/each}
</div>

<style>
  .ff-badge-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
</style>
