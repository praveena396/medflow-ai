import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Single gateway to the LLM provider. Swap providers via LLM_PROVIDER without
// touching any calling code.
class LLMClient {
  constructor() {
    this.provider = config.llm.provider;

    if (this.provider === 'openai') {
      this.http = axios.create({
        baseURL: 'https://api.openai.com/v1',
        timeout: config.llm.requestTimeoutMs,
        headers: { Authorization: `Bearer ${config.llm.openaiApiKey}` },
      });
    } else {
      this.http = axios.create({
        baseURL: config.llm.ollamaBaseUrl,
        timeout: config.llm.requestTimeoutMs,
      });
    }
  }

  // messages: [{ role: 'system' | 'user' | 'assistant', content: string }]
  async chat(messages, { temperature = 0.2 } = {}) {
    if (this.provider === 'openai') {
      const { data } = await this.http.post('/chat/completions', {
        model: config.llm.chatModel,
        messages,
        temperature,
      });
      return data.choices[0].message.content;
    }

    const { data } = await this.http.post('/api/chat', {
      model: config.llm.chatModel,
      messages,
      stream: false,
      options: { temperature },
    });
    return data.message.content;
  }

  async embed(text) {
    if (this.provider === 'openai') {
      const { data } = await this.http.post('/embeddings', {
        model: config.llm.embeddingModel,
        input: text,
      });
      return data.data[0].embedding;
    }

    const { data } = await this.http.post('/api/embeddings', {
      model: config.llm.embeddingModel,
      prompt: text,
    });
    return data.embedding;
  }

  // Used by the health check and startup probe.
  async isAvailable() {
    try {
      if (this.provider === 'openai') {
        await this.http.get('/models');
      } else {
        await this.http.get('/api/tags');
      }
      return true;
    } catch (error) {
      logger.warn(`LLM provider (${this.provider}) unreachable: ${error.message}`);
      return false;
    }
  }
}

export const llmClient = new LLMClient();
