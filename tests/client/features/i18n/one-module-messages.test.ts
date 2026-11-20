import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { m } from "../../../../apps/client/src/paraglide/messages.js";
import { locales } from "../../../../apps/client/src/paraglide/runtime.js";
import { mergedMessages } from "../../support/one-module-messages";

const folder = resolve(import.meta.dirname, "../../../../apps/client/src/paraglide/messages");
const files = readdirSync(folder).filter((name) => name.endsWith(".js") && name !== "_index.js");

describe("the client tests load the message catalogue as one module", () => {
  it("re-exports nothing: every message is defined in the one module", () => {
    const code = mergedMessages(folder);
    expect(code).not.toMatch(/^export \* from/m);
    expect(code.match(/^import /gm)?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("exports every message the compiled files do, and nothing else", () => {
    const names = files.map((name) => name.replace(/\.js$/, "")).sort();
    expect(Object.keys(m).sort()).toEqual(names);
  });

  it("gives the same text as each compiled file, in every locale", async () => {
    type Message = (inputs?: object, options?: { locale?: string }) => string;
    // Loads every compiled message file (400-odd modules), so its time grows with the catalogue, not
    // with a hang: they load together rather than one by one (about 2x faster), and the limit is
    // 20 s, not 5, because a full suite on a busy CPU pod pushed it past 5 (Flaky tests, #218, #261).
    const compiled = await Promise.all(
      files.map(async (name) => [name.replace(/\.js$/, ""), (await import(/* @vite-ignore */ join(folder, name))) as Record<string, Message>] as const),
    );
    for (const [key, one] of compiled) {
      const merged = (m as unknown as Record<string, Message>)[key]!;
      for (const locale of locales) {
        expect(merged({}, { locale }), `${key} in ${locale}`).toBe(one[key]!({}, { locale }));
      }
    }
  }, 20_000);
});
