import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createUserRateLimiter } from '../../src/middleware/rateLimiter.js';
import { createApp } from '../../src/app.js';
import { setupTestDB, teardownTestDB, registerUser, authHeader } from '../helpers.js';

// Needs Redis: the limiter keeps its counters there, like in production.
describe('per-user rate limiter', () => {
  const limitedApp = express();
  limitedApp.get(
    '/ai',
    (req, res, next) => {
      req.user = { userId: req.get('x-user'), role: 'patient' };
      next();
    },
    createUserRateLimiter({ max: 3, windowMs: 60 * 1000, prefix: `rl:test:${Date.now()}:` }),
    (req, res) => res.json({ ok: true })
  );

  it('allows the limit, then returns 429 for that user only', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(limitedApp).get('/ai').set('x-user', 'alice');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-remaining']).toBe(String(2 - i));
    }

    const blocked = await request(limitedApp).get('/ai').set('x-user', 'alice');
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/too many ai requests/i);

    // Same IP, different user: still allowed.
    const other = await request(limitedApp).get('/ai').set('x-user', 'bob');
    expect(other.status).toBe(200);
  });
});

describe('AI routes use the per-user limiter', () => {
  const app = createApp();
  let patient;

  beforeAll(async () => {
    await setupTestDB();
    patient = await registerUser(app);
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it.each(['/api/chat/history', '/api/triage/history'])('%s reports the AI limit', async (path) => {
    const res = await request(app).get(path).set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('99999');
  });

  it('other routes keep the general per-IP limit', async () => {
    const res = await request(app).get('/api/appointments').set(authHeader(patient.token));
    expect(res.headers['ratelimit-limit']).toBe('100000');
  });
});
