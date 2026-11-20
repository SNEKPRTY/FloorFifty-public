/**
 * Flow graph validation.
 *
 * `FLOW_TARGETS` is read as a positive capability map: the required pairs, and
 * the destinations each pair may choose, are enumerated from it rather than
 * restated here. A screen or event added in code therefore becomes authorable
 * in exactly one edit.
 *
 * Cycles are legal -- racing again returns through the menu on purpose. What
 * is not legal is a graph a player can get stuck in, or one that re-enters the
 * splash screen after the game has started.
 */

import {
  FLOW_TARGETS,
  SCREEN_IDS,
  type FlowEvent,
  type FlowTransition,
  type PresentationFlow,
  type ScreenId,
} from "@floor-fifty/shared/content/presentation";
import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { Located } from "../types";

/** The only screen a session may begin on. */
const REQUIRED_ENTRY: ScreenId = "Splash";

type DeclaredPair = {
  readonly from: ScreenId;
  readonly event: FlowEvent;
  readonly targets: readonly ScreenId[];
};

/** Every source/event pair code declares, with the destinations it allows. */
const declaredPairs = (): readonly DeclaredPair[] =>
  Object.entries(FLOW_TARGETS).flatMap(([from, events]) =>
    Object.entries(events as Record<string, readonly ScreenId[]>).map(([event, targets]) => ({
      from: from as ScreenId,
      event: event as FlowEvent,
      targets,
    })),
  );

const pairKey = (from: ScreenId, event: FlowEvent): string => `${from}.${event}`;

/** Screens the entry can actually lead to. */
function reachableFrom(entry: ScreenId, transitions: readonly FlowTransition[]): Set<ScreenId> {
  const reached = new Set<ScreenId>([entry]);
  const queue: ScreenId[] = [entry];

  while (queue.length > 0) {
    const screen = queue.shift() as ScreenId;
    for (const transition of transitions) {
      if (transition.from !== screen || reached.has(transition.to)) continue;
      reached.add(transition.to);
      queue.push(transition.to);
    }
  }
  return reached;
}

export function validateFlow(flow: Located<PresentationFlow>): readonly Diagnostic[] {
  const { file, value } = flow;
  const diagnostics: Diagnostic[] = [];
  const refuse = (keyPath: string, message: string): void => {
    diagnostics.push({ code: "invalidFlow", file, keyPath, message });
  };

  if (value.entry !== REQUIRED_ENTRY)
    refuse("entry", `entry must be ${REQUIRED_ENTRY}, received ${value.entry}`);

  const pairs = declaredPairs();
  const allowed = new Map(pairs.map((pair) => [pairKey(pair.from, pair.event), pair.targets]));
  const seen = new Map<string, number>();

  value.transitions.forEach((transition, index) => {
    const key = pairKey(transition.from, transition.event);
    const targets = allowed.get(key);

    if (targets === undefined) {
      refuse(
        `transitions.${index}`,
        `${transition.from} declares no ${transition.event} transition`,
      );
      return;
    }

    const previous = seen.get(key);
    seen.set(key, (previous ?? 0) + 1);
    if (previous !== undefined) {
      refuse(`transitions.${key}`, `${key} is declared more than once`);
      return;
    }

    if (transition.from === transition.to)
      refuse(`transitions.${index}`, `${transition.from} may not transition to itself`);
    else if (!targets.includes(transition.to))
      refuse(
        `transitions.${key}`,
        `${key} may reach only ${targets.join(", ")}, received ${transition.to}`,
      );
  });

  for (const pair of pairs) {
    const key = pairKey(pair.from, pair.event);
    if (!seen.has(key)) refuse(`transitions.${key}`, `${key} has no transition`);
  }

  if (value.transitions.some((transition) => transition.to === value.entry))
    refuse("transitions", `the entry screen ${value.entry} may have no incoming transition`);

  const reached = reachableFrom(value.entry, value.transitions);
  for (const screen of SCREEN_IDS) {
    if (!reached.has(screen)) {
      refuse(screen, `${screen} is not reachable from ${value.entry}`);
      continue;
    }
    if (!value.transitions.some((transition) => transition.from === screen))
      refuse(screen, `${screen} has no outgoing transition`);
  }

  return sortDiagnostics(diagnostics);
}
