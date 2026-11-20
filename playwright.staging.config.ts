import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import releaseConfig from "./playwright.release.config";

// Run the existing release smoke against hosted staging as a focused remote
// check, without rebuilding or redeploying the already verified candidate.
const domain = readFileSync(new URL("./deploy/config.env", import.meta.url), "utf8").match(/^FF_DOMAIN=(.+)$/m)?.[1]?.trim();
if (!domain) throw new Error("deploy/config.env must name FF_DOMAIN for staging smoke");
process.env["FF_SMOKE_API"] = `https://staging-api.${domain}`;
process.env["FF_SMOKE_URL"] = `https://staging.${domain}/`;

export default defineConfig(releaseConfig, { projects: [{ name: "staging" }] });
