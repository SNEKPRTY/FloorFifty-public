import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAYERS, OUTSIDE, featureOf, featureOfRel, importEdges, isUpward, sources } from "./architecture-graph";

export { LAYERS, featureOf };

describe("the client's layers", () => {
  const edges = importEdges();

  it("puts every source file in a feature", () => {
    const stray = sources.filter((f) => !OUTSIDE.has(f) && !featureOf(f));
    expect(stray).toEqual([]);
  });

  it("imports go down the layer list", () => {
    expect(edges.filter(isUpward)).toEqual([]);
  });

  it("has no import cycle between features", () => {
    const graph = new Map<string, Set<string>>(LAYERS.map((l) => [l, new Set()]));
    for (const e of edges) {
      const [a, b] = e.split(" -> ") as [string, string];
      const fa = featureOfRel(a);
      const fb = featureOfRel(b);
      if (fa && fb && fa !== fb) graph.get(fa)!.add(fb);
    }
    // Tarjan's strongly connected components: a component of more than one feature is a cycle.
    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const visit = (v: string): void => {
      index.set(v, counter);
      low.set(v, counter++);
      stack.push(v);
      onStack.add(v);
      for (const w of graph.get(v) ?? []) {
        if (!index.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
      if (low.get(v) === index.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        if (component.length > 1) cycles.push(component.sort());
      }
    };
    for (const l of LAYERS) if (!index.has(l)) visit(l);
    expect(cycles).toEqual([]);
  });
});

describe("paths to client source", () => {
  it("names no client path that does not exist", () => {
    const files = execFileSync("git", ["ls-files", "-z", "tests", "tools", "deploy", "apps/client", "packages"], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\0")
      .filter((f) => /\.(ts|svelte|css|html|json|md|mjs)$/.test(f) && !f.startsWith("tests/deploy/ci/") && !f.endsWith("architecture.test.ts") && existsSync(f) && statSync(f).size < 2_000_000);
    const missing: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        // A test that asserts a file is gone names a path that must not exist.
        if (line.includes(").toBe(false)")) continue;
        for (const m of line.matchAll(/apps\/client\/src\/[\w/.-]+\.(?:ts|svelte|css|json)\b/g)) {
          // A runes module is imported as `x.svelte` and lives in `x.svelte.ts`.
          if (!existsSync(m[0]) && !existsSync(`${m[0]}.ts`)) missing.push(`${f}: ${m[0]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
