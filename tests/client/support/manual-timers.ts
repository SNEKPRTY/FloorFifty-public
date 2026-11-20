import type { Timers } from "../../../apps/client/src/lib/load-meter";

/**
 * A clock the test turns by hand. `advance` runs every timer that falls due,
 * in order, letting promises settle between them, so a stall rule can be
 * driven across thirty seconds without waiting for any.
 */
export class ManualTimers implements Timers {
  time = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  /** Timers still waiting. A finished wait must leave none behind. */
  get waiting(): number {
    return this.tasks.size;
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      let nextId: number | undefined;
      for (const [id, task] of this.tasks) {
        if (task.at <= end && (nextId === undefined || task.at < this.tasks.get(nextId)!.at)) nextId = id;
      }
      if (nextId === undefined) break;
      const task = this.tasks.get(nextId)!;
      this.tasks.delete(nextId);
      this.time = Math.max(this.time, task.at);
      task.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.time = end;
    await Promise.resolve();
    await Promise.resolve();
  }
}
