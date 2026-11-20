import type {
  PresentationEnvelope,
  PresentationPublisher,
} from "../../../../apps/client/src/features/screen/presentation/presentation-event-bus";

/**
 * A publisher that records what a screen said happened.
 *
 * Screens no longer name destinations, so the question a test asks has moved
 * with them: not "where did it ask to go" but "what did it report".
 */
export function recordingPublisher(): {
  publish: PresentationPublisher;
  events: PresentationEnvelope[];
} {
  const events: PresentationEnvelope[] = [];
  return {
    events,
    publish: (name, payload) => void events.push({ name, payload } as PresentationEnvelope),
  };
}
