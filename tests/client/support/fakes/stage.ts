import type { Container, Filter } from "pixi.js";
import { pooledCapacity } from "../../../../apps/client/src/features/render/backdrop-target";
import { createPaletteLockFilter } from "../../../../apps/client/src/features/render/filters/palette-lock";
import type {
  BackdropLease,
  StagePort,
  ViewportInfo,
  ViewRect,
} from "../../../../apps/client/src/features/render/stage-port";
import type { BandMode } from "../../../../apps/client/src/features/platform/band";

/** A container stand-in that records whether it was destroyed. */
export class FakeContainer {
  readonly children: FakeContainer[] = [];
  parent: FakeContainer | null = null;
  destroyed = false;
  label = "";

  /** Like Pixi's, takes any number of children in order and returns the first. */
  addChild(...children: FakeContainer[]): FakeContainer {
    for (const child of children) {
      child.parent?.removeChild(child);
      this.children.push(child);
      child.parent = this;
    }
    return children[0]!;
  }

  addChildAt(child: FakeContainer, index: number): FakeContainer {
    child.parent?.removeChild(child);
    this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  removeChild(child: FakeContainer): FakeContainer {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
    return child;
  }

  destroy(): void {
    this.parent?.removeChild(this);
    this.destroyed = true;
    for (const child of [...this.children]) child.destroy();
    this.children.length = 0;
  }
}

export class FakeTicker {
  deltaMS = 16.6667;
  private readonly listeners = new Map<() => void, number>();

  add(listener: () => void, _context?: unknown, priority = 0): void {
    this.listeners.set(listener, priority);
  }

  remove(listener: () => void): void {
    this.listeners.delete(listener);
  }

  priorityOf(listener: () => void): number | undefined {
    return this.listeners.get(listener);
  }

  get priorities(): number[] {
    return [...this.listeners.values()];
  }

  tick(deltaMS = this.deltaMS): void {
    this.deltaMS = deltaMS;
    const sorted = [...this.listeners.entries()].sort((a, b) => b[1] - a[1]);
    for (const [listener] of sorted) listener();
  }

  get size(): number {
    return this.listeners.size;
  }
}


/**
 * A backdrop lease with no GPU behind it.
 *
 * Records its own release so a test can assert ownership: a lease destroyed
 * twice is the shape of a double-free, and one never destroyed is scenery left
 * rendering behind the next screen.
 */
export class FakeBackdropLease implements BackdropLease {
  readonly filterRoot: Container;
  readonly logicalRect: ViewRect;
  readonly targetSize: { width: number; height: number };
  readonly pooledCapacity: number;
  /** How many times `destroy` was called. */
  destroys = 0;
  /** Stands in for the target's output sprite, which the stage parents. */
  readonly output = new FakeContainer();

  constructor(source: Container, logicalRect: ViewRect) {
    this.output.label = "backdrop-output";
    this.filterRoot = source;
    this.logicalRect = logicalRect;
    this.targetSize = { width: logicalRect.width, height: logicalRect.height };
    // The real formula, not a stand-in: a fake that reserved its area would
    // quietly disagree with the cap the class under test exists to enforce.
    this.pooledCapacity = pooledCapacity(this.targetSize.width, this.targetSize.height);
  }

  destroy(): void {
    this.destroys += 1;
    this.output.parent?.removeChild(this.output);
  }
}

export type FakeStage = StagePort & {
  /** Fires the viewport listeners, as a real resize would. */
  emitViewport(next: ViewportInfo): void;
  /** Every lease this stage has handed out, in order. */
  readonly leases: FakeBackdropLease[];
  /** Every palette lock this stage has built, in order. */
  readonly paletteLocks: Filter[];
  /** Every band mode a screen asked for, in order. */
  readonly bandModes: BandMode[];
};

export function fakeStage(options: { ticker?: FakeTicker } = {}): FakeStage {
  const overlay = document.createElement("div");
  document.body.appendChild(overlay);

  const viewportListeners = new Set<(value: ViewportInfo) => void>();
  const leases: FakeBackdropLease[] = [];
  const paletteLocks: Filter[] = [];
  const bandModes: BandMode[] = [];
  let viewport: ViewportInfo = {
    canvasCss: { x: 0, y: 0, width: 960, height: 540 },
    gameplayCss: { x: 0, y: 27, width: 960, height: 486 },
    sceneryLogical: { x: 0, y: 0, width: 960, height: 540 },
    portrait: false,
    formFactor: "desktop",
    fieldLogical: { width: 960, height: 540 },
    pixelRatio: 1,
  };

  const stage: FakeStage = {
    scene: new FakeContainer() as never,
    cellSize: 1,
    pixelRatio: 1,
    field: new FakeContainer() as never,
    backdrop: new FakeContainer() as never,
    world: new FakeContainer() as never,
    ui: new FakeContainer() as never,
    effects: new FakeContainer() as never,
    front: new FakeContainer() as never,
    overlay,
    screenWidth: 960,
    screenHeight: 540,
    get viewport() {
      return viewport;
    },
    onViewportChange(listener) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
    mountBackdrop(source) {
      const lease = new FakeBackdropLease(source as never, viewport.sceneryLogical);
      // Parented as `app.ts` parents the real output, so a test can ask what
      // is drawn above it.
      (stage.backdrop as unknown as FakeContainer).addChild(lease.output);
      leases.push(lease);
      return lease;
    },
    createPaletteLock() {
      const lock = createPaletteLockFilter();
      paletteLocks.push(lock);
      return lock;
    },
    paletteLocks,
    bandModes,
    setBandMode(mode) {
      bandModes.push(mode);
    },
    emitViewport(next) {
      viewport = next;
      for (const listener of viewportListeners) listener(next);
    },
    leases,
  };

  // Assigned rather than spread: spreading would invoke the `viewport` getter
  // and freeze the first value into the copy.
  if (options.ticker !== undefined) {
    Object.assign(stage, { app: { ticker: options.ticker as never } });
  }

  return stage;
}
