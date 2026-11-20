#!/usr/bin/env node
// Serves a built client with the standalone CSP from
// deploy/caddy/security-headers.caddy, so the smoke can prove the page boots
// under the policy staging sends (release readiness §6.3).
//
// Usage: node tests/release/csp-server.mjs <dist> <port> <api-origin>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [dist, portArg, api] = process.argv.slice(2);
if (dist === undefined || portArg === undefined || api === undefined) {
  process.stderr.write("usage: csp-server.mjs <dist> <port> <api-origin>\n");
  process.exit(2);
}

const snippet = await readFile(new URL("../../deploy/caddy/security-headers.caddy", import.meta.url), "utf8");
const header = (name) => new RegExp(`${name} "([^"]+)"`).exec(snippet)?.[1] ?? "";
const ws = api.replace(/^http/, "ws");
const csp = header("Content-Security-Policy").replace(
  /https:\/\/staging-api\.\{\$FF_DOMAIN\} wss:\/\/staging-api\.\{\$FF_DOMAIN\}/,
  `${api} ${ws}`,
);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(dist, path.endsWith("/") ? `${path}index.html` : path);
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(portArg), "127.0.0.1");
process.stdout.write(`serving ${dist} on ${portArg} under the standalone CSP\n`);
