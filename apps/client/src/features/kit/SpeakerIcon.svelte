<script lang="ts">
  /**
   * A speaker, with sound waves or struck through. SVG rather than a glyph,
   * as the touch controls' icons are: a text speaker is swapped for an emoji
   * on some phones and never sits centred in its button.
   */
  let { muted }: { muted: boolean } = $props();
</script>

<svg class="ff-speaker" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
  {#if muted}
    <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
  {:else}
    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
  {/if}
</svg>

<style>
  .ff-speaker {
    display: block;
    width: 20px;
    height: 20px;
    pointer-events: none;
  }
</style>
