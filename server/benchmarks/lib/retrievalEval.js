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
//   search(text, topK) -> Promise<[{ documentId, score }]>, best first
export const createMemoryIndex = (embed) => {
  const chunks = [];
  return {
    name: 'memory (same ranking as VECTOR_STORE=mongo)',
    async add({ documentId, text }) {
      chunks.push({ documentId, embedding: await embed(text) });
    },
    async search(text, topK) {
      const queryEmbedding = await embed(text);
      return chunks
        .map((chunk) => ({ documentId: chunk.documentId, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
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
