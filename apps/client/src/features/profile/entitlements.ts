/**
 * The packs this device owns (unlockables spec §8).
 *
 * Plumbing with no store in front of it: `grant` is the one method a future
 * sales channel calls, and in this phase only the dev flag calls it. Validated
 * and failure-tolerant the same way as the progress store: an unreadable value
 * reads as empty and is not written over until something changes.
 */
import { z } from "zod";
import type { SettingsStorage } from "./settings";

export const ENTITLEMENTS_KEY = "floor-fifty.entitlements.v1";

const entitlementsSchema = z.object({ version: z.literal(1), owned: z.array(z.string()) }).strict();

export type EntitlementsData = z.infer<typeof entitlementsSchema>;

export function loadEntitlements(storage: SettingsStorage | undefined): EntitlementsData {
  try {
    const raw = storage?.getItem(ENTITLEMENTS_KEY) ?? null;
    if (raw === null) return { version: 1, owned: [] };
    const parsed = entitlementsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { version: 1, owned: [] };
  } catch {
    return { version: 1, owned: [] };
  }
}

export function saveEntitlements(storage: SettingsStorage | undefined, data: EntitlementsData): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(ENTITLEMENTS_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** `?dev=own=<packId>`, repeatable, honoured only in a dev build (spec §8). */
export function devOwnedPacks(search: string, dev: boolean): string[] {
  if (!dev) return [];
  return new URLSearchParams(search)
    .getAll("dev")
    .filter((value) => value.startsWith("own="))
    .map((value) => value.slice("own=".length))
    .filter((id) => id.length > 0);
}
