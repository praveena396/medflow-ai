// Retrieval quality on a small labelled set (benchmarks/data/retrieval-eval.json).
// Needs a running embedding model, so run it locally:
//
//   ollama pull nomic-embed-text      # once
//   npm run bench:retrieval            # from server/
//
// (LLM_PROVIDER=openai with OPENAI_API_KEY works too.)
//
// Vector store: the same as the app's VECTOR_STORE (mongo by default, which is
// ranked in memory exactly as MongoDB's driver does), or pass --store=chroma
// (or --store=mongo) to choose. Chroma needs a running server at CHROMA_URL.
//
// Reports the top-4 hit
// rate (the source document is among the 4 chunks the chatbot would use),
// hit@1, mean reciprocal rank, and how often the similarity threshold
// (RAG_SIMILARITY_THRESHOLD) declines answerable vs unanswerable questions.
//
// Decline evaluation (optional flags):
//   --grounding           also run the chatbot's grounding check
//                         (src/ai/groundingCheck.js) on the retrieved chunks,
//                         using the chat model (ollama pull llama3.2).
//   --calibrate=<file>    choose a similarity threshold on a separate question
//                         set (benchmarks/data/decline-calibration.json): the
//                         highest threshold in 0.30-0.70 whose false-decline
//                         rate there is at most 5%. That threshold is then
//                         reported on the test set; the test set is never used
//                         to choose it.
//   --data=<file>         a different test set (default
//                         benchmarks/data/retrieval-eval.json; paths are
//                         relative to server/).
// Every decline row reports both the share of unanswerable questions declined
// and the share of answerable questions wrongly declined.
//
// The sets are small and synthetic, so treat the result as a sanity check of
// this setup, not a general accuracy figure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  evaluateRetrieval,
  createMemoryIndex,
  thresholdSweep,
  calibrateThreshold,
  evaluateDeclines,
  stripChunks,
} from './lib/retrievalEval.js';
import { createChromaIndex } from './lib/chromaIndex.js';
import { writeResult } from './lib/results.js';
import { llmClient } from '../src/ai/llmClient.js';
import { checkGrounding } from '../src/ai/groundingCheck.js';
import { config } from '../src/config/index.js';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOP_K = 4; // same as the chatbot (src/ai/ragChain.js)
const MAX_CALIBRATION_FALSE_DECLINE = 0.05;
const SWEEP = Array.from({ length: 41 }, (_, i) => Number((0.3 + i * 0.01).toFixed(2))); // 0.30 .. 0.70

const arg = (name) => {
  const found = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return undefined;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};
const STORE = String(arg('store') || config.vectorStore.driver).toLowerCase();
const DATA_FILE = arg('data') || 'benchmarks/data/retrieval-eval.json';
const CALIBRATION_FILE = arg('calibrate');
const GROUNDING = Boolean(arg('grounding'));

const pct = (value) => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const resolve = (file) => (path.isAbsolute(file) ? file : path.join(BENCH_DIR, '..', file));

// A question set; `documentsFrom` lets the calibration set reuse the test set's documents.
const loadSet = (file) => {
  const data = JSON.parse(fs.readFileSync(resolve(file), 'utf-8'));
  const documents = data.documents || JSON.parse(fs.readFileSync(path.join(path.dirname(resolve(file)), data.documentsFrom), 'utf-8')).documents;
  return { documents, queries: data.queries };
};

const runRetrieval = async (set, threshold) => {
  const embed = (text) => llmClient.embed(text);
  const index = STORE === 'chroma' ? await createChromaIndex(embed) : createMemoryIndex(embed);
  try {
    return { indexName: index.name, ...(await evaluateRetrieval({ ...set, topK: TOP_K, threshold, index })) };
  } finally {
    await index.close?.();
  }
};

const declineRow = (r) => ({
  'unanswerable declined': `${pct(r.correctDeclineRate)} (${r.correctDeclines}/${r.unanswerableQueries})`,
  'answerable declined': `${pct(r.falseDeclineRate)} (${r.falseDeclines}/${r.answerableQueries})`,
  ...(r.groundingCheck && { 'judge unreadable': r.judgeUnreadable, 'judge median ms': r.judgeMedianMs }),
});

