/**
 * jsdom has no ResizeObserver and no layout. The layout primitives measure
 * with `observeWidth`, so their tests install this and drive it by hand.
 */
type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

export function installFakeResizeObserver(): { resize(width: number, height?: number): void; restore(): void } {
  const previous = globalThis.ResizeObserver;
  const observers = new Set<{ callback: Callback; targets: Element[] }>();

  class FakeResizeObserver {
    private readonly entry: { callback: Callback; targets: Element[] };
    constructor(callback: Callback) {
      this.entry = { callback, targets: [] };
      observers.add(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      observers.delete(this.entry);
    }
  }

  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  return {
    resize(width: number, height = 0) {
      for (const { callback, targets } of [...observers]) {
        const entries = targets.map((target) => ({ target, contentRect: { width, height } }) as unknown as ResizeObserverEntry);
        callback(entries, {} as ResizeObserver);
      }
    },
    restore() {
      globalThis.ResizeObserver = previous;
    },
  };
}
