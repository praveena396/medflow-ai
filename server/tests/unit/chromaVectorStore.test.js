import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromaVectorStore, collectionNameFor, clientArgsFromUrl } from '../../src/services/chromaVectorStore.js';
import { vectorStore, getVectorStoreDriver, MongoVectorStore } from '../../src/services/vectorStoreService.js';
import { config } from '../../src/config/index.js';

// A stand-in for the chromadb client and one collection.
const fakeClient = () => {
  const collection = {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(7),
  };
  const client = {
    getOrCreateCollection: vi.fn().mockResolvedValue(collection),
    heartbeat: vi.fn().mockResolvedValue(1),
  };
  return { client, collection };
};

const okEmbed = vi.fn(async () => ({ success: true, embedding: [0.1, 0.2, 0.3] }));

describe('Chroma helpers', () => {
  it('names the collection after the embedding model, with only allowed characters', () => {
    expect(collectionNameFor('medflow_chunks', 'nomic-embed-text')).toBe('medflow_chunks_nomic-embed-text');
    expect(collectionNameFor('medflow_chunks', 'text-embedding-3-small')).toBe('medflow_chunks_text-embedding-3-small');
    expect(collectionNameFor('medflow', 'org/model:latest')).toBe('medflow_org-model-latest');
  });

  it('turns CHROMA_URL into client arguments', () => {
    expect(clientArgsFromUrl('http://localhost:8000')).toEqual({ host: 'localhost', port: 8000, ssl: false });
    expect(clientArgsFromUrl('https://chroma.example.com')).toEqual({ host: 'chroma.example.com', port: 443, ssl: true });
    expect(clientArgsFromUrl('http://chroma:9000', { tenant: 't1', database: 'd1' })).toEqual({
      host: 'chroma',
      port: 9000,
      ssl: false,
      tenant: 't1',
      database: 'd1',
    });
  });
});

