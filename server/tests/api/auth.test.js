import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setupTestDB, teardownTestDB, registerUser, authHeader } from '../helpers.js';

const app = createApp();

beforeAll(async () => {
  await setupTestDB();
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns tokens', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alice',
      email: 'alice@medflow.test',
      password: 'Secret@123',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('alice@medflow.test');
    // The password must never appear in a response.
    expect(JSON.stringify(res.body)).not.toContain('Secret@123');
  });

  it('always assigns the patient role, even if another role is requested', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Sneaky',
      email: 'sneaky@medflow.test',
      password: 'Secret@123',
      role: 'admin',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('patient');
  });

  it('stores an optional phone number for SMS reminders', async () => {
    const { User } = await import('../../src/models/index.js');
    const res = await request(app).post('/api/auth/register').send({
      name: 'Phone User',
      email: 'phone@medflow.test',
      password: 'Secret@123',
      phone: '+15715550123',
    });
    expect(res.status).toBe(201);
    const stored = await User.findOne({ email: 'phone@medflow.test' });
    expect(stored.phone).toBe('+15715550123');
  });

  it('rejects a duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alice Again',
      email: 'alice@medflow.test',
      password: 'Secret@123',
    });
    expect(res.status).toBe(409);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@y.test' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid email or a short password', async () => {
    const badEmail = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob-at-medflow', password: 'Secret@123' });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.errors[0].field).toBe('email');

    const shortPassword = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@medflow.test', password: 'abc' });
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body.errors[0].field).toBe('password');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@medflow.test', password: 'Secret@123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@medflow.test', password: 'WrongPassword1' });
    expect(res.status).toBe(401);
  });

  it('matches the email case-insensitively', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Alice@MedFlow.test', password: 'Secret@123' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@medflow.test', password: 'Secret@123' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('exchanges a refresh token for new tokens', async () => {
    const { refreshToken } = await registerUser(app);
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it('rejects an invalid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'garbage' });
    expect(res.status).toBe(403);
  });
});

describe('protected routes', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/appointments');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(app).get('/api/appointments').set(authHeader('not-a-real-token'));
    expect(res.status).toBe(403);
  });

  it('accepts requests with a valid token', async () => {
    const { token } = await registerUser(app);
    const res = await request(app).get('/api/appointments').set(authHeader(token));
    expect(res.status).toBe(200);
  });
});
