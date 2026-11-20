<script lang="ts">
  /**
   * Holds a FullscreenPicker's props as state, so a test can change one after
   * mounting (Svelte 5's `mount` returns no `$set`): `control.set({ … })`.
   */
  import FullscreenPicker from "../../../apps/client/src/features/select/FullscreenPicker.svelte";
  let { initial, control }: { initial: Record<string, unknown>; control: { set?: (next: Record<string, unknown>) => void } } = $props();
  // svelte-ignore state_referenced_locally
  const props = $state({ ...initial });
  control.set = (next) => Object.assign(props, next);
</script>

<FullscreenPicker {...(props as never)} />
