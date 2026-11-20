/**
 * Finds the places a built client names one of its own files by a
 * root-absolute path (`/fonts/x.woff2`, `url("/assets/y.png")`).
 *
 * Inside Ruken the game is served from `https://<game-origin>/b/<buildId>/`,
 * not from the root of its origin, so a root-absolute path is the origin's
 * root: a 404, and for a font a silent fall back to the system face. Vite
 * (`base: "./"`) already rewrites the `url("/fonts/...")` in `theme.css` to
 * `url(../fonts/...)`; this is the check that keeps it so, run on the build
 * before it is packed (`ruken-pack.ts`).
 *
 * It looks for what is certainly a mistake and nothing else: a path that
 * starts with one of the build's own top-level names (`/fonts/`, `/assets/`
 * ...), any root-absolute `url()` in a stylesheet, and a root-absolute `src`
 * or `href` in a page. A bare `"/"`, a server path like `"/health"` and a
 * protocol-relative `//host` are not the build's files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type RootAbsoluteReference = {
  /** The file, relative to the build, with forward slashes. */
  readonly file: string;
  /** The text that names the path, as written. */
  readonly reference: string;
};

const SCANNED = /\.(?:html|css|js|mjs|webmanifest)$/;

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

export function findRootAbsoluteReferences(distDir: string): RootAbsoluteReference[] {
  // The build's own top-level names: what a root-absolute path would be aiming at.
  const own = readdirSync(distDir).map(escapeForRegExp);
  const inScript = new RegExp(`(["'\`])/(?:${own.join("|")})(?:/[^"'\`\\s]*)?\\1`, "g");
  const inStyle = /url\(\s*(["']?)\/(?!\/)[^)"']*\1\s*\)|@import\s+(["'])\/(?!\/)[^"']*\2/g;
  const inPage = /\b(?:src|href|poster|action)\s*=\s*(["'])\/(?!\/)[^"']*\1/g;

  const found: RootAbsoluteReference[] = [];
  for (const path of walk(distDir)) {
    if (!SCANNED.test(path)) continue;
    const text = readFileSync(path, "utf8");
    const patterns = path.endsWith(".css") ? [inStyle] : path.endsWith(".html") ? [inPage, inStyle] : [inScript];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        found.push({ file: relative(distDir, path).split(sep).join("/"), reference: match[0] });
      }
    }
  }
  return found;
}
