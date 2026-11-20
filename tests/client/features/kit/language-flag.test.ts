// @vitest-environment node
/**
 * The large flags (the first visit's language step) sit two to a line beside the language's name, in
 * columns that let the name wrap, so the dialog never scrolls sideways on a phone held upright. Read
 * from the style sheets, since a jsdom render has no layout.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the large language flags", () => {
  const flag = read("apps/client/src/features/kit/LanguageFlag.svelte");
  const picker = read("apps/client/src/features/settings/LanguagePicker.svelte");

  it("sit two to a line in equal columns that let a name wrap, so a long name never widens the dialog", () => {
    expect(picker).toMatch(/\.ff-language-picker__flags\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(picker).toMatch(/\.ff-language-picker__name\s*\{[^}]*min-width:\s*0/);
    expect(Number(/\[data-size="large"\]\s*\{[^}]*inline-size:\s*(\d+)px/.exec(flag)?.[1])).toBeGreaterThanOrEqual(48);
  });
});
