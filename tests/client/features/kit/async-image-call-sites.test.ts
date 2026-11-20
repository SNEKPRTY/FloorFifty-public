// @vitest-environment node
/**
 * The image loader's call sites (async loaders spec): an image now lives in
 * `AsyncImage`, outside its caller's style scope, so a caller rule still
 * aimed at it unscoped is silently dropped. Svelte names each one it drops.
 */

import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { clientFile, readClient } from "../../support/client-source";

const CALL_SITES = ["SongSlide", "StageSlide", "TileGrid", "MenuHero", "PlayerRows", "TitleRoot", "ReadyRoom", "ResultsPanel"];

describe("AsyncImage's call sites", () => {
  it.each(CALL_SITES)("%s keeps every image rule it wrote", (name) => {
    const filename = clientFile(`${name}.svelte`);
    const { warnings } = compile(readClient(`${name}.svelte`), { filename, css: "external" });
    expect(warnings.filter((warning) => warning.code === "css_unused_selector").map((warning) => warning.message)).toEqual([]);
  });
});
