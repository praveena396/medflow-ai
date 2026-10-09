// Times the document worker's stages on a generated multi-page PDF:
// text extraction (pdf-parse), chunking, and embedding every chunk. It also
// times OCR (tesseract.js) on a generated image of one lab-report page.
//
// Usage (from server/):
//   npm run bench:pipeline                 # embeds with the configured LLM (Ollama by default)
//   npm run bench:pipeline -- --no-embed   # extraction + chunking only, no LLM needed
//   npm run bench:pipeline -- --no-ocr     # skip the OCR timing
//
// Env: BENCH_PAGES (default 20), BENCH_RUNS (default 5; embedding runs once),
// BENCH_OCR_RUNS (default 3).
//
// The PDF is generated in memory (benchmarks/lib/samplePdf.js), so no binary
// fixture is committed. Not timed here: storage reads/writes, the MongoDB
// inserts and the LLM summary the worker also makes.
import { performance } from 'perf_hooks';
import { buildSamplePdf } from './lib/samplePdf.js';
import { summarize } from './lib/stats.js';
import { writeResult, intFromEnv } from './lib/results.js';
import { extractText } from '../src/utils/pdfExtractor.js';
import { chunkText } from '../src/utils/textChunker.js';
import { embeddingsService } from '../src/services/embeddingsService.js';
import { llmClient } from '../src/ai/llmClient.js';
import { config } from '../src/config/index.js';
import { recognizeImage, shutdownOcr } from '../src/services/ocrService.js';
import { renderTextPng } from './lib/textImage.js';

const PAGES = intFromEnv('BENCH_PAGES', 20);
const RUNS = intFromEnv('BENCH_RUNS', 5);
const OCR_RUNS = intFromEnv('BENCH_OCR_RUNS', 3);
const SKIP_EMBED = process.argv.includes('--no-embed');
const SKIP_OCR = process.argv.includes('--no-ocr');

// One page of a lab report, rendered as an image, for the OCR timing.
const OCR_PAGE_LINES = [
  'CITY LAB REPORT',
  'PATIENT: JANE DOE',
  'TOTAL CHOLESTEROL 242 MG/DL HIGH',
  'LDL 162 MG/DL HIGH',
  'HDL 38 MG/DL LOW',
  'HEMOGLOBIN 13.8 G/DL',
  'GLUCOSE 98 MG/DL',
  'RX: ATORVASTATIN 20 MG DAILY',
];

const time = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
};

const main = async () => {
  const pdf = buildSamplePdf({ pages: PAGES });
  console.log(`Sample PDF: ${PAGES} pages, ${(pdf.length / 1024).toFixed(1)} KB; ${RUNS} runs\n`);

  const extractMs = [];
  const chunkMs = [];
  let text = '';
  let chunks = [];
  for (let run = 0; run < RUNS; run++) {
    const extracted = await time(() => extractText(pdf, 'application/pdf'));
    if (!extracted.value.success) throw new Error(`Extraction failed: ${extracted.value.error}`);
    extractMs.push(extracted.ms);
    text = extracted.value.text;

    const chunked = await time(() => chunkText(text));
    chunkMs.push(chunked.ms);
    chunks = chunked.value;
  }

  const result = {
    pages: PAGES,
    pdfBytes: pdf.length,
    words: text.split(/\s+/).filter(Boolean).length,
    chunks: chunks.length,
    chunkSizeWords: config.documents.chunkSizeWords,
    chunkOverlapWords: config.documents.chunkOverlapWords,
    runs: RUNS,
    extractMs: summarize(extractMs),
    chunkMs: summarize(chunkMs),
    embedding: null,
  };

  if (SKIP_EMBED) {
    result.embedding = { skipped: '--no-embed' };
  } else if (!(await llmClient.isAvailable())) {
    result.embedding = { skipped: `LLM provider "${config.llm.provider}" is not reachable` };
  } else {
    const perChunkMs = [];
    const total = await time(async () => {
      for (const chunk of chunks) {
        const embedded = await time(() => embeddingsService.embedText(chunk));
        if (!embedded.value.success) throw new Error(`Embedding failed: ${embedded.value.error}`);
        perChunkMs.push(embedded.ms);
      }
    });
    result.embedding = {
      provider: config.llm.provider,
      model: config.llm.embeddingModel,
      totalMs: Math.round(total.ms),
      perChunkMs: summarize(perChunkMs),
    };
  }

  if (SKIP_OCR) {
    result.ocr = { skipped: '--no-ocr' };
  } else {
    const image = renderTextPng(OCR_PAGE_LINES);
    const ocrMs = [];
    let confidence = 0;
    // The first call loads the model; time it separately from the steady state.
    const warm = await time(() => recognizeImage(image));
    for (let run = 0; run < OCR_RUNS; run++) {
      const recognised = await time(() => recognizeImage(image));
      ocrMs.push(recognised.ms);
      confidence = recognised.value.confidence;
    }
    await shutdownOcr();
    result.ocr = {
      engine: 'tesseract.js (eng)',
      imageBytes: image.length,
      runs: OCR_RUNS,
      firstCallMs: Math.round(warm.ms),
      perPageMs: summarize(ocrMs),
      confidence,
    };
  }

  // A text PDF through the timed stages, end to end (median extraction and
  // chunking plus the single embedding pass).
  if (result.embedding.totalMs !== undefined) {
    const totalMs = result.extractMs.p50 + result.chunkMs.p50 + result.embedding.totalMs;
    result.textPdfTotalMs = Math.round(totalMs);
    result.textPdfPerPageMs = Math.round((totalMs / PAGES) * 10) / 10;
  }

  console.table({
    'extract (pdf-parse)': { 'median ms': result.extractMs.p50, 'p95 ms': result.extractMs.p95 },
    chunk: { 'median ms': result.chunkMs.p50, 'p95 ms': result.chunkMs.p95 },
  });
  console.log(`${result.words} words -> ${result.chunks} chunks`);
  if (result.embedding.skipped) {
    console.log(`Embedding skipped: ${result.embedding.skipped}`);
  } else {
    console.log(
      `Embedding all ${result.chunks} chunks with ${result.embedding.model}: ${result.embedding.totalMs} ms ` +
        `(median ${result.embedding.perChunkMs.p50} ms per chunk)`
    );
    console.log(
      `Text PDF, ${PAGES} pages, extract + chunk + embed: ${result.textPdfTotalMs} ms ` +
        `(${result.textPdfPerPageMs} ms per page)`
    );
  }
  if (result.ocr.skipped) {
    console.log(`OCR skipped: ${result.ocr.skipped}`);
  } else {
    console.log(
      `OCR of one image page: median ${result.ocr.perPageMs.p50} ms, p95 ${result.ocr.perPageMs.p95} ms ` +
        `(first call, including model load: ${result.ocr.firstCallMs} ms; confidence ${result.ocr.confidence}%)`
    );
  }

  console.log(`Saved ${writeResult('document-pipeline', result)}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
