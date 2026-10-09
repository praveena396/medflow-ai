// Load test for the non-AI API routes with autocannon.
//
// Usage (from server/, with the API already running):
//   RATE_LIMIT_MAX=100000000 npm start          # in another terminal
//   npm run bench:api
//
// Env: BENCH_URL (default http://localhost:5000), BENCH_CONNECTIONS (50),
//      BENCH_DURATION seconds per route (20), BENCH_WARMUP seconds (3).
//
// Reports requests/second and p50/p95/p99 latency per route, and writes the
// full result to benchmarks/results/. Start the server with RATE_LIMIT_MAX
// raised, or the per-IP rate limiter turns most requests into 429s (the
// script flags that and exits non-zero).
import autocannon from 'autocannon';
import { summarize } from './lib/stats.js';
import { writeResult, intFromEnv } from './lib/results.js';

const BASE_URL = (process.env.BENCH_URL || 'http://localhost:5000').replace(/\/$/, '');
const CONNECTIONS = intFromEnv('BENCH_CONNECTIONS', 50);
const DURATION = intFromEnv('BENCH_DURATION', 20);
const WARMUP = intFromEnv('BENCH_WARMUP', 3);

// Read-only, non-AI routes. /health is left out because it pings the LLM.
const ROUTES = [
  { name: 'GET /api', path: '/api', auth: false },
  { name: 'GET /api/appointments/doctors', path: '/api/appointments/doctors', auth: true },
  { name: 'GET /api/appointments', path: '/api/appointments', auth: true },
];

const getToken = async () => {
  const email = `bench-${Date.now()}@medflow.test`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Benchmark User', email, password: 'Benchmark@123' }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) {
    throw new Error(`Could not register the benchmark user (${res.status}): ${body.message || ''}`);
  }
  return body.token;
};

const run = (options, onResponse) =>
  new Promise((resolve, reject) => {
    const instance = autocannon(options, (error, result) => (error ? reject(error) : resolve(result)));
    if (onResponse) instance.on('response', onResponse);
  });

const benchmarkRoute = async (route, token) => {
  const options = {
    url: `${BASE_URL}${route.path}`,
    connections: CONNECTIONS,
    headers: route.auth ? { Authorization: `Bearer ${token}` } : {},
  };

  if (WARMUP > 0) await run({ ...options, duration: WARMUP });

  const latencies = [];
  const statusCodes = {};
  const result = await run({ ...options, duration: DURATION }, (_client, statusCode, _bytes, responseTime) => {
    latencies.push(responseTime);
    statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
  });

  const responses = latencies.length;
  const ok = Object.entries(statusCodes)
    .filter(([code]) => code.startsWith('2'))
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    route: route.name,
    connections: CONNECTIONS,
    durationSeconds: DURATION,
    requestsPerSecond: Math.round((result.requests.average + Number.EPSILON) * 100) / 100,
    responses,
    statusCodes,
    non2xx: responses - ok,
    errors: result.errors,
    timeouts: result.timeouts,
    latencyMs: summarize(latencies),
  };
};

const main = async () => {
  console.log(`Benchmarking ${BASE_URL}: ${CONNECTIONS} connections, ${DURATION}s per route\n`);
  const token = await getToken();

  const routes = [];
  for (const route of ROUTES) {
    process.stdout.write(`  ${route.name} ... `);
    const summary = await benchmarkRoute(route, token);
    routes.push(summary);
    console.log('done');
  }

  console.log('');
  console.table(
    routes.map((r) => ({
      route: r.route,
      'req/s': r.requestsPerSecond,
      'p50 ms': r.latencyMs.p50,
      'p95 ms': r.latencyMs.p95,
      'p99 ms': r.latencyMs.p99,
      non2xx: r.non2xx,
      errors: r.errors + r.timeouts,
    }))
  );

  const file = writeResult('api-load', {
    baseUrl: BASE_URL,
    connections: CONNECTIONS,
    durationSeconds: DURATION,
    warmupSeconds: WARMUP,
    routes,
  });
  console.log(`Saved ${file}`);

  const rateLimited = routes.some((r) => r.statusCodes[429]);
  if (rateLimited) {
    console.error('\nSome requests got 429 Too Many Requests: start the server with RATE_LIMIT_MAX raised.');
  }
  const failed = routes.some((r) => r.non2xx > 0 || r.errors > 0 || r.timeouts > 0);
  if (failed) {
    console.error('Some requests failed, so these numbers do not describe a healthy run.');
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
