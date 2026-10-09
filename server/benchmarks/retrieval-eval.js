// Retrieval quality on a small labelled set (benchmarks/data/retrieval-eval.json).
// Needs a running embedding model, so run it locally:
//
//   ollama pull nomic-embed-text      # once
//   npm run bench:retrieval            # from server/
//
// (LLM_PROVIDER=openai with OPENAI_API_KEY works too.) Reports the top-4 hit
// rate (the source document is among the 4 chunks the chatbot would use),
// hit@1, mean reciprocal rank, and how often the similarity threshold
// (RAG_SIMILARITY_THRESHOLD) declines answerable vs unanswerable questions.
// The set is small and synthetic, so treat the result as a sanity check of
// this setup, not a general accuracy figure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateRetrieval } from './lib/retrievalEval.js';
import { writeResult } from './lib/results.js';
import { llmClient } from '../src/ai/llmClient.js';
import { config } from '../src/config/index.js';

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'retrieval-eval.json');
const TOP_K = 4; // same as the chatbot (src/ai/ragChain.js)

const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);

const main = async () => {
  if (!(await llmClient.isAvailable())) {
    throw new Error(
      `The ${config.llm.provider} embedding model is not reachable. Start Ollama ` +
        '(and `ollama pull nomic-embed-text`) or set LLM_PROVIDER=openai.'
    );
  }

  const { documents, queries } = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const threshold = config.llm.similarityThreshold;
  console.log(
    `Embedding ${documents.length} documents and ${queries.length} questions with ` +
      `${config.llm.embeddingModel} (threshold ${threshold}) ...\n`
  );

  const result = await evaluateRetrieval({
    documents,
    queries,
    topK: TOP_K,
    threshold,
    embed: (text) => llmClient.embed(text),
  });

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

  console.log(
    `Saved ${writeResult('retrieval-eval', {
      provider: config.llm.provider,
      embeddingModel: config.llm.embeddingModel,
      dataFile: 'benchmarks/data/retrieval-eval.json',
      ...result,
    })}`
  );
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
