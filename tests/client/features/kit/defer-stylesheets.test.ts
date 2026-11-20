// @vitest-environment node
/**
 * The built page's stylesheets never hold back its first paint (Ruken loading,
 * the Owner's rule: never a bare frame). A stylesheet in the head keeps the
 * browser from drawing anything until it has arrived -- seconds on a slow link
 * -- so the boot loader, whose styles are inline, could not show. The build
 * marks every stylesheet `media="print"` with `data-ff-style`; the boot turns
 * them on and waits for them before any screen mounts (`features/kit/stylesheets.ts`).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deferStylesheets, deferStylesheetsPlugin } from "../../../../apps/client/defer-stylesheets";

describe("deferring the built page's stylesheets", () => {
  it("marks every stylesheet link so it no longer blocks the first paint", () => {
    const html = [
      "<head>",
      '<link rel="stylesheet" crossorigin href="./build/styles-a1.css">',
      '<link rel="stylesheet" crossorigin href="./build/index-b2.css">',
      "</head>",
    ].join("\n");
    const out = deferStylesheets(html);
    expect(out).toContain('<link rel="stylesheet" media="print" data-ff-style crossorigin href="./build/styles-a1.css">');
    expect(out).toContain('<link rel="stylesheet" media="print" data-ff-style crossorigin href="./build/index-b2.css">');
  });

  it("leaves every other link alone, and a link that already names its media", () => {
    const html = [
      '<link rel="icon" href="./icons/icon-32.png" />',
      '<link rel="manifest" href="./manifest.webmanifest" />',
      '<link rel="modulepreload" crossorigin href="./build/x.js">',
      '<link rel="stylesheet" media="screen and (min-width: 900px)" href="./wide.css">',
    ].join("\n");
    expect(deferStylesheets(html)).toBe(html);
  });

  it("runs for a build only, after Vite has written its own links", () => {
    const plugin = deferStylesheetsPlugin();
    expect(plugin.apply).toBe("build");
    const hook = plugin.transformIndexHtml as { order?: string; handler?: unknown };
    expect(hook.order).toBe("post");
    expect(hook.handler).toBe(deferStylesheets);
  });

  it("is in the client's build", () => {
    // Read as text: loading the Vite config itself needs Node's real
    // TextEncoder, which this jsdom project replaces.
    const config = readFileSync(resolve(__dirname, "../../../../apps/client/vite.config.ts"), "utf8");
    expect(config).toMatch(/plugins: \[[^\]]*deferStylesheetsPlugin\(\)[^\]]*\]/);
  });
});
