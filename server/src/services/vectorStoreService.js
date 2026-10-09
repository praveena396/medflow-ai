import { DocumentChunk } from '../models/index.js';
import { embeddingsService } from './embeddingsService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { ChromaVectorStore } from './chromaVectorStore.js';

// cosine similarity: 1 = same meaning, 0 = unrelated
export const cosineSimilarity = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

// MongoDB driver (VECTOR_STORE=mongo, the default): chunks and their
// embeddings live in the DocumentChunk collection, and a search ranks one
// patient's chunks by cosine similarity in Node.
export class MongoVectorStore {
  // Embed a text chunk and persist it, scoped to a patient.
  async addDocument(text, metadata = {}) {
    try {
      const { documentId, patientId, chunkIndex = 0, fileName } = metadata;
      if (!documentId || !patientId) {
        throw new Error('documentId and patientId are required metadata');
      }

      const result = await embeddingsService.embedText(text);
      if (!result.success) {
        throw new Error(`Embedding failed: ${result.error}`);
      }

      const chunk = await DocumentChunk.create({
        documentId,
        patientId,
        chunkIndex,
        text,
        embedding: result.embedding,
        fileName,
      });

      return { success: true, documentId: chunk._id.toString() };
    } catch (error) {
      logger.error('Add document error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Find the chunks most similar in meaning to the query.
  // filter.patientId restricts the search to that patient's own documents.
  async search(queryText, topK = 4, filter = {}) {
    try {
      const query = {};
      if (filter.patientId) query.patientId = filter.patientId;

      const chunks = await DocumentChunk.find(query).select('+embedding').lean();

      if (chunks.length === 0) {
        return { success: true, results: [], message: 'No documents in vector store' };
      }

      const embedResult = await embeddingsService.embedText(queryText);
      if (!embedResult.success) {
        throw new Error(`Query embedding failed: ${embedResult.error}`);
      }

      const results = chunks
        .map((chunk) => ({
          documentId: chunk.documentId.toString(),
          text: chunk.text,
          score: cosineSimilarity(embedResult.embedding, chunk.embedding),
          metadata: { fileName: chunk.fileName, chunkIndex: chunk.chunkIndex },
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`🔍 Vector search: ${results.length} results, best score ${results[0]?.score.toFixed(3)}`);

      return { success: true, results };
    } catch (error) {
      logger.error('Vector search error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Remove all chunks belonging to an uploaded document (e.g. when it is deleted).
  async deleteDocument(documentId) {
    try {
      const { deletedCount } = await DocumentChunk.deleteMany({ documentId });
      logger.info(`🗑️  Deleted ${deletedCount} chunks for document ${documentId}`);
      return { success: true, deletedCount };
    } catch (error) {
      logger.error('Delete document error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getDocumentCount() {
    return DocumentChunk.estimatedDocumentCount();
  }

  async isAvailable() {
    return true; // lives in MongoDB, which /health already reports
  }
}

// Picks the driver from VECTOR_STORE on each call (so tests can switch it)
// and keeps one instance of each.
const drivers = {};
export const getVectorStoreDriver = (name = config.vectorStore.driver) => {
  if (!drivers[name]) {
    if (name === 'chroma') drivers[name] = new ChromaVectorStore();
    else if (name === 'mongo') drivers[name] = new MongoVectorStore();
    else throw new Error(`Unknown VECTOR_STORE "${name}" (use mongo or chroma)`);
  }
  return drivers[name];
};

export const vectorStore = {
  get driver() {
    return config.vectorStore.driver;
  },
  addDocument: (...args) => getVectorStoreDriver().addDocument(...args),
  search: (...args) => getVectorStoreDriver().search(...args),
  deleteDocument: (...args) => getVectorStoreDriver().deleteDocument(...args),
  getDocumentCount: () => getVectorStoreDriver().getDocumentCount(),
  isAvailable: () => getVectorStoreDriver().isAvailable(),
};
