<script lang="ts">
  /**
   * A message with emphasis, from its parts (languages plan, extraction rule
   * 7). A translator moves the `{#strong}…{/strong}` span with the words, so
   * the markup is the catalogue's, not the component's. Svelte cannot open a
   * tag in one block and close it in another, so the parts are grouped into
   * runs first. Never `{@html}`: a catalogue must not be able to inject markup.
   */
  import type { MessagePart } from "../../paraglide/runtime.js";

  let { parts }: { parts: readonly MessagePart[] } = $props();

  /** Text runs, each inside or outside a strong span. */
  const runs = $derived.by(() => {
    const out: { strong: boolean; text: string }[] = [];
    let strong = false;
    for (const part of parts) {
      if (part.type === "markup-start" && part.name === "strong") strong = true;
      else if (part.type === "markup-end" && part.name === "strong") strong = false;
      else if (part.type === "text") out.push({ strong, text: part.value });
    }
    return out;
  });
</script>

{#each runs as run, index (index)}{#if run.strong}<strong>{run.text}</strong>{:else}{run.text}{/if}{/each}
