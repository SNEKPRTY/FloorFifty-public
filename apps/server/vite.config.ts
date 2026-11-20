import { defineConfig } from "vite";
import { buildDefines } from "../../tools/build-stamp";

// The server is bundled as a Node SSR build so that workspace TypeScript
// sources resolve through their package exports without a separate compiler
// step or a published build artifact.
export default defineConfig({
  // Which build this is, reported by /health and compared at the join (release readiness §4.1).
  define: buildDefines(process.env),
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "main.js" } },
  },
  ssr: {
    // Shared simulation code ships as TypeScript and must be bundled in.
    noExternal: [/^@floor-fifty\//],
  },
});
