/**
 * The decode cache: one shared promise per alias, so two asks share one
 * decode, and a failed or empty decode is forgotten so the next ask tries
 * again.
 *
 * Split out of `engine.ts`; which track the music slot, a bed or a cue asks
 * for is their business, how a fetch is shared is this one's.
 */

import type { DecodedTrack } from "./model";

export class TrackLibrary {
  /** Decodes by alias, the promise kept so two asks share one decode. */
  private readonly cache = new Map<string, Promise<DecodedTrack | undefined>>();
  /** The same decodes once they have landed, for a caller that cannot wait. */
  private readonly landed = new Map<string, DecodedTrack>();

  constructor(private readonly decode: (alias: string) => Promise<DecodedTrack | undefined>) {}

  /** Decodes a track ahead of its first play, so that play starts at once. */
  async preload(alias: string): Promise<void> {
    await this.trackFor(alias);
  }

  trackFor(alias: string): Promise<DecodedTrack | undefined> {
    let track = this.cache.get(alias);
    if (track === undefined) {
      const decoding = this.decode(alias);
      track = decoding;
      this.cache.set(alias, decoding);
      // A decode that failed, or found nothing -- a manifest that had not
      // arrived, a file that answered 404 -- is asked for again, as before it
      // was shared. Remembering nothing would keep a track silent for the
      // whole session after one bad fetch.
      const forget = (): void => {
        if (this.cache.get(alias) === decoding) this.cache.delete(alias);
      };
      decoding.then((decoded) => {
        if (decoded === undefined) forget();
        else if (this.cache.get(alias) === decoding) this.landed.set(alias, decoded);
      }, forget);
    }
    return track;
  }

  /**
   * The track if its decode has already landed, otherwise undefined. The
   * music deck asks this to tell a song it can start at once from one it must
   * stream while the decode runs.
   */
  decodedTrack(alias: string): DecodedTrack | undefined {
    return this.landed.get(alias);
  }

  /** Forgets a decoded track: a clip the song step paged away from. */
  forget(alias: string): void {
    this.cache.delete(alias);
    this.landed.delete(alias);
  }
}
