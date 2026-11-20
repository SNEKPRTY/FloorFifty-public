/**
 * `?dev=juice` (polish spec §4.1): live juice tuning, in a dev build only.
 *
 * A pure function of the query and the build, as `unlockAllFor` is, so both
 * branches are tested without a browser.
 */
export function juiceLiveTuningFor(search: string, dev: boolean): boolean {
  if (!dev) return false;
  return new URLSearchParams(search).getAll("dev").includes("juice");
}