const main = async () => {
  if (!['mongo', 'chroma'].includes(STORE)) throw new Error(`Unknown store "${STORE}" (use mongo or chroma)`);
  if (!(await llmClient.isAvailable())) {
    throw new Error(
      `The ${config.llm.provider} embedding model is not reachable. Start Ollama ` +
        '(and `ollama pull nomic-embed-text`) or set LLM_PROVIDER=openai.'
    );
  }

  const testSet = loadSet(DATA_FILE);
  const threshold = config.llm.similarityThreshold;
  console.log(
    `Embedding ${testSet.documents.length} documents and ${testSet.queries.length} questions with ` +
      `${config.llm.embeddingModel} (threshold ${threshold}) ...\n`
  );

  const result = await runRetrieval(testSet, threshold);
  console.log(`Vector store: ${result.indexName}\n`);

  console.table({
    [`hit rate @${TOP_K}`]: { value: pct(result.hitRateAtK) },
    'hit rate @1': { value: pct(result.hitRateAt1) },
    'mean reciprocal rank': { value: result.meanReciprocalRank },
    'answerable but declined': { value: pct(result.falseDeclineRate) },
    'unanswerable and declined': { value: pct(result.correctDeclineRate) },
  });

  const misses = result.perQuery.filter((q) => q.expected && !q.rank);
  if (misses.length) {
    console.log('Missed questions:');
    for (const miss of misses) console.log(`  - ${miss.question} (expected ${miss.expected})`);
  }

  // Decline evaluation: similarity only vs similarity + grounding check, at the
  // configured threshold and (with --calibrate) at the calibrated one.
  let calibration;
  if (CALIBRATION_FILE) {
    const calibrationSet = loadSet(CALIBRATION_FILE);
    console.log(`\nCalibrating the threshold on ${CALIBRATION_FILE} (${calibrationSet.queries.length} questions) ...`);
    const calibrationRun = await runRetrieval(calibrationSet, threshold);
    const sweep = thresholdSweep(calibrationRun.perQuery, SWEEP);
    calibration = {
      dataFile: CALIBRATION_FILE,
      rule: `highest threshold in ${SWEEP[0]}-${SWEEP.at(-1)} with false-decline rate <= ${MAX_CALIBRATION_FALSE_DECLINE} on the calibration set`,
      threshold: calibrateThreshold(sweep, MAX_CALIBRATION_FALSE_DECLINE),
      sweep,
      perQuery: calibrationRun.perQuery,
    };
    console.log(`Calibrated threshold: ${calibration.threshold ?? 'none (no threshold met the rule)'}`);
  }

  const judge = GROUNDING ? (question, chunks) => checkGrounding(question, chunks) : null;
  if (GROUNDING) console.log(`Grounding check with ${config.llm.provider} ${config.llm.chatModel} ...`);
  const thresholds = [...new Set([threshold, calibration?.threshold].filter((t) => typeof t === 'number'))];
  const declines = {};
  const sets = { test: result.perQuery, ...(calibration && { calibration: calibration.perQuery }) };
  for (const [setName, perQuery] of Object.entries(sets)) {
    const cache = new Map();
    for (const t of thresholds) {
      declines[`${setName} similarity-only @${t}`] = await evaluateDeclines(perQuery, { threshold: t });
      if (judge) declines[`${setName} similarity+grounding @${t}`] = await evaluateDeclines(perQuery, { threshold: t, judge, cache });
    }
  }
  console.log('\nDecline decisions (test = data file above, calibration = --calibrate set):');
  console.table(Object.fromEntries(Object.entries(declines).map(([name, r]) => [name, declineRow(r)])));
  if (judge) {
    for (const [name, r] of Object.entries(declines).filter(([n, row]) => row.groundingCheck && n.startsWith('test'))) {
      const wrong = r.decisions.filter((d) => (d.expected ? d.decision !== 'answer' : d.decision === 'answer'));
      if (wrong.length) {
        console.log(`${name}, wrong decisions:`);
        for (const d of wrong) console.log(`  - ${d.question} (${d.expected ? 'answerable, declined' : 'unanswerable, answered'})`);
      }
    }
  }

  const { perQuery, indexName, ...summary } = result;
  console.log(
    `Saved ${writeResult(`retrieval-eval-${STORE}`, {
      vectorStore: STORE,
      provider: config.llm.provider,
      embeddingModel: config.llm.embeddingModel,
      ...(GROUNDING && { chatModel: config.llm.chatModel }),
      dataFile: DATA_FILE,
      ...summary,
      perQuery: stripChunks(perQuery),
      ...(calibration && { calibration: { ...calibration, perQuery: stripChunks(calibration.perQuery) } }),
      declines,
    })}`
  );
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
