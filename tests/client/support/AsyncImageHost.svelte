<script lang="ts">
  /** Mounts `AsyncImage` with a `src` a test can swap without remounting. */
  import { untrack, type Snippet } from "svelte";
  import AsyncImage from "../../../apps/client/src/features/kit/AsyncImage.svelte";

  let {
    first,
    second = undefined,
    ring = true,
    tone = "fill",
    fallback = undefined,
  }: { first: string; second?: string; ring?: boolean; tone?: "fill" | "none"; fallback?: Snippet } = $props();

  // Seeded once; `swap` changes it from then on.
  let src = $state(untrack(() => first));
</script>

<AsyncImage {src} {ring} {tone} {fallback} width={64} height={64} testId="image" class="host-frame" />
{#if second !== undefined}<button type="button" data-testid="swap" onclick={() => (src = second)}>swap</button>{/if}
