/**
 * A plain page that frames the game the way the new Ruken does, for
 * `ruken-frame.spec.ts`.
 *
 * The new Ruken has no SDK. It serves a game as a folder on its own origin
 * (`g-<id>.<games domain>`) and frames it, from another origin, in an iframe
 * with `sandbox="allow-scripts allow-same-origin allow-pointer-lock"` and
 * `allow="fullscreen; autoplay; gamepad; clipboard-write; web-share"`. This
 * starts two small servers on two origins to match:
 *
 *   - the host page, on `http://localhost:<port>`: the iframe, and a log of
 *     every message the game posts to its parent (the game posts none, since
 *     it speaks no host protocol);
 *   - the game, on `http://127.0.0.1:<port>`: the e2e client, passed through
 *     from its own server.
 */

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";

export type FrameHost = {
  /** The host page's URL, to give `page.goto`. */
  readonly url: string;
  /** Every message the game posted to the host page, in order. */
  messagesFromGame(page: Page): Promise<unknown[]>;
  close(): Promise<void>;
};

const SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";
const ALLOW = "fullscreen; autoplay; gamepad; clipboard-write; web-share";

const pageHtml = (gameUrl: string, viewportMeta: boolean): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />${viewportMeta ? '\n    <meta name="viewport" content="width=device-width, initial-scale=1" />' : ""}
    <title>Ruken (frame test)</title>
    <style>
      html, body { margin: 0; height: 100%; background: #14141c; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
    </style>
  </head>
  <body>
    <iframe src="${gameUrl}" sandbox="${SANDBOX}" allow="${ALLOW}"></iframe>
    <script>
      window.__fromGame = [];
      window.addEventListener("message", (event) => window.__fromGame.push(event.data));
    </script>
  </body>
</html>`;

/** Serves the e2e build, passed through from its own server, on its own origin. */
function gameServer(upstream: URL): Server {
  return createServer((request, response) => {
    const forwarded = httpRequest(
      { hostname: upstream.hostname, port: upstream.port, method: request.method, path: request.url, headers: { ...request.headers, host: upstream.host } },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    forwarded.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(forwarded);
  });
}

const closeServer = (server: Server): Promise<void> =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    // An open keep-alive connection from a page that has gone would hold close() up.
    server.closeAllConnections();
  });

/** Starts the host and game servers. Call `close()` when the test is done. */
export async function startFrameHost(options: {
  gameUrl: string;
  /**
   * Gives the host page a mobile viewport meta, as a phone-first host has.
   * Without it a mobile-emulated browser lays the host out 980 px wide and
   * the frame inherits that, so the game is drawn at a desktop width on a
   * phone. The screens walk sets it; the frame spec, which never emulates a
   * phone, leaves it off.
   */
  viewportMeta?: boolean;
}): Promise<FrameHost> {
  const game = gameServer(new URL(options.gameUrl));
  // Port 0 asks the system for a free port, so parallel workers never collide.
  await new Promise<void>((resolve) => game.listen(0, "127.0.0.1", resolve));
  const gameOrigin = `http://127.0.0.1:${(game.address() as AddressInfo).port}`;

  const hostServer = createServer((request, response) => {
    if ((request.url ?? "/").split("?")[0] === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(pageHtml(`${gameOrigin}/`, options.viewportMeta === true));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => hostServer.listen(0, "127.0.0.1", resolve));
  // `localhost`, not 127.0.0.1: the game is on 127.0.0.1, so this is another origin.
  const hostOrigin = `http://localhost:${(hostServer.address() as AddressInfo).port}`;

  return {
    url: `${hostOrigin}/`,
    messagesFromGame: (page) => page.evaluate(() => (window as unknown as { __fromGame: unknown[] }).__fromGame),
    close: async () => {
      await Promise.all([closeServer(hostServer), closeServer(game)]);
    },
  };
}
