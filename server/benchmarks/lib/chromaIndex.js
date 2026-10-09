// Retrieval-eval index backed by the app's ChromaDB driver
// (src/services/chromaVectorStore.js), so the benchmark exercises the same
// upsert, patient filter, top-k query and distance-to-similarity conversion
// the chatbot uses with VECTOR_STORE=chroma. It writes to a throwaway
// collection that is deleted afterwards.
import { ChromaVectorStore } from '../../src/services/chromaVectorStore.js';

const BENCH_PATIENT = 'retrieval-eval';

export const createChromaIndex = async (embed) => {
  // Embed each distinct text once, as the in-memory index effectively does.
  const cache = new Map();
  const cachedEmbed = async (text) => {
    if (!cache.has(text)) cache.set(text, await embed(text));
    return { success: true, embedding: cache.get(text) };
  };

  const store = new ChromaVectorStore({
    collectionName: `medflow_retrieval_eval_${Date.now()}`,
    embed: cachedEmbed,
  });
  if (!(await store.isAvailable())) {
    throw new Error('ChromaDB is not reachable at CHROMA_URL; start it (docker compose --profile chroma up -d chroma).');
  }

  return {
    name: `chroma (${store.collectionName})`,
    async add({ documentId, chunkIndex, text }) {
      const result = await store.addDocument(text, { documentId, patientId: BENCH_PATIENT, chunkIndex });
      if (!result.success) throw new Error(`Chroma add failed: ${result.error}`);
    },
    async search(text, topK) {
      const result = await store.search(text, topK, { patientId: BENCH_PATIENT });
      if (!result.success) throw new Error(`Chroma search failed: ${result.error}`);
      return result.results.map((r) => ({ documentId: r.documentId, score: r.score }));
    },
    async close() {
      await store.client.deleteCollection({ name: store.collectionName }).catch(() => {});
    },
  };
};
