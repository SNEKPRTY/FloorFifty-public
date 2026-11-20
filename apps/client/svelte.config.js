import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * Svelte configuration.
 *
 * Runes only. The legacy reactive syntax would let a component derive state
 * implicitly, which is exactly the boundary this client needs to keep visible:
 * the server owns every race rule, and a client that can grow derived state by
 * accident is a client that can grow a second implementation of those rules.
 *
 * `vitePreprocess` is what puts a component's `<script lang="ts">` block
 * through the same TypeScript pipeline as the rest of the client.
 */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
};
