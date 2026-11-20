// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import {
  devOwnedPacks,
  ENTITLEMENTS_KEY,
  loadEntitlements,
  saveEntitlements,
} from "../../../../apps/client/src/features/profile/entitlements";
import type { SettingsStorage } from "../../../../apps/client/src/features/profile/settings";
import { EntitlementsStore } from "../../../../apps/client/src/features/profile/store/entitlements.svelte";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

const memory = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  } satisfies SettingsStorage & { values: Map<string, string> };
};

describe("entitlements", () => {
  it("reads empty, and an invalid value as empty without overwriting it", () => {
    const storage = memory({ [ENTITLEMENTS_KEY]: '{"version":9}' });
    expect(loadEntitlements(storage)).toEqual({ version: 1, owned: [] });
    expect(storage.values.get(ENTITLEMENTS_KEY)).toBe('{"version":9}');
  });

  it("grants a DLC pack and persists it", () => {
    const storage = memory();
    const store = new EntitlementsStore(storage, () => content);
    expect(store.grant("after-hours")).toBe(true);
    expect(store.owns("after-hours")).toBe(true);
    expect(new EntitlementsStore(storage, () => content).owns("after-hours")).toBe(true);
  });

  it("refuses a pack the catalog does not mark dlc, and an unknown one", () => {
    const storage = memory();
    const store = new EntitlementsStore(storage, () => content);
    expect(store.grant("base")).toBe(false);
    expect(store.grant("nope")).toBe(false);
    expect(storage.values.has(ENTITLEMENTS_KEY)).toBe(false);
  });

  it("?dev=own= is repeatable, and inert in a production build", () => {
    expect(devOwnedPacks("?dev=own=after-hours&dev=own=later", true)).toEqual(["after-hours", "later"]);
    expect(devOwnedPacks("?dev=own=after-hours", false)).toEqual([]);
    expect(devOwnedPacks("?dev=unlock-all", true)).toEqual([]);
  });

  it("tells listeners on a grant, and only on a change", () => {
    const store = new EntitlementsStore(memory(), () => content);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.grant("after-hours");
    store.grant("after-hours");
    expect(calls).toBe(1);
  });

  it("keeps a grant in memory with no storage", () => {
    const store = new EntitlementsStore(undefined, () => content);
    expect(store.grant("after-hours")).toBe(true);
    expect(store.owns("after-hours")).toBe(true);
    expect(saveEntitlements(undefined, { version: 1, owned: [] })).toBe(false);
  });
});
