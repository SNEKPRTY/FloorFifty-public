/**
 * The leaderboards Floor Fifty declares to Ruken, and the score a finished
 * race gives them (Ruken master plan M3.4, M3 contracts §4.2).
 *
 * The Owner's choice of what counts, as the game's creator: the time a racer
 * took to climb a finite course, fastest first. One board per course length,
 * named after its mode (`floors-20`, `floors-50`). Left out: the three-lap
 * 20-floor race (a longer climb that would sit among the one-lap times).
 *
 * Survival posts the highest floor a run reached to the `survival` board
 * (the Owner's F1 decision, 2026-10-27), once, when the run is over: the room
 * finished, the player was knocked out, or the player left. Never mid-run,
 * and never a run that did not clear a floor.
 *
 * The score is never typed by anyone (R-80): it is the finish time the room's
 * authority recorded for the local player, read from the finished snapshot.
 * Ruken checks it again on its side, against the range below, for a live
 * release session only.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { wasPlaced } from "./results";
import { SCORE_BOARDS, SURVIVAL_MODE_ID } from "../ruken/score-boards";

export type ScoreSubmission = { readonly board: string; readonly score: number };

/**
 * The score to send, or nothing when there is none yet or none at all.
 *
 * A time race counts once it is over: nothing for a mode or lap count without
 * a board, or a local player who did not finish with a place. A Survival run
 * counts once the local player's run is over, which `left` says it is when the
 * player leaves the room. A score outside its board's range is never sent.
 */
export function scoreToSubmit(
  snapshot: RoomSnapshot,
  localPlayerId: string | undefined,
  options: { readonly left?: boolean } = {},
): ScoreSubmission | undefined {
  const submission = snapshot.modeId === SURVIVAL_MODE_ID ? survivalScore(snapshot, localPlayerId, options.left === true) : finishTime(snapshot, localPlayerId);
  if (submission === undefined) return undefined;
  const board = SCORE_BOARDS[submission.board];
  if (board === undefined || submission.score < board.min || submission.score > board.max) return undefined;
  return submission;
}

function finishTime(snapshot: RoomSnapshot, localPlayerId: string | undefined): ScoreSubmission | undefined {
  if (snapshot.phase !== "finished" || snapshot.lapCount !== 1) return undefined;
  if (!Object.hasOwn(SCORE_BOARDS, snapshot.modeId)) return undefined;
  const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
  if (player === undefined || player.finishedAtTick === undefined || !wasPlaced(snapshot, player)) return undefined;
  // One tick is 16.67 ms; the leaderboard takes whole numbers.
  return { board: snapshot.modeId, score: Math.round(player.finishedAtTick * TICK_MS) };
}

/** The highest floor the room's authority credited the local player, kept through a fall. */
function survivalScore(snapshot: RoomSnapshot, localPlayerId: string | undefined, left: boolean): ScoreSubmission | undefined {
  const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
  if (player === undefined || player.status === "dns") return undefined;
  const over = snapshot.phase === "finished" || player.outAtTick !== undefined || (left && snapshot.phase === "racing");
  return over ? { board: "survival", score: player.bestFloor } : undefined;
}
