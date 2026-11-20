/**
 * `pnpm assets:images [name...]`.
 *
 * Generates source art for review. Sources, not assets: a generated image is
 * reviewed and committed under `assets/source/`, then converted onto the
 * palette by the plate tools. Regenerating is a deliberate act with a new
 * review, so nothing in a build ever runs this.
 *
 * With names, only those prompts run -- which is how a rejected source is
 * retried without paying for the eight that were kept. A kept prompt
 * (`KEPT_PROMPTS`) runs only by name.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IMAGE_PROMPTS, KEPT_PROMPTS, readApiKey, requestBody, type ImagePrompt } from "./image-prompts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SOURCE = resolve(import.meta.dirname, "..", "assets", "source");

/** How many requests are in flight at once; enough to be quick, few enough to stay polite. */
const CONCURRENCY = 3;

/** The edit request: the same fields, as a form carrying the reference image. */
function editForm(prompt: ImagePrompt, reference: string): FormData {
  const form = new FormData();
  for (const [field, value] of Object.entries(requestBody(prompt))) form.append(field, String(value));
  form.append("image", new Blob([readFileSync(resolve(SOURCE, reference))], { type: "image/png" }), reference);
  return form;
}

async function generate(prompt: ImagePrompt, key: string): Promise<void> {
  const response =
    prompt.reference === undefined
      ? await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody(prompt)),
        })
      : await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: editForm(prompt, prompt.reference),
        });
  if (!response.ok) throw new Error(`${prompt.name}: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { data: { b64_json?: string }[] };
  const image = body.data[0]?.b64_json;
  if (image === undefined) throw new Error(`${prompt.name}: the response carried no image`);
  writeFileSync(resolve(SOURCE, prompt.file), Buffer.from(image, "base64"));
  process.stdout.write(`  ${prompt.file}\n`);
}

async function main(): Promise<void> {
  const envPath = resolve(ROOT, ".env.local");
  const key = readApiKey(process.env, existsSync(envPath) ? readFileSync(envPath, "utf8") : undefined);
  if (key === undefined) throw new Error("OPENAI_API_KEY is not set (environment or .env.local)");

  const wanted = new Set(process.argv.slice(2));
  // A kept prompt runs only when it is named: an unnamed run must never redraw a kept sheet.
  const named = [...IMAGE_PROMPTS, ...KEPT_PROMPTS];
  const queue = wanted.size === 0 ? [...IMAGE_PROMPTS] : named.filter((prompt) => wanted.has(prompt.name));
  const unknown = [...wanted].filter((name) => !named.some((prompt) => prompt.name === name));
  if (unknown.length > 0) throw new Error(`no prompt named ${unknown.join(", ")}`);

  process.stdout.write("generating sources:\n");
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await generate(next, key);
  });
  await Promise.all(workers);
  process.stdout.write("done\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
