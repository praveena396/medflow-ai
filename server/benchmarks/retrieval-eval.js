// Retrieval and refusal quality on a labelled set of synthetic documents and
// questions (benchmarks/data/retrieval-eval.json). Needs a running embedding
// model, so run it locally. One command, from server/:
//
//   ollama pull nomic-embed-text                 # once
//   ollama pull llama3.2                         # once, for --grounding
//   npm run bench:retrieval -- --grounding --calibrate=benchmarks/data/decline-calibration.json
//
// That single run reports, each as a rate with the counts behind it:
//   - retrieval hit@1 and hit@4 on the answerable questions
//   - correct refusal rate on the unanswerable questions (true positives)
//   - over-refusal rate on the answerable questions (refused although the
//     answer was retrieved), for similarity only and for similarity plus the
//     grounding check
// With --grounding it also prints a diagnostic block for every wrong decision
// on the test set: the question, the judge's raw reply, and the retrieved text
// the judge was shown (each truncated), so one run explains itself without a
// second round trip against the live model.
// Nothing here is tuned to the test set and no expected result is hard-coded:
// the threshold comes from RAG_SIMILARITY_THRESHOLD, or from the calibration
// set when --calibrate is given.
//
// Without flags it runs retrieval and the similarity-only refusal rates:
//
//   npm run bench:retrieval
//
// (LLM_PROVIDER=openai with OPENAI_API_KEY works too.)
//
// Vector store: the same as the app's VECTOR_STORE (mongo by default, which is
// ranked in memory exactly as MongoDB's driver does), or pass --store=chroma
// (or --store=mongo) to choose. Chroma needs a running server at CHROMA_URL.
//
// Optional flags:
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
// Every refusal row reports both the share of unanswerable questions refused
// and the share of answerable questions wrongly refused, with counts.
//
// The documents are synthetic records written for this project, so treat the
// result as a sanity check of this setup, not a general accuracy figure.
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
  stripDecisionContext,
  formatWrongDecisions,
} from './lib/retrievalEval.js';
import { createChromaIndex } from './lib/chromaIndex.js';
import { writeResult } from './lib/results.js';
import { llmClient } from '../src/ai/llmClient.js';
import { checkGrounding } from '../src/ai/groundingCheck.js';
import { config } from '../src/config/index.js';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOP_K = 4; // same as the chatbot (src/ai/ragChain.js)
// The records in the data files are ~40 words each and DOC_CHUNK_SIZE_WORDS is
// 500, so the chunker emits one chunk per document ("10 documents, 10 chunks").
// That is intended here: each synthetic record is a single short report, and
// the judge sees it whole rather than a fragment of it.
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
// Every rate is reported with the counts behind it.
const withCount = (rate, n, total) => `${pct(rate)} (${n}/${total})`;
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
  // True positives: unanswerable questions the chatbot refuses to answer.
  'correct refusal (unanswerable set)': withCount(r.correctDeclineRate, r.correctDeclines, r.unanswerableQueries),
  // False positives: answerable questions it refuses although it retrieved the answer.
  'over-refusal (answerable set)': withCount(r.falseDeclineRate, r.falseDeclines, r.answerableQueries),
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
  console.log(`Vector store: ${result.indexName}`);
  console.log(
    `Question set: ${DATA_FILE} - ${result.documents} documents, ${result.chunks} chunks, ` +
      `${result.answerableQueries} answerable questions, ${result.unanswerableQueries} unanswerable questions\n`
  );

  console.log(`Retrieval, answerable set only (${result.answerableQueries} questions):`);
  console.table({
    'hit@1 (source document ranked first)': {
      result: withCount(result.hitRateAt1, result.hitsAt1, result.answerableQueries),
    },
    [`hit@${TOP_K} (source document among the ${TOP_K} chunks used)`]: {
      result: withCount(result.hitRateAtK, result.hitsAtK, result.answerableQueries),
    },
    'mean reciprocal rank': { result: result.meanReciprocalRank },
  });

  console.log(`\nRefusal, similarity threshold ${threshold} only:`);
  console.table({
    [`correct refusal, unanswerable set (${result.unanswerableQueries} questions)`]: {
      result: withCount(result.correctDeclineRate, result.correctDeclines, result.unanswerableQueries),
    },
    [`over-refusal, answerable set (${result.answerableQueries} questions)`]: {
      result: withCount(result.falseDeclineRate, result.falseDeclines, result.answerableQueries),
    },
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
  console.log(
    '\nRefusal decisions, each rate with the counts behind it ' +
      '(test = the data file above, calibration = the --calibrate set):'
  );
  console.table(Object.fromEntries(Object.entries(declines).map(([name, r]) => [name, declineRow(r)])));
  if (judge) {
    // One run has to explain itself: for every wrong decision, print the
    // question, what the judge actually replied, and the text it was given.
    // Truncated so the block stays readable; the saved JSON keeps the verdicts.
    for (const [name, r] of Object.entries(declines).filter(([n, row]) => row.groundingCheck && n.startsWith('test'))) {
      const lines = formatWrongDecisions(name, r.decisions);
      if (lines.length) console.log(`\n${lines.join('\n')}\n`);
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
      declines: stripDecisionContext(declines),
    })}`
  );
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
