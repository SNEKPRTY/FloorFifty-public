/**
 * What each seat may pick, as reported (spec §4.3).
 *
 * The server trusts the report and cuts it to the catalog. A seat that sent
 * none -- an older fixture, the test driver -- may pick the open set, which
 * the server works out from the artifact itself.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { intersectAccess, openSets, type AccessSets } from "@floor-fifty/shared/content/access";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";

export class AccessBook {
  private readonly bySeat = new Map<PlayerId, AccessSets>();
  private readonly open: AccessSets;

  constructor(private readonly content: GameContentPayload) {
    this.open = openSets(content);
  }

  /**
   * Stores a seat's report cut to the catalog; an absent report is the open
   * set. A kind the cut leaves empty, a report of nothing or only of IDs this
   * build lacks, is the open set too: a pick step needs something to focus,
   * and the roulette something to draw.
   */
  set(playerId: PlayerId, report: AccessSets | undefined): AccessSets {
    const access = report === undefined ? this.open : this.orOpen(intersectAccess(this.content, report));
    this.bySeat.set(playerId, access);
    return access;
  }

  /** The open set for a seat never reported. */
  of(playerId: PlayerId): AccessSets {
    return this.bySeat.get(playerId) ?? this.open;
  }

  forget(playerId: PlayerId): void {
    this.bySeat.delete(playerId);
  }

  private orOpen(cut: AccessSets): AccessSets {
    return {
      stages: cut.stages.length > 0 ? cut.stages : this.open.stages,
      songs: cut.songs.length > 0 ? cut.songs : this.open.songs,
      characters: cut.characters.length > 0 ? cut.characters : this.open.characters,
    };
  }
}
