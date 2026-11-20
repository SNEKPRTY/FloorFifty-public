/**
 * Per-key token buckets, in memory and bounded (release readiness §6.1).
 *
 * A key is an IP address. It is never written anywhere: the map is the only
 * place one lives, and it holds at most `maxKeys`, dropping the least recently
 * used, so a spray of addresses costs a bounded amount of memory.
 */

type Bucket = { tokens: number; at: number };

export type TokenBucketOptions = {
  /** How many a quiet key may take at once. */
  burst: number;
  /** How long one token takes to come back. */
  refillMs: number;
  maxKeys: number;
  now?: () => number;
};

export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: TokenBucketOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Takes one token for `key`, and says whether there was one. */
  take(key: string): boolean {
    const now = this.now();
    const bucket = this.refilled(this.buckets.get(key) ?? { tokens: this.options.burst, at: now }, now);
    // Re-inserting moves the key to the back, so the front is the least recently used.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.options.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drops every bucket that has refilled to its burst: it would behave exactly like a new one. */
  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (this.refilled(bucket, now).tokens >= this.options.burst) this.buckets.delete(key);
    }
  }

  private refilled(bucket: Bucket, now: number): Bucket {
    const earned = Math.floor((now - bucket.at) / this.options.refillMs);
    if (earned <= 0) return bucket;
    return {
      tokens: Math.min(this.options.burst, bucket.tokens + earned),
      at: bucket.at + earned * this.options.refillMs,
    };
  }
}
