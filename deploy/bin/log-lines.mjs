// The server's log lines, counted. Shared by the weekly report (report.mjs, on a box or over
// Fly's buffer) and the watch Worker (tools/ci/watch-worker), so the two never disagree.
// Plain JavaScript with no imports: report.mjs runs where only Node is installed. No line
// holds an address, a name or a room code, and nothing here would keep one.

/** Empty counts. `ticks` holds the last minute's tick line the server wrote, if any. */
export const emptyCounts = () => ({
  restarts: 0,
  crashLoopStops: 0,
  fatalByClass: {},
  clientFatalByClass: {},
  rejectionsByClass: {},
  socketsOpened: 0,
  socketsGaveUp: 0,
  slowTicks: 0,
  buildSkew: 0,
  refusedByLimit: {},
  peakRooms: 0,
  peakSockets: 0,
  peakRssMb: 0,
  peakLoopP99Ms: 0,
  ticks: [],
});

const bump = (table, key, by = 1) => {
  table[key] = (table[key] ?? 0) + by;
};

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** Adds one log line to `counts`. Anything it does not know is ignored. */
export const countLine = (counts, raw) => {
  const line = raw.trim();
  if (/^Started floor-fifty@\w+\.service/.test(line)) counts.restarts += 1;
  if (/floor-fifty@\w+\.service: Failed with result 'start-limit-hit'/.test(line)) counts.crashLoopStops += 1;
  if (/^\[ff:room \d+\] slow tick /.test(line)) counts.slowTicks += 1;
  if (/^\[ff:room \d+\] build-skew /.test(line)) counts.buildSkew += 1;
  if (!line.startsWith("{")) return;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record === null || typeof record !== "object") return;
  switch (record.event) {
    case "fatal":
      // The server's own crash line carries the rollback signal. A browser's report
      // is marked `src: "client"` by the endpoint and counted apart, because anyone
      // can post one (audit S26).
      bump(record.src === "client" ? counts.clientFatalByClass : counts.fatalByClass, String(record.class));
      break;
    case "rejection":
      bump(counts.rejectionsByClass, String(record.class));
      break;
    case "socket":
      if (record.state === "open") counts.socketsOpened += 1;
      if (record.state === "gave-up") counts.socketsGaveUp += 1;
      break;
    case "refused":
      // A flood is written as one line carrying its count (`n`).
      bump(counts.refusedByLimit, String(record.limit), Number.isInteger(record.n) && record.n > 0 ? record.n : 1);
      break;
    case "vitals":
      // The process's vital signs, once a minute (audit S25): the peaks.
      if (finite(record.sockets)) counts.peakSockets = Math.max(counts.peakSockets, record.sockets);
      if (finite(record.rssMb)) counts.peakRssMb = Math.max(counts.peakRssMb, record.rssMb);
      if (finite(record.loopP99Ms)) counts.peakLoopP99Ms = Math.max(counts.peakLoopP99Ms, record.loopP99Ms);
      break;
    case "rooms":
      if (typeof record.live === "number") counts.peakRooms = Math.max(counts.peakRooms, record.live);
      break;
    case "ticks":
      // A browser can't forge this one: the telemetry endpoint marks posted lines `src: "client"`.
      if (record.src === undefined && Number.isInteger(record.n) && ["p50", "p90", "p99", "max"].every((k) => finite(record[k])))
        counts.ticks.push({ n: record.n, p50: record.p50, p90: record.p90, p99: record.p99, max: record.max });
      break;
    default:
  }
};
