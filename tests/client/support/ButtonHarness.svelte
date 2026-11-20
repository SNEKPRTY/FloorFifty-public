<script lang="ts">
  /** A `Button` with words, so a test can pass it any of its props. */
  import Button from "../../../apps/client/src/features/kit/Button.svelte";

  let props: Record<string, unknown> = $props();
</script>

<Button {...props}>Go</Button>
