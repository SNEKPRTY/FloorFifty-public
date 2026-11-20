/**
 * Live timers and `window`/`document` listeners, for the leak counters
 * (release readiness §9.3): a restart or a screen change must hand both back
 * to where they started, as display objects and audio sources already must.
 *
 * Inspection builds only. It wraps the timer functions and the two targets'
 * listener methods, counts what is live, and puts every one back on release;
 * a production build wraps nothing.
 */

import { VISUAL_INSPECTION_ENABLED } from "./inspection";

export type LiveHandles = {
  timers(): number;
  listeners(): number;
  release(): void;
};

type Patched = { target: object; key: string; hadOwn: boolean; original: unknown };

const captureOf = (options: boolean | AddEventListenerOptions | EventListenerOptions | undefined): boolean =>
  typeof options === "boolean" ? options : options?.capture === true;

export function trackLiveHandles(win: Window, enabled: boolean = VISUAL_INSPECTION_ENABLED): LiveHandles {
  if (!enabled) return { timers: () => 0, listeners: () => 0, release: () => undefined };

  const patched: Patched[] = [];
  const patch = <T>(target: object, key: string, replacement: (original: T) => T): void => {
    const original = (target as Record<string, unknown>)[key] as T;
    patched.push({ target, key, hadOwn: Object.prototype.hasOwnProperty.call(target, key), original });
    (target as Record<string, unknown>)[key] = replacement(original);
  };

  // Timers: an id is live from its creation until it fires (a timeout) or is cleared.
  const live = new Set<number>();
  patch<typeof win.setTimeout>(win, "setTimeout", (original) => ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
    const id: number = original.call(
      win,
      (...args: unknown[]) => {
        live.delete(id);
        if (typeof handler === "function") (handler as (...a: unknown[]) => void)(...args);
      },
      ms,
      ...rest,
    );
    live.add(id);
    return id;
  }) as typeof win.setTimeout);
  patch<typeof win.setInterval>(win, "setInterval", (original) => ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
    const id: number = original.call(win, handler, ms, ...rest);
    live.add(id);
    return id;
  }) as typeof win.setInterval);
  for (const key of ["clearTimeout", "clearInterval"] as const) {
    patch<(id?: number) => void>(win, key, (original) => (id?: number) => {
      if (id !== undefined) live.delete(id);
      original.call(win, id);
    });
  }

  // Listeners: one per target, type, function and phase, as the DOM itself counts them.
  const registered = new Map<object, Map<string, Set<unknown>>>();
  let listeners = 0;
  for (const target of [win, win.document] as EventTarget[]) {
    const byKey = new Map<string, Set<unknown>>();
    registered.set(target, byKey);
    patch<EventTarget["addEventListener"]>(target, "addEventListener", (original) => (type, listener, options) => {
      if (listener !== null) {
        const key = `${type}|${String(captureOf(options))}`;
        const set = byKey.get(key) ?? new Set();
        if (!set.has(listener)) listeners += 1;
        set.add(listener);
        byKey.set(key, set);
      }
      original.call(target, type, listener, options);
    });
    patch<EventTarget["removeEventListener"]>(target, "removeEventListener", (original) => (type, listener, options) => {
      if (listener !== null && byKey.get(`${type}|${String(captureOf(options))}`)?.delete(listener) === true) {
        listeners -= 1;
      }
      original.call(target, type, listener, options);
    });
  }

  return {
    timers: () => live.size,
    listeners: () => listeners,
    release() {
      for (const { target, key, hadOwn, original } of patched.reverse()) {
        if (hadOwn) (target as Record<string, unknown>)[key] = original;
        else delete (target as Record<string, unknown>)[key];
      }
      patched.length = 0;
    },
  };
}
