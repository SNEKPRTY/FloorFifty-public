<script lang="ts">
  /**
   * An image that says it is loading (async loaders spec). The frame is
   * toned until the image has decoded; a stepped ring joins it after
   * `RING_DELAY_MS`, so a quick image never flashes one; the image fades in
   * once decoded. An image already cached is shown at once, with no fade.
   *
   * State is kept per `src`, so a new `src` starts again at pending. Each
   * `src` gets its own img element (`{#key}`), so a late load or error from
   * the old one, or the old one's cached state, never reaches the new one. A
   * failed request is retried, each retry on its own img, before the image
   * reads as failed (`RETRY_DELAYS_MS`). The styles are in `aquarian.css`'s
   * components layer, beneath every caller's own classes.
   */
  import type { Snippet } from "svelte";
  import type { Action } from "svelte/action";
  import { RETRY_DELAYS_MS, retryUrl } from "../../lib/image-retry";

  let {
    src,
    width = undefined,
    height = undefined,
    class: frameClass = "",
    imgClass = "",
    testId = undefined,
    draggable = false,
    fit = "fill",
    ring = true,
    tone = "fill",
    fallback = undefined,
  }: {
    src: string;
    width?: number | undefined;
    height?: number | undefined;
    class?: string;
    imgClass?: string;
    testId?: string | undefined;
    draggable?: boolean;
    fit?: "cover" | "contain" | "fill";
    ring?: boolean;
    tone?: "fill" | "none";
    fallback?: Snippet | undefined;
  } = $props();

  /** The other loaders' delay: most images arrive inside it. */
  const RING_DELAY_MS = 200;

  // Each records the `src` it is true for, so a new `src` reads as pending.
  let loadedSrc = $state<string | undefined>();
  let failedSrc = $state<string | undefined>();
  let instantSrc = $state<string | undefined>();
  let ringSrc = $state<string | undefined>();
  /** The retry this `src` is on; a new `src` starts at the first request. */
  let retry = $state<{ src: string; attempt: number } | undefined>();

  const attempt = $derived(retry?.src === src ? retry.attempt : 0);
  const requested = $derived(retryUrl(src, attempt));
  const load = $derived(failedSrc === src ? "failed" : loadedSrc === src ? "loaded" : "pending");
  const ringShown = $derived(ring && load === "pending" && ringSrc === src);

  /** Watches one img for one request of `src`; a new `src` or retry is a new img (`{#key}`). */
  const watch: Action<HTMLImageElement, { src: string; attempt: number }> = (img, { src: value, attempt: tried }) => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let again: ReturnType<typeof setTimeout> | undefined;

    const onLoad = (): void => {
      // Arrived: no ring now, even if the decode runs past the delay.
      clearTimeout(timer);
      // Decoded before it is shown, so the fade is not a half-drawn image.
      void (img.decode?.() ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => {
          if (live) loadedSrc = value;
        });
    };
    const onError = (): void => {
      const delay = RETRY_DELAYS_MS[tried];
      if (delay === undefined) {
        clearTimeout(timer);
        failedSrc = value;
        return;
      }
      // The ring keeps turning: the image is still on its way.
      again = setTimeout(() => {
        if (live) retry = { src: value, attempt: tried + 1 };
      }, delay);
    };

    if (img.complete && img.naturalWidth > 0) {
      instantSrc = value;
      loadedSrc = value;
    } else {
      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
      timer = setTimeout(() => (ringSrc = value), RING_DELAY_MS);
    }
    return {
      destroy() {
        live = false;
        clearTimeout(timer);
        clearTimeout(again);
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      },
    };
  };
</script>

<span
  class="ff-async {frameClass}"
  data-load={load}
  data-tone={tone}
  data-instant={instantSrc === src ? "" : undefined}
  style:--ff-async-w={width === undefined ? undefined : `${width}px`}
  style:--ff-async-h={height === undefined ? undefined : `${height}px`}
  style:--ff-async-fit={fit}
>
  {#if load === "failed" && fallback !== undefined}
    {@render fallback()}
  {:else}
    {#key requested}
      <img class="ff-async__img {imgClass}" src={requested} alt="" {width} {height} {draggable} data-testid={testId} use:watch={{ src, attempt }} />
    {/key}
  {/if}
  {#if ringShown}<span class="ff-async__ring" aria-hidden="true"></span>{/if}
</span>
