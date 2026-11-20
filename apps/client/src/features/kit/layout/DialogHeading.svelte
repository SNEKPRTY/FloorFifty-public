<script lang="ts">
  /**
   * A dialog's heading (UI layout system spec §5, audit m6): the title is the
   * largest text in the dialog, in the display face, with any small label
   * above it. Fixes the inversion where "Paused" sat at 13 px over larger body.
   */
  let { id, title, eyebrow }: { id: string; title: string; eyebrow?: string } = $props();
</script>

<div class="ff-dialog-heading">
  {#if eyebrow}<p class="ff-aq-label ff-dialog-heading__eyebrow">{eyebrow}</p>{/if}
  <h2 {id} class="ff-dialog-heading__title">{title}</h2>
</div>

<style>
  .ff-dialog-heading {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .ff-dialog-heading__eyebrow {
    margin: 0;
  }

  .ff-dialog-heading__title {
    margin: 0;
    font-family: var(--ff-font-ui);
    font-size: var(--ff-type-title);
    font-weight: 800;
    line-height: 1.15;
    color: var(--ff-text);
    text-wrap: balance;
  }
</style>
