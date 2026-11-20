import { describe, expect, it } from "vitest";
import { rawLiterals } from "./raw-literals";

const svelte = (template: string, script = ""): string => `<script lang="ts">${script}</script>\n${template}`;

describe("rawLiterals (languages spec §8.1)", () => {
  it("flags a text node with a letter in any script", () => {
    expect(rawLiterals("A.svelte", svelte("<p>Play</p>"))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte("<p>遊ぶ</p>"))).toHaveLength(1);
  });

  it("allows whitespace, digits, punctuation and glyphs", () => {
    expect(rawLiterals("A.svelte", svelte("<p> 12 · / ← → ✓ — × </p>"))).toEqual([]);
  });

  it("flags the five text attributes on elements, and only those", () => {
    expect(rawLiterals("A.svelte", svelte('<button aria-label="Close" title="Close"></button>'))).toHaveLength(2);
    expect(rawLiterals("A.svelte", svelte('<input placeholder="Your name" /><img alt="Logo" src="x.png" />'))).toHaveLength(2);
    expect(rawLiterals("A.svelte", svelte('<div class="ff-aq-control" data-testid="title-play" role="tab"></div>'))).toEqual([]);
  });

  it("flags strings an expression in the template can show", () => {
    expect(rawLiterals("A.svelte", svelte("<p>{muted ? 'Unmute' : 'Mute'}</p>"))).toHaveLength(2);
    expect(rawLiterals("A.svelte", svelte("<p>{name ?? 'Random'}</p>"))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte("<p>{`${n} BPM`}</p>"))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte('<button aria-label={open ? "Close" : "Open"}></button>'))).toHaveLength(2);
  });

  it("does not flag keys, arguments and ids inside expressions", () => {
    expect(rawLiterals("A.svelte", svelte("<p>{glyphs['move']}</p><p>{m.title_play()}</p><p>{fn('fastFall')}</p>"))).toEqual([]);
  });

  it("flags display text passed to a component, and not an id", () => {
    expect(rawLiterals("A.svelte", svelte('<Modal title="Settings" testId="settings-modal" mode="swipe" />'))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte('<StepFrame heading="Pick a stage" kind="stage" />'))).toHaveLength(1);
  });

  it("flags label tables built in the template, and a component's display name", () => {
    expect(rawLiterals("A.svelte", svelte('<Tags tags={[{ text: "You", testId: "seat-you" }]} />'))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte("{@const chips = [{ label: 'Host' }]}<p></p>"))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte('<NamePill name={player?.name ?? "Open"} />'))).toHaveLength(1);
    expect(rawLiterals("A.svelte", svelte('<Field name="room-code" />'))).toEqual([]);
  });

  it("flags label tables in the script", () => {
    const script = 'const QUALITIES = [{ value: "high", label: "High" }];';
    expect(rawLiterals("A.svelte", svelte("<p></p>", script))).toHaveLength(1);
  });

  it("allows a CSS value passed to a component, and still flags words", () => {
    expect(rawLiterals("A.svelte", svelte('<Split ratio="3fr 2fr" rowGap="var(--ff-seat-gap)" width="12rem" />'))).toEqual([]);
    expect(rawLiterals("A.svelte", svelte('<Split label="Seats" />'))).toHaveLength(1);
  });

  it("allows a keycap: one capital Latin letter names a physical key", () => {
    expect(rawLiterals("A.svelte", svelte('<kbd class="ff-keycap">A</kbd><kbd>R</kbd>'))).toEqual([]);
    expect(rawLiterals("A.svelte", svelte("<p>Go</p>"))).toHaveLength(1);
  });

  it("allows the allowlist", () => {
    expect(rawLiterals("A.svelte", svelte("<h1>Floor Fifty</h1><span>Floor</span><span>Fifty</span><small>SNEKPRTY</small>"))).toEqual([]);
  });
});
