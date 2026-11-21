<script lang="ts">
  /** A glim, the baby firefly, in eleven by nine pixels in the palette's warm light: the HUD's counter, its flights and the ending's sky. */
  let { class: className = "", style = "" }: { class?: string; style?: string } = $props();
</script>

<svg class={className} {style} viewBox="0 0 11 9" aria-hidden="true" shape-rendering="crispEdges">
  <path d="M2 0h2v1h-2zM7 0h2v1h-2zM2 1h3v1h-3zM6 1h3v1h-3z" fill="#ffffff" fill-opacity="0.6" />
  <path d="M3 2h5v1h-5zM2 3h1v1h-1zM8 3h1v1h-1zM1 4h1v1h-1zM9 4h1v1h-1zM1 5h1v1h-1zM9 5h1v1h-1zM1 6h1v1h-1zM9 6h1v1h-1zM2 7h1v1h-1zM8 7h1v1h-1zM3 8h5v1h-5z" fill="#f79617" />
  <path d="M3 3h5v1h-5zM2 4h1v1h-1zM4 4h3v1h-3zM8 4h1v1h-1zM2 5h7v1h-7zM2 6h2v1h-2zM7 6h2v1h-2zM3 7h1v1h-1zM7 7h1v1h-1z" fill="#f9c22b" />
  <path d="M4 6h3v1h-3zM4 7h3v1h-3z" fill="#fbff86" />
  <path d="M3 4h1v1h-1zM7 4h1v1h-1z" fill="#2e222f" />
</svg>
