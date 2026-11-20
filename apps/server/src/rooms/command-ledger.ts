/**
 * Answers each correlated command exactly once.
 *
 * A client that loses its connection in the middle of a command cannot know
 * whether the room acted, so it resends the command with the same request id.
 * The ledger remembers the answer it gave each id and replays it, so a
 * resent "ready" or "race again" never acts twice. History is bounded per
 * session, oldest first out, so a client cannot make the room remember an
 * unbounded number of ids.
 *
 * No I/O: the room sends the answer; this only decides what it is.
 */

import { COMMAND_RESULT_HISTORY, REQUEST_ID_MAX_LENGTH } from "@floor-fifty/shared/common/constants";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { toServerError } from "./room-errors";

/** The answer to one command, and whether it came from history. */
export type LedgerAnswer = {
  readonly result: CommandResult;
  /** True when the command did not run because this id was answered before. */
  readonly replayed: boolean;
};

/**
 * The request id a command payload carries, if any.
 *
 * Read before the rest of the payload is validated, because even a malformed
 * command has to be answered, and the answer is addressed by this id.
 *
 * Runs on raw client data, so it must never throw (audit A01). It reads only
 * the payload's own plain property, which runs no code, and takes only a
 * string of 1 to `REQUEST_ID_MAX_LENGTH` characters as it is. Anything else
 * is no id: converting a value to a string can run code the client chose
 * (a decoded `{ toString: 1 }` throws), and an id that cannot be read cannot
 * address an answer, so the command is ignored.
 */
export function requestIdOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const property = Object.getOwnPropertyDescriptor(payload, "requestId");
  if (property === undefined || !("value" in property)) return undefined;
  const requestId: unknown = property.value;
  if (typeof requestId !== "string") return undefined;
  if (requestId.length < 1 || requestId.length > REQUEST_ID_MAX_LENGTH) return undefined;
  return requestId;
}

export class CommandLedger {
  /** Answers per session, oldest first: a `Map` iterates in insertion order. */
  private readonly answers = new Map<string, Map<string, CommandResult>>();

  constructor(private readonly capacity: number = COMMAND_RESULT_HISTORY) {}

  /**
   * Runs `run` for a request id this session has not sent before, or replays
   * the stored answer for one it has.
   *
   * `run` refuses by throwing. The throw becomes an `ok: false` answer and is
   * remembered like any other, so a resent refusal is refused again without
   * running a second time.
   */
  answer(sessionId: string, requestId: string, run: () => void): LedgerAnswer {
    const history = this.historyOf(sessionId);
    const stored = history.get(requestId);
    if (stored !== undefined) return { result: stored, replayed: true };

    let result: CommandResult;
    try {
      run();
      result = { requestId, ok: true };
    } catch (error) {
      result = { requestId, ok: false, error: toServerError(error) };
    }

    history.set(requestId, result);
    this.trim(history);
    return { result, replayed: false };
  }

  /** Drops a session's history, for a seat that has left for good. */
  forget(sessionId: string): void {
    this.answers.delete(sessionId);
  }

  private historyOf(sessionId: string): Map<string, CommandResult> {
    let history = this.answers.get(sessionId);
    if (history === undefined) {
      history = new Map();
      this.answers.set(sessionId, history);
    }
    return history;
  }

  /** Evicts the oldest answers until the history fits its capacity. */
  private trim(history: Map<string, CommandResult>): void {
    while (history.size > this.capacity) {
      const oldest = history.keys().next().value;
      if (oldest === undefined) return;
      history.delete(oldest);
    }
  }
}
