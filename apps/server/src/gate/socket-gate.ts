/**
 * Open WebSockets, per address and overall (release readiness §6.1).
 *
 * Sixteen per address covers four players behind one router with their
 * reconnects; the total is four per room the server may hold, plus headroom
 * for joins in flight. An address with no open socket is forgotten.
 */

export type SocketGate = {
  /** Counts one more socket from `ip`, or refuses it. */
  admit(ip: string): boolean;
  /** Counts one socket from `ip` closed. */
  release(ip: string): void;
  readonly open: number;
  readonly addresses: number;
};

export function createSocketGate(limits: { maxPerIp: number; maxTotal: number }): SocketGate {
  const perIp = new Map<string, number>();
  let open = 0;
  return {
    admit(ip) {
      const mine = perIp.get(ip) ?? 0;
      if (mine >= limits.maxPerIp || open >= limits.maxTotal) return false;
      perIp.set(ip, mine + 1);
      open += 1;
      return true;
    },
    release(ip) {
      const mine = perIp.get(ip);
      if (mine === undefined) return;
      if (mine <= 1) perIp.delete(ip);
      else perIp.set(ip, mine - 1);
      open -= 1;
    },
    get open() {
      return open;
    },
    get addresses() {
      return perIp.size;
    },
  };
}
