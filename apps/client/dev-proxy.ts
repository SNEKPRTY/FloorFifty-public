/**
 * What the development and preview servers forward to the race server.
 *
 * The client asks its own origin for everything, in development exactly as in
 * production, which is what keeps `pnpm dev` working with no environment
 * variable and keeps the built client hostable beside the server. The price is
 * that every path the race server answers must be forwarded here: Vite serves
 * `index.html` for anything it does not recognise, so a missing entry reaches
 * the client as HTML where it expected JSON.
 *
 * One table, used by both `server` and `preview`, so a path can never be
 * forwarded in development and quietly absent from a preview build.
 */

import type { ProxyOptions } from "vite";

/** Every path the client asks its own origin for and the race server answers. */
export const RACE_SERVER_PATHS = ["/matchmake", "/content"] as const;

export type RaceServerPath = (typeof RACE_SERVER_PATHS)[number];

/**
 * `/matchmake` is Colyseus's HTTP half; `/content` is a plain cacheable GET.
 *
 * The realtime socket is deliberately absent. Colyseus builds its socket URL
 * from the matchmaking response, so forwarding it would mean guessing a path
 * shape that is a library detail. Development points the client straight at
 * the race server with `VITE_SERVER_URL` instead, and in production the two
 * share an origin and nothing is proxied at all.
 */
export const raceServerProxy = (target: string): Record<RaceServerPath, ProxyOptions> => ({
  "/matchmake": { target, changeOrigin: true },
  "/content": { target, changeOrigin: true },
});
