// Runs against a real ChromaDB server when CHROMA_URL is set (CI starts one
// as a service container); skipped otherwise.
//   CHROMA_URL=http://localhost:8000 npx vitest run tests/integration/chroma.test.js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Deterministic toy embeddings: one dimension per keyword. The LLM's chat
// call is mocked so the test can check whether it was reached.
const VOCAB = ['cholesterol', 'thyroid', 'allergy', 'vaccine', 'penicillin'];
vi.mock('../../src/ai/llmClient.js', () => ({
  llmClient: {
    embed: vi.fn(async (text) => {
      const lower = text.toLowerCase();
      const v = VOCAB.map((word) => (lower.includes(word) ? 1 : 0));
      return v.some(Boolean) ? v : [0, 0, 0, 0, 0.01]; // never an all-zero vector
    }),
    chat: vi.fn(async () => 'Your cholesterol was 242 mg/dL.'),
    isAvailable: vi.fn(async () => true),
  },
}));

const CHROMA_URL = process.env.CHROMA_URL;

describe.skipIf(!CHROMA_URL)('ChromaDB vector store (real server)', () => {
  let store;
  let config;
  let ragChain;
  let llmClient;
  const collectionName = `medflow_test_${Date.now()}`;

  beforeAll(async () => {
    ({ config } = await import('../../src/config/index.js'));
    config.vectorStore.driver = 'chroma';
    config.vectorStore.chroma.url = CHROMA_URL;
    const { ChromaVectorStore } = await import('../../src/services/chromaVectorStore.js');
    store = new ChromaVectorStore({ collectionName });
    ({ ragChain } = await import('../../src/ai/ragChain.js'));
    ({ llmClient } = await import('../../src/ai/llmClient.js'));

    // Route the app-level facade to this test's collection.
    const services = await import('../../src/services/vectorStoreService.js');
    const driver = services.getVectorStoreDriver('chroma');
    driver.collectionName = collectionName;
    driver.collectionPromise = null;

    expect(await store.isAvailable()).toBe(true);
    await store.addDocument('Lipid panel: total cholesterol 242 mg/dL, high.', { documentId: 'docA', patientId: 'alice', chunkIndex: 0, fileName: 'lipids.pdf' });
    await store.addDocument('Thyroid function: TSH 6.8, slightly high.', { documentId: 'docA', patientId: 'alice', chunkIndex: 1, fileName: 'lipids.pdf' });
    await store.addDocument('Allergy record: penicillin causes hives.', { documentId: 'docB', patientId: 'bob', chunkIndex: 0, fileName: 'allergy.pdf' });
  });

  afterAll(async () => {
    if (store) await store.client.deleteCollection({ name: collectionName }).catch(() => {});
    if (config) config.vectorStore.driver = 'mongo';
  });

  it('returns the best match first, with cosine similarity scores', async () => {
    const result = await store.search('What was my cholesterol?', 4, { patientId: 'alice' });
    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({ documentId: 'docA', metadata: { fileName: 'lipids.pdf', chunkIndex: 0 } });
    expect(result.results[0].score).toBeCloseTo(1, 5);
    expect(result.results[0].text).toContain('cholesterol 242');
  });

  it("never returns another patient's chunks", async () => {
    const result = await store.search('Am I allergic to penicillin?', 4, { patientId: 'alice' });
    expect(result.results.every((r) => r.documentId === 'docA')).toBe(true);
    const bob = await store.search('Am I allergic to penicillin?', 4, { patientId: 'bob' });
    expect(bob.results.map((r) => r.documentId)).toEqual(['docB']);
  });

  it('answers through ragChain when a chunk clears the threshold', async () => {
    llmClient.chat.mockClear();
    const answer = await ragChain.processQuery('What was my cholesterol?', { patientId: 'alice' });
    expect(answer.success).toBe(true);
    expect(answer.declined).toBeFalsy();
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    expect(answer.sourceDocuments[0]).toMatchObject({ fileName: 'lipids.pdf' });
    expect(answer.sourceDocuments.every((d) => d.score >= config.llm.similarityThreshold)).toBe(true);
  });

  it('declines without calling the LLM when nothing is similar enough', async () => {
    llmClient.chat.mockClear();
    const answer = await ragChain.processQuery('Do I need a vaccine?', { patientId: 'alice' });
    expect(answer.declined).toBe(true);
    expect(llmClient.chat).not.toHaveBeenCalled();
  });

  it("deletes a document's vectors", async () => {
    const result = await store.deleteDocument('docA');
    expect(result).toEqual({ success: true, deletedCount: 2 });
    const after = await store.search('cholesterol', 4, { patientId: 'alice' });
    expect(after.results).toEqual([]);
  });

  it('upserts on reprocessing instead of duplicating chunks', async () => {
    await store.addDocument('Allergy record: penicillin causes hives and swelling.', { documentId: 'docB', patientId: 'bob', chunkIndex: 0, fileName: 'allergy.pdf' });
    const bob = await store.search('penicillin allergy', 4, { patientId: 'bob' });
    expect(bob.results).toHaveLength(1);
    expect(bob.results[0].text).toContain('swelling');
  });
});

describe.skipIf(!CHROMA_URL)('retrieval benchmark through ChromaDB (real server)', () => {
  it('ranks the same documents as the in-memory (MongoDB-equivalent) index', async () => {
    const { config } = await import('../../src/config/index.js');
    config.vectorStore.chroma.url = CHROMA_URL;
    const { evaluateRetrieval, createMemoryIndex } = await import('../../benchmarks/lib/retrievalEval.js');
    const { createChromaIndex } = await import('../../benchmarks/lib/chromaIndex.js');
    const { llmClient } = await import('../../src/ai/llmClient.js');
    const embed = (text) => llmClient.embed(text);

    const documents = [
      { id: 'lipids', text: 'Cholesterol 242 mg/dL.' },
      { id: 'thyroid', text: 'Thyroid TSH 6.8.' },
      { id: 'allergy', text: 'Allergy: penicillin.' },
    ];
    const queries = [
      { question: 'my cholesterol?', expected: 'lipids' },
      { question: 'thyroid result?', expected: 'thyroid' },
      { question: 'penicillin allergy?', expected: 'allergy' },
      { question: 'which vaccine did I get?', expected: null },
    ];

    const chroma = await createChromaIndex(embed);
    let viaChroma;
    try {
      viaChroma = await evaluateRetrieval({ documents, queries, topK: 2, threshold: 0.5, index: chroma });
    } finally {
      await chroma.close();
    }
    const viaMemory = await evaluateRetrieval({ documents, queries, topK: 2, threshold: 0.5, index: createMemoryIndex(embed) });

    expect(viaChroma.hitRateAt1).toBe(1);
    expect(viaChroma.correctDeclineRate).toBe(1);
    // Same rank and decline decision per question. (The unanswerable one ties
    // every chunk at 0, so only its decline is compared, not the tie order.)
    const summary = (r) => r.perQuery.map((q) => [q.rank, q.declined, q.expected ? q.retrieved[0].documentId : null]);
    expect(summary(viaChroma)).toEqual(summary(viaMemory));
  });
});

