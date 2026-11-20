/**
 * Reading a request body under a cap, and refusing one past it, for every
 * route that reads a body (matchmaking and telemetry; release readiness §6.1,
 * §7.1). One reader, so the routes cannot drift apart.
 *
 * Past the cap the reader stops reading and resolves `undefined` at once;
 * `refuseTooLarge` answers 413 and closes the connection once the answer is
 * out, so a body that never ends cannot hold the server reading it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The longest a body may take to arrive (QC: read timeouts). Bodies here are a
 * few hundred bytes; past this the sender is trickling, and its connection is
 * dropped rather than held. Node's own request timeout does not reach a body
 * whose headers were already handed to a listener.
 */
export const BODY_TIMEOUT_MS = 10_000;

export function readCappedBody(
  request: IncomingMessage,
  limit: number,
  timeoutMs: number = BODY_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      request.off("data", onData);
      request.socket.destroy();
      reject(new Error("request body timed out"));
    }, timeoutMs);
    timer.unref();
    request.once("close", () => clearTimeout(timer));
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        clearTimeout(timer);
        request.off("data", onData);
        request.pause();
        chunks.length = 0;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    };
    request.on("data", onData);
    request.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function refuseTooLarge(
  request: IncomingMessage,
  response: ServerResponse,
  headers: Record<string, string> = {},
): void {
  response.writeHead(413, { "content-type": "application/json", ...headers, connection: "close" });
  response.end(JSON.stringify({ error: "request body too large" }));
  response.once("finish", () => request.socket.destroy());
}
