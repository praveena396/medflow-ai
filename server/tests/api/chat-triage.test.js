import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';

// Fake AI: instant, deterministic answers instead of a 20-second model call.
vi.mock('../../src/ai/llmClient.js', () => ({
  llmClient: {
    chat: vi.fn().mockResolvedValue('{"urgency": "medium", "recommendation": "Rest and monitor."}'),
    embed: vi.fn().mockResolvedValue(Array(768).fill(0.1)),
    isAvailable: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../../src/queues/index.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueDocumentProcessing: vi.fn().mockResolvedValue({ id: 'job-2' }),
  documentQueue: {},
  notificationQueue: {},
}));

import { llmClient } from '../../src/ai/llmClient.js';
import { createApp } from '../../src/app.js';
import { NOT_ENOUGH_INFORMATION_MESSAGE } from '../../src/ai/ragChain.js';
import { DocumentChunk } from '../../src/models/index.js';
import { setupTestDB, teardownTestDB, registerUser, authHeader } from '../helpers.js';

const app = createApp();
let patient;

beforeAll(async () => {
  await setupTestDB();
  patient = await registerUser(app);
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/triage', () => {
  it('assesses symptoms and stores the result', async () => {
    const res = await request(app)
      .post('/api/triage')
      .set(authHeader(patient.token))
      .send({ symptoms: 'persistent cough for a week' });

    expect(res.status).toBe(200);
    expect(res.body.triage.urgency).toBe('medium');
    expect(res.body.triage.nextSteps.length).toBeGreaterThan(0);

    const history = await request(app).get('/api/triage/history').set(authHeader(patient.token));
    expect(history.body.triages.length).toBe(1);
    expect(history.body.triages[0].symptoms).toBe('persistent cough for a week');
  });

  it('rejects a request without symptoms', async () => {
    const res = await request(app).post('/api/triage').set(authHeader(patient.token)).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat', () => {
  it('declines when the patient has no relevant documents, and saves both sides to history', async () => {
    llmClient.chat.mockClear();

    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: 'I feel dehydrated, what should I do?' });

    expect(res.status).toBe(200);
    expect(res.body.response.declined).toBe(true);
    expect(res.body.response.text).toBe(NOT_ENOUGH_INFORMATION_MESSAGE);
    expect(res.body.response.sourceDocuments).toEqual([]);
    // No general-guidance call to the model when nothing relevant was found.
    expect(llmClient.chat).not.toHaveBeenCalled();

    const history = await request(app).get('/api/chat/history').set(authHeader(patient.token));
    expect(history.body.messages.length).toBe(2);
    expect(history.body.messages[0].sender).toBe('user');
    expect(history.body.messages[1].sender).toBe('bot');
  });

  it("answers from the patient's own documents when they are relevant", async () => {
    // The mocked embedder returns the same vector for every text, so this chunk
    // is a perfect match (cosine similarity 1) for any question.
    await DocumentChunk.create({
      documentId: new mongoose.Types.ObjectId(),
      patientId: patient.user.id,
      chunkIndex: 0,
      text: 'Lab report: Cholesterol 242 mg/dL (high).',
      embedding: Array(768).fill(0.1),
      fileName: 'lab-report.pdf',
    });
    llmClient.chat
      .mockResolvedValueOnce('{"answerable": true}') // grounding check
      .mockResolvedValueOnce('Your cholesterol was 242 mg/dL, which is high.');

    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: 'What was my cholesterol?' });

    expect(res.status).toBe(200);
    expect(res.body.response.declined).toBe(false);
    expect(res.body.response.text).toBe('Your cholesterol was 242 mg/dL, which is high.');
    expect(res.body.response.sourceDocuments[0].fileName).toBe('lab-report.pdf');
    expect(res.body.response.declineReason).toBeUndefined();
  });

  it('declines when the closest document does not contain the answer (grounding check)', async () => {
    // The chunk from the previous test is still a perfect similarity match.
    llmClient.chat.mockClear();
    llmClient.chat.mockResolvedValueOnce('{"answerable": false}');

    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: 'What did my knee MRI show?' });

    expect(res.status).toBe(200);
    expect(res.body.response.declined).toBe(true);
    expect(res.body.response.declineReason).toBe('not-grounded');
    expect(res.body.response.text).toMatch(/not enough information in your documents/i);
    expect(res.body.response.sourceDocuments).toEqual([]);
    expect(llmClient.chat).toHaveBeenCalledTimes(1); // no answer was generated
  });

  it('rejects an empty message', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('clears chat history on request', async () => {
    const res = await request(app).delete('/api/chat/history').set(authHeader(patient.token));
    expect(res.status).toBe(200);

    const history = await request(app).get('/api/chat/history').set(authHeader(patient.token));
    expect(history.body.messages.length).toBe(0);
  });
});
