<script lang="ts" module>
  export type IconName =
    | "close"
    | "chevron-left"
    | "chevron-right"
    | "menu"
    | "restart"
    | "play"
    | "pause"
    | "previous"
    | "next"
    | "expand"
    | "collapse"
    | "help"
    | "at"
    | "download"
    | "share"
    | "stopwatch"
    | "instagram"
    | "x-logo"
    | "discord"
    | "globe"
    | "check";
</script>

<script lang="ts">
  /**
   * A button's icon, drawn rather than typed. A text glyph sits where its
   * font's metrics put it, off its button's middle (and differently on every
   * platform), so each shape here is drawn with its bounding box centred on
   * the 24-unit box: centred in the box is centred in the button. Sized by
   * `--ff-icon-size` (20 px unless the button says otherwise).
   */
  let { name }: { name: IconName } = $props();
</script>

<svg class="ff-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  {#if name === "close"}
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" class="ff-icon__line" />
  {:else if name === "chevron-left"}
    <polyline points="15,6 9,12 15,18" class="ff-icon__line ff-icon__line--bold" />
  {:else if name === "chevron-right"}
    <polyline points="9,6 15,12 9,18" class="ff-icon__line ff-icon__line--bold" />
  {:else if name === "menu"}
    <path d="M5 7h14M5 12h14M5 17h14" class="ff-icon__line" />
  {:else if name === "restart"}
    <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5M4 4v4.5h4.5" class="ff-icon__line" />
  {:else if name === "play"}
    <polygon points="6.5,5 17.5,12 6.5,19" class="ff-icon__fill" />
  {:else if name === "pause"}
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" class="ff-icon__fill" />
  {:else if name === "previous"}
    <polygon points="16.5,6 7.5,12 16.5,18" class="ff-icon__fill" />
  {:else if name === "next"}
    <polygon points="7.5,6 16.5,12 7.5,18" class="ff-icon__fill" />
  {:else if name === "expand"}
    <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" class="ff-icon__line" />
  {:else if name === "collapse"}
    <path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6" class="ff-icon__line" />
  {:else if name === "help"}
    <path d="M9 9a3 3 0 1 1 4.2 2.75c-.75.33-1.2 1.07-1.2 1.89V14.5" class="ff-icon__line" />
    <circle cx="12" cy="18" r="1.25" class="ff-icon__fill" />
  {:else if name === "at"}
    <circle cx="12" cy="12" r="3.25" class="ff-icon__line" />
    <path d="M15.25 8.75v4.5a2.25 2.25 0 0 0 4.5 0V12a7.75 7.75 0 1 0-3.1 6.2" class="ff-icon__line" />
  {:else if name === "download"}
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" class="ff-icon__line" />
  {:else if name === "share"}
    <path d="M12 14.5V4M7.5 8.5L12 4l4.5 4.5M8 11H5.5v8.5h13V11H16" class="ff-icon__line" />
  {:else if name === "stopwatch"}
    <!-- Survival's choice (survival spec S4): a dial, its hand, the crown and the side button. -->
    <circle cx="12" cy="13.5" r="6.75" class="ff-icon__line" />
    <path d="M12 13.5V10M10 3.75h4M12 3.75v3M17.25 7.25l1.25-1.25" class="ff-icon__line" />
  {:else if name === "instagram"}
    <rect x="4" y="4" width="16" height="16" rx="4.5" class="ff-icon__line" />
    <circle cx="12" cy="12" r="3.5" class="ff-icon__line" />
    <circle cx="16.4" cy="7.6" r="1.1" class="ff-icon__fill" />
  {:else if name === "x-logo"}
    <!-- The brand marks are drawn on the full 24-unit box; scaled to sit at the line icons' size. -->
    <path
      transform="translate(3.5 3.5) scale(0.7083)"
      d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
      class="ff-icon__fill"
    />
  {:else if name === "discord"}
    <path
      transform="translate(3 3) scale(0.75)"
      d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      class="ff-icon__fill"
    />
  {:else if name === "globe"}
    <circle cx="12" cy="12" r="8" class="ff-icon__line" />
    <ellipse cx="12" cy="12" rx="3.5" ry="8" class="ff-icon__line" />
    <path d="M4 12h16" class="ff-icon__line" />
  {:else if name === "check"}
    <path d="M5 12.5l4.5 4.5L19 7.5" class="ff-icon__line ff-icon__line--bold" />
  {/if}
</svg>

<style>
  .ff-icon {
    display: block;
    flex: none;
    width: var(--ff-icon-size, 20px);
    height: var(--ff-icon-size, 20px);
    pointer-events: none;
  }
  .ff-icon__line {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ff-icon__line--bold {
    stroke-width: 2.5;
  }
  .ff-icon__fill {
    fill: currentColor;
  }
</style>
