/**
 * Two promises a production process keeps.
 *
 * - It is not kept alive in an unknown state (release readiness §5.5): an
 *   error nothing caught writes one fatal line, which stays in the box's
 *   journal, and the process exits 1 for systemd to restart.
 * - It refuses to start with a test or debug switch set (§6.6), naming the
 *   switch, so a copied environment file cannot mount the test driver or the
 *   telemetry endpoint in front of players; and it refuses to start without
 *   its room cap and its origin list.
 */

const FORBIDDEN = ["FLOOR_FIFTY_TEST_DRIVER_TOKEN", "FLOOR_FIFTY_TEST_SEED"] as const;

export function forbiddenInProduction(env: Readonly<Record<string, string | undefined>>): string[] {
  // Every guard below hangs on NODE_ENV, so a Fly Machine (Fly sets FLY_APP_NAME
  // on each) that lacks it must not start: it would be open to every origin,
  // with no room cap (production audit S5).
  const onFly = (env["FLY_APP_NAME"] ?? "") !== "";
  if (env["NODE_ENV"] !== "production") {
    if (onFly) return ["NODE_ENV (not production on Fly)"];
    // Not production by NODE_ENV, and not driven by the browser suite (the test
    // driver is never mounted on a public server): it still answers the world,
    // and with no origin list it would answer every origin (audit S5).
    const driven = (env["FLOOR_FIFTY_TEST_DRIVER_TOKEN"] ?? "") !== "";
    if (!driven && (env["FLOOR_FIFTY_ALLOWED_ORIGINS"] ?? "").trim() === "") return ["FLOOR_FIFTY_ALLOWED_ORIGINS (unset)"];
    return [];
  }
  const set: string[] = FORBIDDEN.filter((name) => (env[name] ?? "") !== "");
  if (env["FLOOR_FIFTY_TELEMETRY"] === "1") set.push("FLOOR_FIFTY_TELEMETRY");
  // A public server with no room cap or no origin list is wide open (§6.1, §6.5).
  const maxRooms = Number(env["MAX_ROOMS"]);
  if (!Number.isInteger(maxRooms) || maxRooms < 1) set.push("MAX_ROOMS (unset)");
  if ((env["FLOOR_FIFTY_ALLOWED_ORIGINS"] ?? "").trim() === "") set.push("FLOOR_FIFTY_ALLOWED_ORIGINS (unset)");
  // Behind Fly every player arrives from Fly's proxy; without the rule that
  // reads Fly-Client-IP they would all share one set of rate limits (§2.3).
  const proxy = env["FLOOR_FIFTY_PROXY"] ?? "";
  if (proxy !== "" && proxy !== "caddy" && proxy !== "fly") set.push("FLOOR_FIFTY_PROXY (invalid)");
  else if (onFly && proxy !== "fly") set.push("FLOOR_FIFTY_PROXY (unset on Fly)");
  return set;
}

export function installCrashHandlers(
  target: { on(event: "unhandledRejection" | "uncaughtException", fn: (error: unknown) => void): unknown },
  exit: (code: number) => void,
  write: (line: string) => void,
): void {
  const fatal = (error: unknown): void => {
    const err = error instanceof Error ? error : new Error(String(error));
    write(JSON.stringify({ event: "fatal", class: err.name, stack: err.stack ?? "" }));
    exit(1);
  };
  target.on("unhandledRejection", fatal);
  target.on("uncaughtException", fatal);
}
