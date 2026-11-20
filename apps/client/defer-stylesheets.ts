import type { Plugin } from "vite";

/**
 * Keeps the built page's stylesheets from holding back its first paint.
 *
 * A browser draws nothing while a stylesheet in the head is still arriving.
 * On a slow link that is seconds of a bare page before the boot loader can
 * show, and the Owner's rule is that a player never sees a blank screen (Ruken
 * loading, 2026-10-10). The loader's own styles are inline in `index.html`,
 * so it needs none of these files. Each stylesheet link is marked
 * `media="print"` (fetched at once, applied to nothing on a screen) and
 * `data-ff-style`; the boot switches them on and waits for them before any
 * screen mounts (`src/features/kit/stylesheets.ts`), so nothing is drawn unstyled.
 *
 * A link that already names its media is left as it is. Vite writes the links
 * for the CSS that scripts import during its own HTML step, so this runs after
 * it (`order: "post"`), and only for a build: in development Vite injects the
 * styles with its client script instead.
 */
export function deferStylesheets(html: string): string {
  return html.replace(/<link rel="stylesheet"(?![^>]*\smedia=)/g, '<link rel="stylesheet" media="print" data-ff-style');
}

export function deferStylesheetsPlugin(): Plugin {
  return {
    name: "ff-defer-stylesheets",
    apply: "build",
    transformIndexHtml: { order: "post", handler: deferStylesheets },
  };
}