describe('ChromaVectorStore', () => {
  let client;
  let collection;
  let store;

  beforeEach(() => {
    ({ client, collection } = fakeClient());
    okEmbed.mockClear();
    store = new ChromaVectorStore({ client, collectionName: 'test_chunks', embed: okEmbed });
  });

  it('creates one cosine-space collection lazily, with no Chroma-side embedding function', async () => {
    await store.getDocumentCount();
    await store.getDocumentCount();
    expect(client.getOrCreateCollection).toHaveBeenCalledTimes(1);
    expect(client.getOrCreateCollection).toHaveBeenCalledWith({
      name: 'test_chunks',
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });
  });

  it('retries creating the collection after a failure', async () => {
    client.getOrCreateCollection.mockRejectedValueOnce(new Error('connection refused'));
    await expect(store.getDocumentCount()).rejects.toThrow('connection refused');
    await expect(store.getDocumentCount()).resolves.toBe(7);
  });

  it('upserts a chunk with string ids and patient metadata', async () => {
    const documentId = { toString: () => 'doc1' };
    const result = await store.addDocument('Cholesterol 242', {
      documentId,
      patientId: 'pat1',
      chunkIndex: 2,
      fileName: 'lab.pdf',
    });
    expect(result).toEqual({ success: true, documentId: 'doc1:2' });
    expect(okEmbed).toHaveBeenCalledWith('Cholesterol 242');
    expect(collection.upsert).toHaveBeenCalledWith({
      ids: ['doc1:2'],
      embeddings: [[0.1, 0.2, 0.3]],
      documents: ['Cholesterol 242'],
      metadatas: [{ documentId: 'doc1', patientId: 'pat1', chunkIndex: 2, fileName: 'lab.pdf' }],
    });
  });

  it('refuses a chunk without documentId or patientId', async () => {
    const result = await store.addDocument('text', { documentId: 'doc1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/patientId/);
    expect(collection.upsert).not.toHaveBeenCalled();
  });

  it('reports an embedding failure without writing', async () => {
    const failing = new ChromaVectorStore({
      client,
      collectionName: 'test_chunks',
      embed: async () => ({ success: false, error: 'model down' }),
    });
    const result = await failing.addDocument('text', { documentId: 'd', patientId: 'p' });
    expect(result).toEqual({ success: false, error: 'Embedding failed: model down' });
    expect(collection.upsert).not.toHaveBeenCalled();
  });

  it("searches only the patient's chunks and converts cosine distance to similarity", async () => {
    collection.query.mockResolvedValue({
      ids: [['b:0', 'a:1']],
      distances: [[0.4, 0.1]],
      documents: [['second', 'first']],
      metadatas: [[
        { documentId: 'b', patientId: 'pat1', chunkIndex: 0, fileName: 'b.pdf' },
        { documentId: 'a', patientId: 'pat1', chunkIndex: 1, fileName: 'a.pdf' },
      ]],
    });

    const result = await store.search('cholesterol?', 4, { patientId: 'pat1' });

    expect(collection.query).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 4,
      where: { patientId: 'pat1' },
      include: ['documents', 'metadatas', 'distances'],
    });
    expect(result.success).toBe(true);
    expect(result.results.map((r) => r.documentId)).toEqual(['a', 'b']); // best first
    expect(result.results[0].score).toBeCloseTo(0.9);
    expect(result.results[1].score).toBeCloseTo(0.6);
    expect(result.results[0]).toMatchObject({ text: 'first', metadata: { fileName: 'a.pdf', chunkIndex: 1 } });
  });

  it('returns no results when the patient has no chunks', async () => {
    collection.query.mockResolvedValue({ ids: [[]], distances: [[]], documents: [[]], metadatas: [[]] });
    const result = await store.search('anything', 4, { patientId: 'nobody' });
    expect(result).toEqual({ success: true, results: [], message: 'No documents in vector store' });
  });

  it('reports a search failure instead of throwing', async () => {
    collection.query.mockRejectedValue(new Error('server error'));
    const result = await store.search('q', 4, { patientId: 'p' });
    expect(result).toEqual({ success: false, error: 'server error' });
  });

  it("deletes every chunk of a document and reports how many", async () => {
    collection.get.mockResolvedValue({ ids: ['doc1:0', 'doc1:1', 'doc1:2'] });
    const result = await store.deleteDocument({ toString: () => 'doc1' });
    expect(collection.get).toHaveBeenCalledWith({ where: { documentId: 'doc1' }, include: [] });
    expect(collection.delete).toHaveBeenCalledWith({ where: { documentId: 'doc1' } });
    expect(result).toEqual({ success: true, deletedCount: 3 });
  });

  it('skips the delete call when a document has no chunks', async () => {
    collection.get.mockResolvedValue({ ids: [] });
    const result = await store.deleteDocument('doc2');
    expect(collection.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, deletedCount: 0 });
  });

  it('checks availability with a heartbeat', async () => {
    expect(await store.isAvailable()).toBe(true);
    client.heartbeat.mockRejectedValue(new Error('down'));
    expect(await store.isAvailable()).toBe(false);
  });
});

describe('vector store selection (VECTOR_STORE)', () => {
  const original = config.vectorStore.driver;
  afterEach(() => {
    config.vectorStore.driver = original;
  });

  it('uses MongoDB by default', () => {
    expect(original).toBe('mongo');
    expect(getVectorStoreDriver()).toBeInstanceOf(MongoVectorStore);
    expect(vectorStore.driver).toBe('mongo');
  });

  it('switches to ChromaDB when VECTOR_STORE=chroma and delegates every call', async () => {
    config.vectorStore.driver = 'chroma';
    const driver = getVectorStoreDriver();
    expect(driver).toBeInstanceOf(ChromaVectorStore);
    const spy = vi.spyOn(driver, 'search').mockResolvedValue({ success: true, results: [] });
    await vectorStore.search('q', 4, { patientId: 'p' });
    expect(spy).toHaveBeenCalledWith('q', 4, { patientId: 'p' });
    spy.mockRestore();
  });

  it('rejects an unknown driver name', () => {
    expect(() => getVectorStoreDriver('pinecone')).toThrow(/Unknown VECTOR_STORE/);
  });
});
