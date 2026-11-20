/**
 * What this device has earned (unlockables spec §5).
 *
 * Pure: a validated shape and the reducers that move it. The store in
 * `features/profile/store/progress.svelte.ts` holds it, saves it and tells listeners.
 *
 * An unreadable value reads as empty but is not written over until something
 * changes. A newer build's value (a higher `version`) is never written over:
 * opening an older build must not erase it. Fields a later v1 build added, and
 * IDs this build does not know, are kept and never judged.
 */
import { z } from "zod";
import {
  CONDITIONS,
  CONDITION_THRESHOLDS,
  LEGACY_CONDITIONS,
  finishedMatch,
  isConditionId,
  type RaceFacts,
} from "@floor-fifty/shared/unlocks/conditions";
import type { SettingsStorage } from "./settings";

export const PROGRESS_KEY = "floor-fifty.progress.v1";
export const COUNTED_KEEP = 16;

const progressSchema = z
  .object({
    version: z.literal(1),
    seq: z.number().int().nonnegative(),
    unlocked: z.array(z.string()),
    pending: z.array(z.object({ id: z.string(), seq: z.number().int().nonnegative() }).strict()),
    stats: z.object({ matchesFinished: z.number().int().nonnegative() }).strict(),
    counted: z.array(z.string()),
    slot: z.object({ raceKey: z.string(), used: z.boolean() }).strict().nullable(),
    revealed: z.array(z.string()),
  })
  // Not strict: a field a later v1 build adds rides through every reducer's spread.
  .passthrough();

export type ProgressData = z.infer<typeof progressSchema>;
export type Step = { data: ProgressData; granted?: string };

export function emptyProgress(): ProgressData {
  return { version: 1, seq: 0, unlocked: [], pending: [], stats: { matchesFinished: 0 }, counted: [], slot: null, revealed: [] };
}

export function loadProgress(storage: SettingsStorage | undefined): ProgressData {
  return readProgress(storage) ?? emptyProgress();
}

/** The stored progress, or undefined when there is none, it is unreadable, or the storage throws. */
export function readProgress(storage: SettingsStorage | undefined): ProgressData | undefined {
  try {
    const raw = storage?.getItem(PROGRESS_KEY) ?? null;
    if (raw === null) return undefined;
    const parsed = progressSchema.safeParse(JSON.parse(raw));
    return parsed.success ? migrateLegacy(parsed.data) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a retired condition ID as the one that took over its items
 * (`LEGACY_CONDITIONS`), so a device keeps what it earned. A pending entry
 * whose new ID is already held is dropped rather than granted twice.
 */
export function migrateLegacy(data: ProgressData): ProgressData {
  const renamed = (id: string): string => LEGACY_CONDITIONS[id] ?? id;
  if (![...data.unlocked, ...data.pending.map((p) => p.id)].some((id) => id in LEGACY_CONDITIONS)) return data;
  const unlocked = [...new Set(data.unlocked.map(renamed))];
  const pending = data.pending
    .map((p) => ({ ...p, id: renamed(p.id) }))
    .filter((p, i, all) => !unlocked.includes(p.id) && all.findIndex((q) => q.id === p.id) === i);
  return { ...data, unlocked, pending };
}

/** Whether the stored progress is a newer build's, which this build must never write over. */
export function isNewerProgress(storage: SettingsStorage | undefined): boolean {
  try {
    const raw = storage?.getItem(PROGRESS_KEY) ?? null;
    const version = raw === null ? undefined : (JSON.parse(raw) as { version?: unknown } | null)?.version;
    return typeof version === "number" && version > 1;
  } catch {
    return false;
  }
}

export function saveProgress(storage: SettingsStorage | undefined, data: ProgressData): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const held = (data: ProgressData, id: string) => data.unlocked.includes(id) || data.pending.some((p) => p.id === id);

/** Queues every newly met condition, in `order`, with consecutive sequence numbers. */
function queueMet(data: ProgressData, met: readonly string[]): ProgressData {
  const fresh = met.filter((id) => !held(data, id));
  if (fresh.length === 0) return data;
  return {
    ...data,
    seq: data.seq + fresh.length,
    pending: [...data.pending, ...fresh.map((id, i) => ({ id, seq: data.seq + i }))],
  };
}

/** Grants the lowest pending sequence into the open slot, if there is one to use. */
function grantInto(data: ProgressData): Step {
  if (data.slot === null || data.slot.used || data.pending.length === 0) return { data };
  const next = data.pending.reduce((low, p) => (p.seq < low.seq ? p : low));
  return {
    data: {
      ...data,
      unlocked: [...data.unlocked, next.id],
      pending: data.pending.filter((p) => p !== next),
      slot: { ...data.slot, used: true },
    },
    granted: next.id,
  };
}

/** Results for a race (§5.2): judge, queue, count the key, open the slot, grant one. One write. */
export function judgeResults(data: ProgressData, race: RaceFacts, key: string, order: readonly string[]): Step {
  if (data.counted.includes(key)) return { data };
  const finished = finishedMatch(race);
  const matchesFinished = data.stats.matchesFinished + (finished ? 1 : 0);
  const facts = { race, matchesFinished, shared: false };
  const met = order.filter((id) => isConditionId(id) && id !== "share-replay" && CONDITIONS[id](facts));
  const queued = queueMet({ ...data, stats: { matchesFinished } }, met);
  return grantInto({
    ...queued,
    counted: [...queued.counted, key].slice(-COUNTED_KEEP),
    slot: { raceKey: key, used: false },
  });
}

/**
 * A save or share (§5.2). `round` is the results' race key, or undefined once
 * the room has moved on from those results: then the share waits for the next
 * results even when an old slot is still open.
 */
export function recordShare(data: ProgressData, round: string | undefined, order: readonly string[]): Step {
  const queued = order.includes("share-replay") ? queueMet(data, ["share-replay"]) : data;
  if (round === undefined || queued.slot?.raceKey !== round) return { data: queued };
  return grantInto(queued);
}

/** The next race's countdown began. */
export function closeSlot(data: ProgressData): ProgressData {
  return data.slot === null ? data : { ...data, slot: null };
}

/** `itemKey` is `"<kind>:<id>"`. */
export function reveal(data: ProgressData, itemKey: string): ProgressData {
  return data.revealed.includes(itemKey) ? data : { ...data, revealed: [...data.revealed, itemKey] };
}

/** Only counted conditions have a count; any other is undefined so its tile draws no bar. */
export function countOf(data: ProgressData, conditionId: string): number | undefined {
  if (!isConditionId(conditionId)) return undefined;
  const threshold = CONDITION_THRESHOLDS[conditionId];
  return threshold === undefined ? undefined : Math.min(data.stats.matchesFinished, threshold);
}
