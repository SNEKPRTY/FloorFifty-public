/**
 * What a page's matchmaking calls did on the wire.
 *
 * A join the room refuses and a join that never got an answer look the same on
 * the screen: the lobby says "There is no room with that code." for every
 * refusal it has no better words for, a reset connection and a seat reservation
 * that expired among them. The page's own requests say which it was, and a spec
 * that has to tell them apart (`joinRoom`) listens here.
 */

import type { Page } from "@playwright/test";

export type MatchmakingWatch = {
  /** One line per matchmaking call the page made, newest last: status and path, or the wire's error. */
  readonly lines: string[];
  /** What the last call that did not seat the player said, if there was one. */
  refusal(): string | undefined;
  /** Stops listening. */
  stop(): void;
};

/** `/matchmake/joinById/ABC234`, as `joinById/ABC234`. */
function callOf(url: string): string | undefined {
  const at = url.indexOf("/matchmake/");
  return at < 0 ? undefined : url.slice(at + "/matchmake/".length);
}

export function watchMatchmaking(page: Pick<Page, "on" | "off">): MatchmakingWatch {
  const lines: string[] = [];
  let refusal: string | undefined;

  const onResponse = async (response: { url(): string; status(): number; text(): Promise<string> }): Promise<void> => {
    const call = callOf(response.url());
    if (call === undefined) return;
    const status = response.status();
    if (status < 400) {
      lines.push(`${status} ${call}`);
      refusal = undefined;
    } else {
      const said = `${status} ${call} ${(await response.text().catch(() => "")).slice(0, 200)}`.trim();
      lines.push(said);
      refusal = said;
    }
  };
  const onFailed = (request: { url(): string; failure(): { errorText: string } | null }): void => {
    const call = callOf(request.url());
    if (call === undefined) return;
    const said = `FAILED ${call} ${request.failure()?.errorText ?? ""}`.trim();
    lines.push(said);
    refusal = said;
  };

  page.on("response", onResponse as never);
  page.on("requestfailed", onFailed as never);
  return {
    lines,
    refusal: () => refusal,
    stop() {
      page.off("response", onResponse as never);
      page.off("requestfailed", onFailed as never);
    },
  };
}
