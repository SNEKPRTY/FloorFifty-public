/**
 * Which pages may use this server (release readiness §6.5).
 *
 * `FLOOR_FIFTY_ALLOWED_ORIGINS` lists the client origins, comma-separated and
 * matched exactly: the staging client, and the Ruken game origins in
 * production (Amendment R). Unset, as in dev, every origin is allowed.
 *
 * This keeps other websites from using the server from their pages. It does
 * not stop a script that forges the header; the rate limits are for that.
 */

export type OriginPolicy = {
  /** Whether a request or socket from `origin` may proceed. */
  allows(origin: string | undefined): boolean;
  /** The CORS headers an answer to `origin` carries. */
  corsHeaders(origin: string | undefined): Record<string, string>;
};

export function originPolicy(list: string | undefined): OriginPolicy {
  const origins = new Set(
    (list ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  );
  if (origins.size === 0) {
    return { allows: () => true, corsHeaders: () => ({ "access-control-allow-origin": "*" }) };
  }
  const allows = (origin: string | undefined): boolean => origin !== undefined && origins.has(origin);
  return {
    allows,
    corsHeaders: (origin) =>
      allows(origin) ? { "access-control-allow-origin": origin!, vary: "Origin" } : { vary: "Origin" },
  };
}
