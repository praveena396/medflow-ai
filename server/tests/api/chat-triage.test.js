import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
  it('answers a message and saves both sides to history', async () => {
    llmClient.chat.mockResolvedValueOnce('You should drink plenty of water.');

    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: 'I feel dehydrated, what should I do?' });

    expect(res.status).toBe(200);
    expect(res.body.response.text).toBe('You should drink plenty of water.');

    const history = await request(app).get('/api/chat/history').set(authHeader(patient.token));
    expect(history.body.messages.length).toBe(2);
    expect(history.body.messages[0].sender).toBe('user');
    expect(history.body.messages[1].sender).toBe('bot');
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
