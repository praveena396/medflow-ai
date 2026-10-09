// Retrieval evaluation, kept free of I/O so it can be unit-tested with a toy
// embedder. It mirrors the app: documents are split with the app's chunker,
// scored with the app's cosine similarity, and a question is "declined" when
// no chunk reaches the similarity threshold (see src/ai/ragChain.js).
import { chunkText } from '../../src/utils/textChunker.js';
import { cosineSimilarity } from '../../src/services/vectorStoreService.js';

// An index answers "which chunks are most similar to this text?". The default
// one keeps embeddings in memory and ranks them with the app's cosine
// similarity, exactly like the MongoDB vector store. benchmarks/lib/chromaIndex.js
// runs the same evaluation through the app's ChromaDB driver instead.
//   add({ documentId, chunkIndex, text }) -> Promise
//   search(text, topK) -> Promise<[{ documentId, score, text }]>, best first
export const createMemoryIndex = (embed) => {
  const chunks = [];
  return {
    name: 'memory (same ranking as VECTOR_STORE=mongo)',
    async add({ documentId, text }) {
      chunks.push({ documentId, text, embedding: await embed(text) });
    },
    async search(text, topK) {
      const queryEmbedding = await embed(text);
      return chunks
        .map((chunk) => ({
          documentId: chunk.documentId,
          text: chunk.text,
          score: cosineSimilarity(queryEmbedding, chunk.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
};

// documents: [{ id, text }]
// queries:   [{ question, expected: documentId | null }]  (null = not answerable)
// embed:     async (text) => number[]   (used by the default in-memory index)
// index:     optional; see createMemoryIndex
export const evaluateRetrieval = async ({ documents, queries, embed, topK = 4, threshold, index }) => {
  const store = index || createMemoryIndex(embed);
  let chunkCount = 0;
  for (const doc of documents) {
    const pieces = chunkText(doc.text);
    for (let chunkIndex = 0; chunkIndex < pieces.length; chunkIndex++) {
      await store.add({ documentId: doc.id, chunkIndex, text: pieces[chunkIndex] });
      chunkCount++;
    }
  }

  const perQuery = [];
  for (const query of queries) {
    const ranked = await store.search(query.question, topK);

    const bestScore = ranked[0]?.score ?? 0;
    const rank = query.expected
      ? ranked.findIndex((result) => result.documentId === query.expected) + 1 // 0 = missed
      : null;

    perQuery.push({
      question: query.question,
      expected: query.expected,
      retrieved: ranked.map((r) => ({ documentId: r.documentId, score: Number(r.score.toFixed(4)) })),
      rank,
      declined: bestScore < threshold,
      // Retrieved chunks with their text, for evaluateDeclines; not part of
      // the saved result (see stripChunks).
      chunks: ranked.map((r) => ({ documentId: r.documentId, score: r.score, text: r.text })),
    });
  }

  const answerable = perQuery.filter((q) => q.expected);
  const unanswerable = perQuery.filter((q) => !q.expected);
  const rate = (items, predicate) =>
    items.length ? Number((items.filter(predicate).length / items.length).toFixed(4)) : null;

  return {
    topK,
    threshold,
    documents: documents.length,
    chunks: chunkCount,
    answerableQueries: answerable.length,
    unanswerableQueries: unanswerable.length,
    // Share of answerable questions whose source document was retrieved at all / first.
    hitRateAtK: rate(answerable, (q) => q.rank >= 1),
    hitRateAt1: rate(answerable, (q) => q.rank === 1),
    meanReciprocalRank: answerable.length
      ? Number((answerable.reduce((sum, q) => sum + (q.rank ? 1 / q.rank : 0), 0) / answerable.length).toFixed(4))
      : null,
    // Answerable questions the chatbot would wrongly decline at this threshold.
    falseDeclineRate: rate(answerable, (q) => q.declined),
    // Unanswerable questions the chatbot correctly declines at this threshold.
    correctDeclineRate: rate(unanswerable, (q) => q.declined),
    perQuery,
  };
};

const rateOf = (items, predicate) =>
  items.length ? Number((items.filter(predicate).length / items.length).toFixed(4)) : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Decline rates if the chatbot used only a similarity threshold, for each
// threshold in `thresholds` (a question is declined when its best chunk
// scores below the threshold).
export const thresholdSweep = (perQuery, thresholds) => {
  const answerable = perQuery.filter((q) => q.expected);
  const unanswerable = perQuery.filter((q) => !q.expected);
  return thresholds.map((threshold) => {
    const declined = (q) => (q.retrieved[0]?.score ?? 0) < threshold;
    return {
      threshold,
      falseDeclineRate: rateOf(answerable, declined),
      correctDeclineRate: rateOf(unanswerable, declined),
    };
  });
};

// Calibration rule, fixed before looking at any results: the highest
// threshold whose false-decline rate (answerable questions declined) stays at
// or below maxFalseDeclineRate. Applied to a separate calibration set, never
// to the test set.
export const calibrateThreshold = (sweep, maxFalseDeclineRate = 0.05) => {
  const ok = sweep.filter((row) => row.falseDeclineRate !== null && row.falseDeclineRate <= maxFalseDeclineRate);
  return ok.length ? ok.reduce((best, row) => (row.threshold > best.threshold ? row : best)).threshold : null;
};

// The chatbot's full decline decision: the similarity threshold first, then
// (if `judge` is given) the grounding check on the chunks that passed it, as
// src/ai/ragChain.js does. judge: async (question, chunks) => { grounded }
// where grounded is true, false or null (unreadable; the chatbot answers).
export const evaluateDeclines = async (perQuery, { threshold, judge, cache = new Map() }) => {
  const decisions = [];
  const timings = [];
  let unreadable = 0;
  for (const q of perQuery) {
    const above = q.chunks.filter((c) => c.score >= threshold);
    let decision = 'answer';
    let verdict;
    if (above.length === 0) {
      decision = 'low-similarity';
    } else if (judge) {
      const key = JSON.stringify([q.question, above.map((c) => c.text)]);
      if (!cache.has(key)) {
        const start = Date.now();
        cache.set(key, await judge(q.question, above));
        timings.push(Date.now() - start);
      }
      verdict = cache.get(key).grounded;
      if (verdict === null) unreadable++;
      if (verdict === false) decision = 'not-grounded';
    }
    decisions.push({ question: q.question, expected: q.expected, decision, ...(judge && { verdict: verdict ?? null }) });
  }
  const answerable = decisions.filter((d) => d.expected);
  const unanswerable = decisions.filter((d) => !d.expected);
  const declined = (d) => d.decision !== 'answer';
  return {
    threshold,
    groundingCheck: Boolean(judge),
    falseDeclineRate: rateOf(answerable, declined),
    correctDeclineRate: rateOf(unanswerable, declined),
    falseDeclines: answerable.filter(declined).length,
    correctDeclines: unanswerable.filter(declined).length,
    answerableQueries: answerable.length,
    unanswerableQueries: unanswerable.length,
    ...(judge && { judgeCalls: timings.length, judgeUnreadable: unreadable, judgeMedianMs: median(timings) }),
    decisions,
  };
};

// Drops the chunk text from perQuery before a result is saved.
export const stripChunks = (perQuery) => perQuery.map(({ chunks, ...rest }) => rest);

