import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { vectorStore } from '../services/vectorStoreService.js';
import { llmClient } from './llmClient.js';

// Returned (without calling the LLM) when no document chunk reaches the
// similarity threshold (RAG_SIMILARITY_THRESHOLD, default 0.45).
export const NOT_ENOUGH_INFORMATION_MESSAGE =
  'There is not enough information in your documents to answer that. ' +
  'Please upload the relevant report, or ask your doctor.';

const CHAT_SYSTEM_PROMPT = `You are MedFlow AI, a careful medical assistant.
Rules:
- Answer ONLY using the patient documents provided in the context. If the context does not contain the answer, say you don't have enough information.
- Never invent test results, dosages, or diagnoses.
- Always remind the patient to confirm with a healthcare professional for medical decisions.
- Keep answers clear and concise.`;

const TRIAGE_SYSTEM_PROMPT = `You are a medical triage assistant. Assess the urgency of the patient's symptoms.
Respond with ONLY a JSON object, no other text, in exactly this format:
{"urgency": "low" | "medium" | "high" | "critical", "recommendation": "<2-3 sentence advice for the patient>"}
Guidelines: chest pain, difficulty breathing, stroke signs, severe bleeding => critical. High fever, severe pain, worsening symptoms => high. Persistent but stable symptoms => medium. Mild, recent, common symptoms => low.
When in doubt, choose the HIGHER urgency.`;

// Keyword fallback used only if the LLM response can't be parsed.
const keywordUrgency = (symptoms) => {
  const text = symptoms.toLowerCase();
  if (/(chest pain|breathing|unconscious|bleeding heavily|stroke)/.test(text)) return 'critical';
  if (/(severe|intense|unbearable|high fever)/.test(text)) return 'high';
  if (/(persistent|recurring|worsening)/.test(text)) return 'medium';
  return 'low';
};

class RAGChain {
  constructor() {
    this.similarityThreshold = config.llm.similarityThreshold;
  }

  // Answer a patient question using their own uploaded documents as context.
  async processQuery(userMessage, { patientId } = {}) {
    try {
      logger.info(`🤖 Processing query: "${userMessage}"`);

      const searchResults = await vectorStore.search(userMessage, 4, { patientId });
      if (!searchResults.success) {
        return { success: false, message: 'Failed to search documents' };
      }

      const relevant = searchResults.results.filter(
        (doc) => doc.score >= this.similarityThreshold
      );
      const bestScore = searchResults.results[0]?.score || 0;

      // Nothing in the patient's documents is similar enough: decline instead of
      // letting the model answer from general knowledge. The LLM is not called.
      if (relevant.length === 0) {
        logger.info(
          `🙅 Declining: best similarity ${bestScore.toFixed(3)} is below the threshold ${this.similarityThreshold}`
        );
        return {
          success: true,
          declined: true,
          message: NOT_ENOUGH_INFORMATION_MESSAGE,
          sourceDocuments: [],
          confidence: bestScore,
        };
      }

      const context = relevant
        .map((doc) => `Source: ${doc.metadata.fileName || 'Document'}\n${doc.text}`)
        .join('\n\n---\n\n');
      const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Patient documents:\n\n${context}\n\nQuestion: ${userMessage}`,
        },
      ];

      const response = await llmClient.chat(messages);

      logger.info('✅ Query processed successfully');

      return {
        success: true,
        declined: false,
        message: response,
        sourceDocuments: relevant.map((doc) => ({
          fileName: doc.metadata.fileName || 'Document',
          score: doc.score,
        })),
        confidence: bestScore,
      };
    } catch (error) {
      logger.error('RAG processing error:', error.message);
      return {
        success: false,
        message: 'The AI service is currently unavailable. Please try again shortly.',
        error: error.message,
      };
    }
  }

  // Assess symptom urgency. LLM decides; keyword rules are only a parse fallback.
  async triageSymptoms(symptoms) {
    try {
      logger.info(`🏥 Triaging symptoms: ${symptoms}`);

      const response = await llmClient.chat(
        [
          { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
          { role: 'user', content: `Symptoms: ${symptoms}` },
        ],
        { temperature: 0 }
      );

      let urgency;
      let recommendation;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
        if (['low', 'medium', 'high', 'critical'].includes(parsed.urgency)) {
          urgency = parsed.urgency;
          recommendation = parsed.recommendation;
        }
      } catch {
        logger.warn('Triage LLM response was not valid JSON, using keyword fallback');
      }

      if (!urgency) {
        urgency = keywordUrgency(symptoms);
        recommendation = response;
      }

      logger.info(`✅ Triage completed: ${urgency}`);

      return {
        success: true,
        urgency,
        recommendation,
        nextSteps: this.getNextSteps(urgency),
      };
    } catch (error) {
      logger.error('Triage error:', error.message);
      return { success: false, error: error.message };
    }
  }

  getNextSteps(urgency) {
    const steps = {
      critical: ['Seek emergency care immediately', 'Call emergency services if in severe distress'],
      high: ['Schedule urgent appointment with doctor', 'Monitor symptoms closely'],
      medium: ['Schedule appointment within 2-3 days', 'Track symptom progression'],
      low: ['Schedule routine checkup', 'Monitor and follow home care'],
    };
    return steps[urgency] || steps.low;
  }

  setSimilarityThreshold(threshold) {
    this.similarityThreshold = threshold;
  }
}

export const ragChain = new RAGChain();
