/**
 * The hosting this tab booted with.
 *
 * `boot()` installs it once, before anything is drawn. A component deep in the
 * tree (the name field, the title's Quit, the fullscreen button) reads it here
 * rather than having it passed down through every screen in between.
 *
 * Until boot installs one -- and in every test that never does -- it is
 * `localHosting()`: today's behaviour, unchanged.
 */

import { localHosting, type Hosting } from "./host";

let current: Hosting | undefined;

export function installHosting(hosting: Hosting): void {
  current = hosting;
}

export function currentHosting(): Hosting {
  current ??= localHosting();
  return current;
}
