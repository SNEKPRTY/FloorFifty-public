import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { deferStylesheetsPlugin } from "./defer-stylesheets";
import { raceServerProxy } from "./dev-proxy";
import { PARAGLIDE } from "./i18n.config";
import { buildDefines } from "../../tools/build-stamp";

// The race server this machine runs, unless a build names another one.
const proxy = raceServerProxy(process.env["VITE_SERVER_URL"] ?? "http://127.0.0.1:3000");

export default defineConfig({
  // Screen chrome is Svelte; the race itself stays on the Pixi canvas. The
  // svelte plugin compiles both the components and the `.svelte.ts` modules
  // that hold runes outside a component. Tailwind scans those same files for
  // the utilities it needs to emit. Paraglide compiles the message catalogues
  // into `src/paraglide/` first, and again whenever one changes. The built
  // page's stylesheets never hold back its first paint (`defer-stylesheets.ts`).
  plugins: [paraglideVitePlugin(PARAGLIDE), tailwindcss(), svelte(), deferStylesheetsPlugin()],
  // Relative asset URLs keep the built client hostable from any static path.
  base: "./",
  // Which build this is, folded in for the boot version check (release readiness §4.1).
  define: buildDefines(process.env),
  // Hashed output goes to build/, apart from the unhashed public assets/, so
  // each folder can carry one cache rule (release readiness §5.1, §6.4).
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", assetsDir: "build" },
  // Bound explicitly to the loopback address rather than "localhost", which
  // resolves to IPv6 only on some machines and leaves the end-to-end probe
  // knocking on a port nothing is listening to. A preview build served
  // without `VITE_SERVER_URL` baked in is in the development client's
  // position -- it asks its own origin -- so it proxies the same paths.
  preview: {
    port: 4173,
    strictPort: true,
    host: process.env["VITE_HOST"] ?? "127.0.0.1",
    proxy,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: process.env["VITE_HOST"] ?? "127.0.0.1",
    // In development the client is served from a different port than the race
    // server, so every race-server path is proxied. That keeps `pnpm dev`
    // working with no environment variable, and keeps the client's default --
    // talk to my own origin -- correct in development and in production alike.
    proxy,
  },
});
