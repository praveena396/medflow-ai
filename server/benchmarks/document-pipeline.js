// Times the document worker's stages on a generated multi-page PDF:
// text extraction (pdf-parse), chunking, and embedding every chunk.
//
// Usage (from server/):
//   npm run bench:pipeline                 # embeds with the configured LLM (Ollama by default)
//   npm run bench:pipeline -- --no-embed   # extraction + chunking only, no LLM needed
//
// Env: BENCH_PAGES (default 20), BENCH_RUNS (default 5; embedding runs once).
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

const PAGES = intFromEnv('BENCH_PAGES', 20);
const RUNS = intFromEnv('BENCH_RUNS', 5);
const SKIP_EMBED = process.argv.includes('--no-embed');

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
  }

  console.log(`Saved ${writeResult('document-pipeline', result)}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
