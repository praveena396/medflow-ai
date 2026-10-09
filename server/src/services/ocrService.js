import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { logger } from '../utils/logger.js';

// OCR for uploaded images (lab results, prescriptions) with tesseract.js.
// The English model ships in the @tesseract.js-data/eng npm package, so the
// worker never downloads language data at runtime.
const require = createRequire(import.meta.url);
const LANG_PATH = path.join(
  path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int'
);

let workerPromise = null;

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        langPath: LANG_PATH,
        cachePath: path.join(os.tmpdir(), 'medflow-tesseract'),
        gzip: true,
      });
      logger.info('🔤 OCR worker ready');
      return worker;
    })().catch((error) => {
      workerPromise = null; // allow a retry on the next call
      throw error;
    });
  }
  return workerPromise;
};

// Returns { text, confidence } where confidence is tesseract's 0-100 mean.
export const recognizeImage = async (buffer) => {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  return { text: data.text || '', confidence: data.confidence };
};

// Free the WASM worker (tests, graceful shutdown).
export const shutdownOcr = async () => {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
};
