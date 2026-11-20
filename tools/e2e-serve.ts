// Starts this checkout's e2e server and built client on its own ports and
// keeps them up, so local spec runs with FLOOR_FIFTY_E2E_REUSE=1 skip the
// server start and the client build.
//
// The ports come from playwright.config.ts, which derives them from the
// checkout's path and publishes them on process.env when it is loaded, so
// these servers sit exactly where that worktree's Playwright looks.
//
// Usage: pnpm e2e:serve   (Ctrl-C stops both; restart after changing code,
//                          because the client is served from a build)
import { spawn } from "node:child_process";
import "../playwright.config.ts";

const children = ["e2e:server", "e2e:client"].map((script) =>
  spawn("pnpm", [script], { stdio: "inherit", env: process.env }),
);
console.log(
  `e2e server on :${process.env["E2E_SERVER_PORT"]}, client on :${process.env["E2E_CLIENT_PORT"]}`,
);

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 1;
  });
}
