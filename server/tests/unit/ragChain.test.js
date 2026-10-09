import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the real AI and vector store with controllable fakes.
vi.mock('../../src/ai/llmClient.js', () => ({
  llmClient: { chat: vi.fn(), embed: vi.fn(), isAvailable: vi.fn() },
}));
vi.mock('../../src/services/vectorStoreService.js', () => ({
  vectorStore: { search: vi.fn(), addDocument: vi.fn(), deleteDocument: vi.fn() },
}));

import { llmClient } from '../../src/ai/llmClient.js';
import { vectorStore } from '../../src/services/vectorStoreService.js';
import { ragChain, NOT_ENOUGH_INFORMATION_MESSAGE } from '../../src/ai/ragChain.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ragChain.triageSymptoms', () => {
  it('parses the urgency from a valid JSON response', async () => {
    llmClient.chat.mockResolvedValue(
      '{"urgency": "high", "recommendation": "See a doctor urgently."}'
    );
    const result = await ragChain.triageSymptoms('high fever for three days');
    expect(result.success).toBe(true);
    expect(result.urgency).toBe('high');
    expect(result.recommendation).toBe('See a doctor urgently.');
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it('falls back to keyword rules when the AI response is not JSON', async () => {
    llmClient.chat.mockResolvedValue('Sorry, I cannot answer in that format.');
    const result = await ragChain.triageSymptoms('crushing chest pain');
    expect(result.success).toBe(true);
    expect(result.urgency).toBe('critical');
  });

  it('defaults to low urgency for mild symptoms in fallback mode', async () => {
    llmClient.chat.mockResolvedValue('not json');
    const result = await ragChain.triageSymptoms('slight runny nose');
    expect(result.urgency).toBe('low');
  });

  it('reports failure when the AI is unreachable', async () => {
    llmClient.chat.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await ragChain.triageSymptoms('headache');
    expect(result.success).toBe(false);
  });
});

describe('ragChain.processQuery', () => {
  it('answers from documents and cites the source when similarity is high', async () => {
    vectorStore.search.mockResolvedValue({
      success: true,
      results: [
        { text: 'Cholesterol: 242 mg/dL', score: 0.9, metadata: { fileName: 'lab.pdf' } },
      ],
    });
    llmClient.chat.mockResolvedValue('Your cholesterol is 242 mg/dL, which is high.');

    const result = await ragChain.processQuery('what is my cholesterol?', { patientId: 'p1' });
    expect(result.success).toBe(true);
    expect(result.sourceDocuments).toEqual([{ fileName: 'lab.pdf', score: 0.9 }]);
    expect(result.confidence).toBe(0.9);
    // The document text must be in the prompt sent to the AI.
    const prompt = llmClient.chat.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(prompt).toContain('Cholesterol: 242 mg/dL');
  });

  it('declines without calling the AI when similarity is below the threshold', async () => {
    vectorStore.search.mockResolvedValue({
      success: true,
      results: [{ text: 'unrelated text', score: 0.1, metadata: { fileName: 'other.pdf' } }],
    });

    const result = await ragChain.processQuery('what is my blood type?');
    expect(result.success).toBe(true);
    expect(result.declined).toBe(true);
    expect(result.message).toBe(NOT_ENOUGH_INFORMATION_MESSAGE);
    expect(result.sourceDocuments).toEqual([]);
    expect(result.confidence).toBe(0.1);
    expect(llmClient.chat).not.toHaveBeenCalled();
  });

  it('declines when the patient has no documents at all', async () => {
    vectorStore.search.mockResolvedValue({ success: true, results: [] });

    const result = await ragChain.processQuery('what does my last report say?');
    expect(result.declined).toBe(true);
    expect(result.message).toMatch(/not enough information in your documents/i);
    expect(llmClient.chat).not.toHaveBeenCalled();
  });

  it('uses the configured threshold', async () => {
    vectorStore.search.mockResolvedValue({
      success: true,
      results: [{ text: 'Cholesterol: 242 mg/dL', score: 0.6, metadata: { fileName: 'lab.pdf' } }],
    });
    llmClient.chat.mockResolvedValue('Your cholesterol is 242 mg/dL.');
    const original = ragChain.similarityThreshold;
    try {
      ragChain.setSimilarityThreshold(0.7);
      expect((await ragChain.processQuery('cholesterol?')).declined).toBe(true);

      ragChain.setSimilarityThreshold(0.5);
      const answered = await ragChain.processQuery('cholesterol?');
      expect(answered.declined).toBe(false);
      expect(answered.message).toBe('Your cholesterol is 242 mg/dL.');
    } finally {
      ragChain.setSimilarityThreshold(original);
    }
  });

  it('passes the patientId filter to the vector search', async () => {
    vectorStore.search.mockResolvedValue({ success: true, results: [] });
    await ragChain.processQuery('question', { patientId: 'patient-42' });
    expect(vectorStore.search).toHaveBeenCalledWith('question', 4, { patientId: 'patient-42' });
  });

  it('returns a friendly error when the AI is down', async () => {
    vectorStore.search.mockResolvedValue({
      success: true,
      results: [{ text: 'Cholesterol: 242 mg/dL', score: 0.9, metadata: { fileName: 'lab.pdf' } }],
    });
    llmClient.chat.mockRejectedValue(new Error('timeout'));
    const result = await ragChain.processQuery('hello');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unavailable/i);
  });
});
