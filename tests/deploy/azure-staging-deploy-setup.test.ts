import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../deploy/tools/azure-staging-deploy-setup.sh");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(existing = "", listFails = false) {
  const dir = mkdtempSync(join(tmpdir(), "ff-azure-trust-"));
  dirs.push(dir);
  const log = join(dir, "calls.jsonl");
  const az = join(dir, "az");
  writeFileSync(az, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FF_AZ_CALLS, JSON.stringify(args) + "\\n");
const starts = (prefix) => args.slice(0, prefix.length).join(" ") === prefix.join(" ");
const query = args[args.indexOf("--query") + 1];
if (starts(["account", "show"])) console.log(query === "tenantId" ? "tenant-id" : "subscription-id");
else if (starts(["vm", "show"])) console.log(query === "location" ? "westus3" : "/subscriptions/subscription-id/resourceGroups/floor-fifty/providers/Microsoft.Compute/virtualMachines/floor-fifty-staging");
else if (starts(["storage", "account", "show"]) && query === "id") console.log("/subscriptions/subscription-id/resourceGroups/floor-fifty/providers/Microsoft.Storage/storageAccounts/staging");
else if (starts(["ad", "app", "list"])) console.log("staging-app-id");
else if (starts(["ad", "app", "federated-credential", "list"])) {
  if (process.env.FF_AZ_LIST_FAILS === "true") process.exit(12);
  console.log(process.env.FF_AZ_EXISTING);
}
`);
  chmodSync(az, 0o755);
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FF_STORAGE_ACCOUNT: "staging",
      FF_AZ_CALLS: log,
      FF_AZ_EXISTING: existing,
      FF_AZ_LIST_FAILS: String(listFails),
    },
    timeout: 10_000,
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  const credentials = calls.filter((args) => args.slice(0, 3).join(" ") === "ad app federated-credential");
  return { result, credentials, calls };
}

const trust = {
  name: "staging-env",
  issuer: "https://token.actions.githubusercontent.com",
  subject: "repo:SNEKPRTY@334282915/FloorFifty@1375202945:environment:staging",
  audiences: ["api://AzureADTokenExchange"],
};

describe("Azure staging OIDC setup", () => {
  it("creates trust for this repository's ID-bound staging subject", () => {
    const { result, credentials } = setup();
    expect(result.status, result.stderr).toBe(0);
    const created = credentials.find((args) => args[3] === "create");
    expect(created).toBeDefined();
    expect(created![created!.indexOf("--id") + 1]).toBe("staging-app-id");
    expect(JSON.parse(created![created!.indexOf("--parameters") + 1]!)).toEqual(trust);
  });

  it("repairs the existing staging credential instead of leaving stale trust", () => {
    const { result, credentials } = setup("existing-staging-credential-id");
    expect(result.status, result.stderr).toBe(0);
    const updated = credentials.find((args) => args[3] === "update");
    expect(updated).toBeDefined();
    expect(updated![updated!.indexOf("--id") + 1]).toBe("staging-app-id");
    expect(updated![updated!.indexOf("--federated-credential-id") + 1]).toBe("existing-staging-credential-id");
    expect(JSON.parse(updated![updated!.indexOf("--parameters") + 1]!)).toEqual(trust);
    expect(credentials.some((args) => args[3] === "create")).toBe(false);
  });

  it("stops if trust lookup fails, before creating credentials or assigning roles", () => {
    const { result, credentials, calls } = setup("", true);
    expect(result.status).not.toBe(0);
    expect(credentials.some((args) => args[3] === "create" || args[3] === "update")).toBe(false);
    expect(calls.some((args) => args[0] === "role")).toBe(false);
  });
});
