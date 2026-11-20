/**
 * The client runs under a CSP with no 'unsafe-eval' (release readiness §6.3),
 * on staging's standalone host and inside Ruken alike. Two libraries would
 * otherwise generate code at runtime:
 *
 * - Pixi probes for `new Function` when its renderer is built and throws if
 *   the probe is blocked; `pixi.js/unsafe-eval` swaps its generated
 *   functions for static ones (despite the name, it is the no-eval build).
 * - Zod's fast path compiles validators with `new Function`. Jitless mode
 *   validates without it, and skips the probe that reports a CSP violation.
 *
 * Imported first by `main.ts`, so both are in place before anything renders
 * or parses.
 */

import "pixi.js/unsafe-eval";
import { config } from "zod";

config({ jitless: true });
