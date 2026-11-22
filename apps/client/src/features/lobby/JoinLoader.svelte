<script lang="ts">
  /**
   * The loading bar while Find a race, Create room or Join room is on its way
   * (the shared `LoaderOverlay`). Mounted by `LobbyRoot` for as long as the
   * connection says "connecting", so it shows on the press and each join gets
   * a fresh bar. Its fill is the join's real steps (`JOIN_STEPS`), never a
   * timer; past eight seconds a quiet line says it is slow, not failing.
   *
   * It covers the screen, so a second press cannot land and start the join
   * over (the panel also refuses one, for Enter and a pad).
   */
  import { MonotonicProgress, Readiness } from "../profile/progress.svelte";
  import { browserTimers, watchSlow } from "../../lib/load-meter";
  import LoaderOverlay from "../kit/LoaderOverlay.svelte";
  import { LOADER_Z } from "../render/veil";

  let { label, fraction }: { label: string; fraction: number } = $props();

  const progress = new MonotonicProgress();
  const slow = new Readiness();

  $effect(() => {
    progress.report(fraction);
  });

  $effect(() => watchSlow(browserTimers, () => (slow.ready = true)));
</script>

<LoaderOverlay {progress} {label} {slow} layer={LOADER_Z} />
