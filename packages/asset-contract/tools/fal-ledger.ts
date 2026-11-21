/**
 * The story art's spend ledger (story mode v2 spec, "Cost").
 *
 * Every fal.ai call is written here before its picture is used, and a call
 * that would take the total past the cap is refused before it is sent: the
 * owner gave $10 for this art, and the script keeps $2 of it unspent.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const SPEND_CAP_USD = 8;

export type LedgerRow = {
  /** ISO time from the clock, never typed. */
  readonly at: string;
  readonly model: string;
  /** The panel the call was for, and which candidate. */
  readonly name: string;
  readonly usd: number;
};

export type Ledger = { readonly rows: LedgerRow[] };

/** One JSON row a line, appended, so panels generated side by side never lose each other's rows. */
export function readLedger(path: string): Ledger {
  if (!existsSync(path)) return { rows: [] };
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  return { rows: lines.map((line) => JSON.parse(line) as LedgerRow) };
}

export function spent(ledger: Ledger): number {
  return Math.round(ledger.rows.reduce((total, row) => total + row.usd, 0) * 1000) / 1000;
}

/** Throws, without calling anything, when one more call at `usd` would pass the cap. */
export function assertRoom(ledger: Ledger, usd: number, cap = SPEND_CAP_USD): void {
  if (spent(ledger) + usd > cap + 1e-9) {
    throw new Error(`refused: $${spent(ledger).toFixed(3)} spent, one more call at $${usd} would pass the $${cap} cap`);
  }
}

/** Records a call and saves the ledger at once, so a crash later loses no row. */
export function record(path: string, ledger: Ledger, row: LedgerRow): void {
  ledger.rows.push(row);
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}
