/**
 * What touched what, as the solver saw it.
 *
 * Planck decides contact. A solid fact is a racer-floor contact the solver
 * resolved this step -- collected from `pre-solve`, which Box2D fires for every
 * touching contact before it solves it, swept (time-of-impact) contacts
 * included. A foot fact is the racer's foot sensor touching a floor.
 *
 * Nothing here computes an overlap. The only arithmetic is on the solver's own
 * answer: which way its normal points, and whether the racer was moving into
 * the face. That second test is what keeps the flush spawn seat, or a rider
 * resting beside a floor, from being owed an upforce they did not press for.
 *
 * A top is the exception. Nobody rests on a floor, so a top contact counts
 * unless the racer is already leaving it at bounce speed -- the tick after a
 * bounce, or the spawn seat. Held to the strict test, a top that began while
 * the racer was still rising (a bounce's apex grazing a floor sliding under
 * it) was dropped; the solver then zeroed `vy`, every later tick read a zero
 * approach, and the racer sat on the floor until a fast fall freed them.
 *
 * Order is part of the contract. Callbacks arrive in contact-list order, so
 * facts are merged and sorted by player id, floor index and kind before any
 * consequence reads them.
 */

import type { Contact } from "planck";
import type { PlayerId } from "../../common/ids";
import { TOP_NORMAL_MIN_Y } from "./config";
import { toMeters } from "./units";
import { tagOf, type PlanckWorld } from "./world";

export type ContactKind = "top" | "side" | "underside";

export type ContactFact =
  | { source: "solid"; playerId: PlayerId; floorId: string; floorIndex: number; kind: ContactKind; normalX: number; normalY: number }
  | { source: "foot"; playerId: PlayerId; floorId: string; floorIndex: number };

/** A total order, so a sort never falls back on arrival order. */
const RANK = { top: 0, side: 1, underside: 2, foot: 3 } as const;

const rankOf = (fact: ContactFact): number =>
  fact.source === "solid" ? RANK[fact.kind] : RANK.foot;

/** The face a contact is on, from a normal pointing from floor to racer. */
export function classifyNormal(normalY: number): ContactKind {
  if (normalY >= TOP_NORMAL_MIN_Y) return "top";
  if (normalY <= -TOP_NORMAL_MIN_Y) return "underside";
  return "side";
}

export type ContactCollector = {
  /** Forgets the previous step's solid facts. Call before `world.step`. */
  begin(): void;
  /** This step's solid facts plus every foot-sensor contact now touching. */
  take(): ContactFact[];
  /** Detaches the listener. Idempotent. */
  dispose(): void;
};

export function createContactCollector(
  planck: PlanckWorld,
  bounceVelocityPixels: number,
): ContactCollector {
  // Half the bounce: well clear of a racer who just bounced, and of any rise
  // slow enough to still be inside the contact skin.
  const leavingTop = toMeters(bounceVelocityPixels) / 2;
  let solids: ContactFact[] = [];
  let attached = true;
  // A world's racers are fixed for its life (`createPlanckWorld`), so their
  // order is taken once rather than sorted again every step.
  const playerIds = [...planck.racers.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  const onPreSolve = (contact: Contact): void => {
    const a = contact.getFixtureA();
    const b = contact.getFixtureB();
    if (a.isSensor() || b.isSensor()) return;

    const tagA = tagOf(a.getBody());
    const tagB = tagOf(b.getBody());
    const racerIsA = tagA?.kind === "racer";
    const racer = racerIsA ? tagA : tagB;
    const floor = racerIsA ? tagB : tagA;
    if (racer?.kind !== "racer" || floor?.kind !== "floor") return;

    const manifold = contact.getWorldManifold(null);
    if (manifold === undefined) return;

    // The manifold normal points from fixture A to fixture B; the rules want
    // it pointing from the floor to the racer.
    const sign = racerIsA ? -1 : 1;
    const normalX = sign * manifold.normal.x;
    const normalY = sign * manifold.normal.y;

    // Moving into the face, relative to a floor that may itself be moving.
    const racerVelocity = (racerIsA ? a : b).getBody().getLinearVelocity();
    const floorVelocity = (racerIsA ? b : a).getBody().getLinearVelocity();
    const approach =
      (racerVelocity.x - floorVelocity.x) * normalX + (racerVelocity.y - floorVelocity.y) * normalY;
    const kind = classifyNormal(normalY);
    const counts = kind === "top" ? approach < leavingTop : approach < 0;
    if (!counts) return;

    solids.push({
      source: "solid",
      playerId: racer.playerId,
      floorId: floor.floorId,
      floorIndex: floor.floorIndex,
      kind,
      normalX, normalY,
    });
  };

  planck.world.on("pre-solve", onPreSolve);

  return {
    begin() {
      solids = [];
    },

    take() {
      const facts = solids;
      solids = [];
      for (const playerId of playerIds) {
        const racer = planck.racers.get(playerId)!;
        for (let edge = racer.body.getContactList(); edge; edge = edge.next) {
          const contact = edge.contact;
          if (!contact.isTouching()) continue;
          if (contact.getFixtureA() !== racer.footSensor && contact.getFixtureB() !== racer.footSensor) {
            continue;
          }
          const tag = edge.other ? tagOf(edge.other) : undefined;
          if (tag?.kind !== "floor") continue;
          facts.push({ source: "foot", playerId, floorId: tag.floorId, floorIndex: tag.floorIndex });
        }
      }
      return facts;
    },

    dispose() {
      if (!attached) return;
      attached = false;
      planck.world.off("pre-solve", onPreSolve);
    },
  };
}

/** Merges duplicate claims and imposes a total order. */
export function normalizeFacts(facts: readonly ContactFact[]): ContactFact[] {
  const merged = new Map<string, ContactFact>();
  for (const fact of facts) {
    const key = `${fact.playerId}\u0000${fact.floorIndex}\u0000${rankOf(fact)}`;
    if (!merged.has(key)) merged.set(key, fact);
  }
  return [...merged.values()].sort((a, b) => {
    if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
    if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
    return rankOf(a) - rankOf(b);
  });
}
