export type TickMinute = { n: number; p50: number; p90: number; p99: number; max: number };
export type LogCounts = {
  restarts: number;
  crashLoopStops: number;
  fatalByClass: Record<string, number>;
  clientFatalByClass: Record<string, number>;
  rejectionsByClass: Record<string, number>;
  socketsOpened: number;
  socketsGaveUp: number;
  slowTicks: number;
  buildSkew: number;
  refusedByLimit: Record<string, number>;
  peakRooms: number;
  ticks: TickMinute[];
};
export function emptyCounts(): LogCounts;
export function countLine(counts: LogCounts, line: string): void;
