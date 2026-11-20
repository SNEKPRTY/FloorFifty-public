/**
 * PagerDots' choice (UI layout system spec §5): dots while they fit on one
 * row, a counter ("3 / 11") once they would not. Dots never wrap (audit m4).
 */
export function pagerMode(count: number, max = 9, available = Infinity, dotSize = 44): "dots" | "counter" {
  if (count > max) return "counter";
  return count * dotSize <= available ? "dots" : "counter";
}
