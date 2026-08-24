import { llmClient } from '../ai/llmClient.js';
import { logger } from '../utils/logger.js';

class EmbeddingsService {
  async embedText(text) {
    try {
      const embedding = await llmClient.embed(text);
      return { success: true, embedding };
    } catch (error) {
      logger.error('Embedding error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async embedBatch(texts) {
    const embeddings = [];
    for (const text of texts) {
      const result = await this.embedText(text);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      embeddings.push(result.embedding);
    }
    return { success: true, embeddings };
  }
}

export const embeddingsService = new EmbeddingsService();
