import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');

// Facts about the machine a result came from; numbers are meaningless without them.
export const environment = () => ({
  node: process.version,
  platform: `${os.type()} ${os.release()} (${os.arch()})`,
  cpu: os.cpus()[0]?.model,
  cpuCount: os.cpus().length,
  memoryGB: Math.round(os.totalmem() / 1024 ** 3),
  ci: Boolean(process.env.CI),
});

// Write a result to benchmarks/results/<name>-<timestamp>.json (git-ignored).
export const writeResult = (name, data) => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESULTS_DIR, `${name}-${stamp}.json`);
  const payload = { benchmark: name, ranAt: new Date().toISOString(), environment: environment(), ...data };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
};

export const intFromEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
