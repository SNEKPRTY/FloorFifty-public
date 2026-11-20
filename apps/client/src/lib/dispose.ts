/**
 * Disposal.
 *
 * A screen that leaks a DOM listener or a Pixi display object does not fail
 * loudly; it fails as a second copy of the HUD, or as input arriving at a
 * screen that is no longer visible. Collecting teardown next to setup, and
 * running it exactly once, is what stops that.
 */

export type Disposer = () => void;

export interface Destroyable {
  destroy(options?: { children?: boolean }): void;
}

export class DisposeBag {
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Registers arbitrary teardown. */
  add(disposer: Disposer): void {
    if (this.disposed) {
      // Registering after teardown would silently never run; run it now so the
      // resource is still released.
      disposer();
      return;
    }
    this.disposers.push(disposer);
  }

  /** Registers a Pixi display object, destroyed with its children. */
  addDisplay(display: Destroyable): void {
    this.add(() => display.destroy({ children: true }));
  }

  /** Adds a DOM listener and registers its removal. */
  addListener<K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K | string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type as string, listener, options);
    this.add(() => target.removeEventListener(type as string, listener, options));
  }

  /**
   * Runs every disposer, most recent first, exactly once.
   *
   * Reverse order matters: teardown that depends on something set up earlier
   * has to run before that thing goes away.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
      this.disposers[index]?.();
    }
    this.disposers.length = 0;
  }
}
