import { ChromaClient } from 'chromadb';
import { config } from '../config/index.js';
import { embeddingsService } from './embeddingsService.js';
import { logger } from '../utils/logger.js';

// ChromaDB driver for the vector store (VECTOR_STORE=chroma). Same interface
// and return shapes as the MongoDB driver in vectorStoreService.js:
//   addDocument(text, { documentId, patientId, chunkIndex, fileName })
//   search(queryText, topK, { patientId })  -> results with a cosine `score`
//   deleteDocument(documentId)
//
// One collection holds every patient's chunks; each chunk carries patientId
// and documentId metadata, and every search filters on patientId, so one
// patient's question can never retrieve another patient's text. The
// collection uses cosine space, so score = 1 - distance is the same cosine
// similarity the MongoDB driver computes, and RAG_SIMILARITY_THRESHOLD means
// the same thing with either store.

// Chroma collection names: 3-512 chars of [a-zA-Z0-9._-], starting and
// ending with a letter or digit.
export const collectionNameFor = (base, embeddingModel) => {
  const slug = `${base}_${embeddingModel || 'default'}`
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  return slug.length >= 3 ? slug.slice(0, 512) : `${slug}-collection`;
};

export const clientArgsFromUrl = (url, { tenant, database } = {}) => {
  const parsed = new URL(url);
  const ssl = parsed.protocol === 'https:';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : ssl ? 443 : 8000,
    ssl,
    ...(tenant && { tenant }),
    ...(database && { database }),
  };
};

const chunkId = (documentId, chunkIndex) => `${documentId}:${chunkIndex}`;

export class ChromaVectorStore {
  constructor({
    client,
    collectionName,
    embed = (text) => embeddingsService.embedText(text),
  } = {}) {
    this.client =
      client ||
      new ChromaClient(
        clientArgsFromUrl(config.vectorStore.chroma.url, {
          tenant: config.vectorStore.chroma.tenant,
          database: config.vectorStore.chroma.database,
        })
      );
    this.collectionName =
      collectionName || collectionNameFor(config.vectorStore.chroma.collection, config.llm.embeddingModel);
    this.embed = embed;
    this.collectionPromise = null;
  }

  // Created on first use. embeddingFunction: null because MedFlow embeds
  // text itself (Ollama or OpenAI) and hands Chroma the vectors.
  collection() {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client
        .getOrCreateCollection({
          name: this.collectionName,
          configuration: { hnsw: { space: 'cosine' } },
          embeddingFunction: null,
        })
        .catch((error) => {
          this.collectionPromise = null; // retry on the next call
          throw error;
        });
    }
    return this.collectionPromise;
  }

  async addDocument(text, metadata = {}) {
    try {
      const { documentId, patientId, chunkIndex = 0, fileName } = metadata;
      if (!documentId || !patientId) {
        throw new Error('documentId and patientId are required metadata');
      }

      const result = await this.embed(text);
      if (!result.success) {
        throw new Error(`Embedding failed: ${result.error}`);
      }

      const collection = await this.collection();
      const id = chunkId(documentId.toString(), chunkIndex);
      // upsert: reprocessing a document overwrites its chunks instead of
      // duplicating them.
      await collection.upsert({
        ids: [id],
        embeddings: [result.embedding],
        documents: [text],
        metadatas: [
          {
            documentId: documentId.toString(),
            patientId: patientId.toString(),
            chunkIndex,
            ...(fileName && { fileName }),
          },
        ],
      });

      return { success: true, documentId: id };
    } catch (error) {
      logger.error('Add document error (chroma):', error.message);
      return { success: false, error: error.message };
    }
  }

  async search(queryText, topK = 4, filter = {}) {
    try {
      const collection = await this.collection();

      const embedResult = await this.embed(queryText);
      if (!embedResult.success) {
        throw new Error(`Query embedding failed: ${embedResult.error}`);
      }

      const response = await collection.query({
        queryEmbeddings: [embedResult.embedding],
        nResults: topK,
        ...(filter.patientId && { where: { patientId: filter.patientId.toString() } }),
        include: ['documents', 'metadatas', 'distances'],
      });

      const ids = response.ids?.[0] || [];
      if (ids.length === 0) {
        return { success: true, results: [], message: 'No documents in vector store' };
      }

      const results = ids
        .map((id, i) => {
          const meta = response.metadatas?.[0]?.[i] || {};
          return {
            documentId: meta.documentId,
            text: response.documents?.[0]?.[i] ?? '',
            score: 1 - (response.distances?.[0]?.[i] ?? 1),
            metadata: { fileName: meta.fileName, chunkIndex: meta.chunkIndex },
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`🔍 Vector search (chroma): ${results.length} results, best score ${results[0]?.score.toFixed(3)}`);

      return { success: true, results };
    } catch (error) {
      logger.error('Vector search error (chroma):', error.message);
      return { success: false, error: error.message };
    }
  }

  async deleteDocument(documentId) {
    try {
      const collection = await this.collection();
      const where = { documentId: documentId.toString() };
      const before = await collection.get({ where, include: [] });
      const deletedCount = before.ids?.length || 0;
      if (deletedCount) await collection.delete({ where });
      logger.info(`🗑️  Deleted ${deletedCount} chunks for document ${documentId} (chroma)`);
      return { success: true, deletedCount };
    } catch (error) {
      logger.error('Delete document error (chroma):', error.message);
      return { success: false, error: error.message };
    }
  }

  async getDocumentCount() {
    const collection = await this.collection();
    return collection.count();
  }

  async isAvailable() {
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }
}
