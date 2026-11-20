/**
 * Nameplate de-stacking (launch polish spec, phase 1).
 *
 * Seat lanes keep two overlapping names legible, but four racers in one spot
 * stacked four names into a tower that covered the racers it named. The rule
 * here: the local player's plate always shows -- it is how a player finds
 * themselves -- and every other racer in a cluster folds into one chip that
 * counts the whole cluster ("×4").
 *
 * Clustering is by position, in world units, against a plate-sized box: two
 * racers are together when each is inside the other's plate bounds. The camera
 * scales every racer alike, so world units are screen units up to one factor.
 *
 * A grouping only changes after it has held for `DECLUTTER_HOLD_MS`, so racers
 * brushing past each other do not make plates flap. Presentation only: it
 * reads drawn positions and decides nothing about the race.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";

/**
 * The box a nameplate occupies, in world units: about a ten-character name at
 * the plate's 11px monospace, and the height of the seat lanes it stacks in.
 */
export const NAMEPLATE_CLUSTER = { width: 64, height: 40 } as const;

/** How long a new grouping must hold before the plates follow it. */
export const DECLUTTER_HOLD_MS = 150;

export type PlateSite = Readonly<{ id: PlayerId; x: number; y: number }>;

export type NameplateChip = Readonly<{
  /** Racers in the cluster, the local one included when it is in it. */
  count: number;
  /** The cluster's mean x and topmost y, in world units (y up). */
  x: number;
  y: number;
  members: readonly PlayerId[];
}>;

export type Declutter = Readonly<{
  /** Racers whose own plate is folded into a chip. Never the local player. */
  hidden: ReadonlySet<PlayerId>;
  chips: readonly NameplateChip[];
}>;

const together = (a: PlateSite, b: PlateSite): boolean =>
  Math.abs(a.x - b.x) < NAMEPLATE_CLUSTER.width && Math.abs(a.y - b.y) < NAMEPLATE_CLUSTER.height;

/** The groups of two or more racers, each sorted, in a stable order. */
function groupsOf(sites: readonly PlateSite[]): PlayerId[][] {
  // Union-find over the pairs: four racers is sixteen comparisons.
  const parent = sites.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!;
    return index;
  };
  for (let a = 0; a < sites.length; a += 1) {
    for (let b = a + 1; b < sites.length; b += 1) {
      if (together(sites[a]!, sites[b]!)) parent[root(a)] = root(b);
    }
  }
  const byRoot = new Map<number, PlayerId[]>();
  sites.forEach((site, index) => {
    const members = byRoot.get(root(index)) ?? [];
    members.push(site.id);
    byRoot.set(root(index), members);
  });
  return [...byRoot.values()]
    .filter((members) => members.length > 1)
    .map((members) => members.sort())
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** Lays a grouping out against the racers' current positions. */
function layout(
  groups: readonly (readonly PlayerId[])[],
  sites: readonly PlateSite[],
  localId: PlayerId | undefined,
): Declutter {
  const at = new Map(sites.map((site) => [site.id, site]));
  const hidden = new Set<PlayerId>();
  const chips: NameplateChip[] = [];
  for (const group of groups) {
    // A racer who has left since the grouping formed is simply not in it.
    const present = group.map((id) => at.get(id)).filter((site) => site !== undefined);
    if (present.length < 2) continue;
    for (const site of present) if (site.id !== localId) hidden.add(site.id);
    chips.push({
      count: present.length,
      x: present.reduce((sum, site) => sum + site.x, 0) / present.length,
      y: Math.max(...present.map((site) => site.y)),
      members: present.map((site) => site.id),
    });
  }
  return { hidden, chips };
}

/** One frame's clustering, with no dwell. */
export function clusterPlates(sites: readonly PlateSite[], localId: PlayerId | undefined): Declutter {
  return layout(groupsOf(sites), sites, localId);
}

const keyOf = (groups: readonly (readonly PlayerId[])[]): string =>
  groups.map((group) => group.join(",")).join("|");

/** Clustering with a dwell: the grouping shown changes only once a new one holds. */
export class NameplateDeclutter {
  private shown: PlayerId[][] = [];
  private pending: { key: string; groups: PlayerId[][]; heldMs: number } | undefined;

  update(sites: readonly PlateSite[], localId: PlayerId | undefined, deltaMs: number): Declutter {
    const next = groupsOf(sites);
    const key = keyOf(next);
    if (key === keyOf(this.shown)) {
      this.pending = undefined;
    } else {
      const heldMs = (this.pending?.key === key ? this.pending.heldMs : 0) + Math.max(0, deltaMs);
      this.pending = { key, groups: next, heldMs };
      if (heldMs >= DECLUTTER_HOLD_MS) {
        this.shown = next;
        this.pending = undefined;
      }
    }
    return layout(this.shown, sites, localId);
  }
}
