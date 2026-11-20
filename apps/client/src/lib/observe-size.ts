/**
 * A width listener for the layout primitives (UI layout system spec §5).
 *
 * The primitives answer to their own container, never to the viewport. Where
 * a container query can say it in CSS they use one; where the answer depends
 * on a prop (a Split's minimum column, an ActionBar's measured rows) they
 * measure, and this is the one place they do. A no-op where ResizeObserver is
 * missing, so a component mounts under jsdom and simply stays in its
 * unmeasured state.
 */
export function observeWidth(node: Element, listener: (width: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) listener(entry.contentRect.width);
  });
  observer.observe(node);
  return () => observer.disconnect();
}

/** The same for height: how tall the room a dialog or a list has to spend is. */
export function observeHeight(node: Element, listener: (height: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) listener(entry.contentRect.height);
  });
  observer.observe(node);
  return () => observer.disconnect();
}
