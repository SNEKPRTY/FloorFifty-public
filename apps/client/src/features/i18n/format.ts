/** Numbers in the reader's own convention (languages spec §4.1); the race clock's m:ss is not one of them. */

import { activeLocale } from "./strategy";

export const formatPercent = (value: number): string =>
  new Intl.NumberFormat(activeLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);

export const formatCount = (value: number): string => new Intl.NumberFormat(activeLocale()).format(value);
