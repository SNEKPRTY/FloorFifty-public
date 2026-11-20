/**
 * The raw-literal detector behind `no-raw-literals.test.ts` (languages spec
 * §8.1). The repo has no ESLint, so the rule is a parse: every `.svelte` file
 * through `svelte/compiler`, and a walk of what a player could read.
 *
 * A letter in any script is copy. Whitespace, digits, punctuation and glyphs
 * are not. Inside an expression only a string the expression can evaluate to
 * counts (a literal, a template, either side of `?:` or `??`/`||`), never a
 * key, an argument or an ID.
 */

import { parse } from "svelte/compiler";

const LETTER = /\p{L}/u;
const ELEMENT_TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "title", "placeholder", "alt"]);
/** A component prop that carries an ID, not words: lowercase kebab, or a known ID prop. */
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;
/** A CSS value passed to a layout component (`3fr 2fr`, `var(--gap)`, `12rem`): a measure, not words. */
const CSS_VALUE = /^(?:var\(--[\w-]+\)|-?[\d.]+(?:fr|px|rem|em|%|vw|vh)?)(?:\s+(?:var\(--[\w-]+\)|-?[\d.]+(?:fr|px|rem|em|%|vw|vh)?))*$/;
/** `name` is not here: on a component it is usually a display name (NamePill); an input name is kebab and passes as an ID. */
const ID_PROPS = new Set(["class", "testId", "id", "for"]);
const LABEL_PROPERTIES = new Set(["label", "title", "heading", "caption", "text", "message", "hint", "description"]);
/** The wordmark and the studio's name are the brand, in every locale (D-L2). "ABC123" is an example code; "Esc" is a key's own legend. */
export const ALLOWLIST = new Set(["Floor Fifty", "Floor", "Fifty", "SNEKPRTY", "ABC123", "GO", "Esc"]);

type Node = { type: string; [key: string]: unknown };

/** One capital Latin letter is a keycap (A, D, S, R, M): the key's own legend, the same on every layout the game teaches. */
const KEYCAP = /^[A-Z]$/;

const counts = (text: string): boolean => LETTER.test(text) && !ALLOWLIST.has(text.trim()) && !KEYCAP.test(text.trim());

function shownStrings(expression: Node | undefined | null): string[] {
  if (expression === undefined || expression === null) return [];
  switch (expression.type) {
    case "Literal":
      return typeof expression["value"] === "string" ? [expression["value"]] : [];
    case "TemplateLiteral":
      return (expression["quasis"] as { value: { cooked: string } }[]).map((quasi) => quasi.value.cooked);
    case "ConditionalExpression":
      return [...shownStrings(expression["consequent"] as Node), ...shownStrings(expression["alternate"] as Node)];
    case "LogicalExpression":
      return [...shownStrings(expression["left"] as Node), ...shownStrings(expression["right"] as Node)];
    default:
      return [];
  }
}

function attributeStrings(value: unknown): string[] {
  if (value === true) return [];
  const parts = Array.isArray(value) ? (value as Node[]) : [value as Node];
  return parts.flatMap((part) =>
    part.type === "Text"
      ? [part["data"] as string]
      : part.type === "ExpressionTag"
        ? shownStrings(part["expression"] as Node)
        : [],
  );
}

export function rawLiterals(path: string, source: string): string[] {
  const ast = parse(source, { modern: true }) as unknown as { fragment: Node; instance?: { content: Node } | null };
  const offences: string[] = [];
  const offend = (what: string, text: string): void => {
    if (counts(text)) offences.push(`${path}: ${what} ${JSON.stringify(text.trim())}`);
  };

  const visitScript = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visitScript);
    if (typeof node !== "object" || node === null) return;
    const n = node as Node;
    if (n.type === "Property") {
      const key = n["key"] as Node;
      const name = key.type === "Identifier" ? (key["name"] as string) : String(key["value"]);
      if (LABEL_PROPERTIES.has(name)) shownStrings(n["value"] as Node).forEach((text) => offend(`${name}:`, text));
    }
    for (const child of Object.values(n)) if (typeof child === "object") visitScript(child);
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null) return;
    const n = node as Node;
    if (n.type === "Text") offend("text", n["data"] as string);
    if (n.type === "ExpressionTag") shownStrings(n["expression"] as Node).forEach((text) => offend("expression", text));
    if (n.type === "RegularElement" || n.type === "Component" || n.type === "SvelteComponent") {
      const isComponent = n.type !== "RegularElement";
      for (const attribute of (n["attributes"] as Node[] | undefined) ?? []) {
        if (attribute.type !== "Attribute") continue;
        const name = attribute["name"] as string;
        const checked = isComponent
          ? !ID_PROPS.has(name) && !name.startsWith("data-") && !name.startsWith("on")
          : ELEMENT_TEXT_ATTRIBUTES.has(name);
        if (!checked) continue;
        visitScript(attribute["value"]);
        for (const text of attributeStrings(attribute["value"])) {
          if (isComponent && (IDENTIFIER.test(text) || CSS_VALUE.test(text.trim()))) continue;
          offend(`${name}=`, text);
        }
      }
    }
    for (const [key, child] of Object.entries(n)) {
      // Attributes are judged above; expressions through `shownStrings` and their label tables.
      if (key === "attributes") continue;
      if (key === "expression" || key === "declaration") {
        visitScript(child);
        continue;
      }
      if (typeof child === "object") visit(child);
    }
  };
  visit(ast.fragment);

  visitScript(ast.instance?.content);
  return offences;
}
