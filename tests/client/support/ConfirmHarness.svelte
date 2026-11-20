<script lang="ts">
  import { confirm } from "../../../apps/client/src/features/kit/motion";

  let { active: initial }: { active: boolean } = $props();
  // Starts where the test says, then turns as an owner's flag would.
  // svelte-ignore state_referenced_locally
  let active = $state(initial);
</script>

<button class="ff-confirm" use:confirm={{ active }}>
  <span data-confirm-label="idle">Copy</span>
  <span data-confirm-label="done">Copied ✓</span>
</button>
<button type="button" data-testid="toggle" onclick={() => (active = !active)}>Toggle</button>
