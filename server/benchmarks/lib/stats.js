// Small, dependency-free latency statistics used by the benchmark scripts.

// Nearest-rank percentile of an ascending-sorted array (p in 0..100).
export const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  if (p <= 0) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
};

const round = (value, digits = 2) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

// Summarise a list of durations in milliseconds.
export const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const mean = count ? sorted.reduce((sum, v) => sum + v, 0) / count : null;
  return {
    count,
    min: round(sorted[0] ?? null),
    mean: round(mean),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[count - 1] ?? null),
  };
};

export const median = (values) => percentile([...values].sort((a, b) => a - b), 50);
