/**
 * Screens a case opened through the fakes and has not closed.
 *
 * A lobby mid-roulette keeps its spin timers, and one firing after the file's
 * jsdom is torn down throws "document is not defined" into the next file the
 * worker runs. The client setup closes what is left after each case.
 */

const openScreens = new Set<{ exit(): void }>();

/** Records `screen` as open until its own `exit` is called. */
export function trackScreen(screen: { exit(): void }): void {
  openScreens.add(screen);
  const exit = screen.exit.bind(screen);
  screen.exit = () => {
    openScreens.delete(screen);
    exit();
  };
}

/** Closes every screen a case left open. */
export function closeOpenScreens(): void {
  for (const screen of [...openScreens]) screen.exit();
  openScreens.clear();
}
