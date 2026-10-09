import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { validateRegister, validateLogin } from '../../src/validators/authValidators.js';
import {
  validateCreateAppointment,
  validateUpdateAppointment,
  validateAppointmentId,
} from '../../src/validators/appointmentValidators.js';
import { validateChatMessage, validateTriage } from '../../src/validators/aiValidators.js';

// A tiny app that runs only the validators and echoes back what reached the
// handler, so these tests need no database.
const app = express();
app.use(express.json());
const echo = (req, res) => res.json({ body: req.body, params: req.params });
app.post('/register', validateRegister, echo);
app.post('/login', validateLogin, echo);
app.post('/appointments', validateCreateAppointment, echo);
app.patch('/appointments/:id', validateUpdateAppointment, echo);
app.delete('/appointments/:id', validateAppointmentId, echo);

const DOCTOR_ID = '64b7f0c2a1b2c3d4e5f60718';
const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const oneDayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe('register validation', () => {
  const valid = { name: 'Alice', email: 'alice@medflow.test', password: 'Secret@123' };

  it('passes a valid body through, trimming the name and lowercasing the email', async () => {
    const res = await request(app)
      .post('/register')
      .send({ ...valid, name: '  Alice  ', email: ' Alice@MedFlow.TEST ' });
    expect(res.status).toBe(200);
    expect(res.body.body.name).toBe('Alice');
    expect(res.body.body.email).toBe('alice@medflow.test');
  });

  it.each([
    ['a missing name', { ...valid, name: undefined }, 'name', /name is required/i],
    ['an invalid email', { ...valid, email: 'not-an-email' }, 'email', /valid email/i],
    ['a short password', { ...valid, password: 'short' }, 'password', /8 and 128/],
    ['a non-string password', { ...valid, password: 12345678 }, 'password', /text/],
    ['a phone number without a country code', { ...valid, phone: '5715550123' }, 'phone', /international/],
  ])('rejects %s', async (_label, body, field, message) => {
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(res.body.errors.map((e) => e.field)).toContain(field);
  });

  it('accepts an E.164 phone number and treats an empty one as absent', async () => {
    const withPhone = await request(app).post('/register').send({ ...valid, phone: '+15715550123' });
    expect(withPhone.status).toBe(200);
    const empty = await request(app).post('/register').send({ ...valid, phone: '' });
    expect(empty.status).toBe(200);
  });
});

describe('login validation', () => {
  it('accepts any non-empty password (wrong passwords are the controller’s job)', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'alice@medflow.test', password: 'WrongPassword1' });
    expect(res.status).toBe(200);
  });

  it('rejects a missing password and an invalid email', async () => {
    const res = await request(app).post('/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field).sort()).toEqual(['email', 'password']);
  });
});

describe('appointment create validation', () => {
  const valid = () => ({ doctorId: DOCTOR_ID, dateTime: inOneDay(), reason: 'Checkup' });

  it('passes a valid body through and converts duration to a number', async () => {
    const res = await request(app).post('/appointments').send({ ...valid(), duration: '45' });
    expect(res.status).toBe(200);
    expect(res.body.body.duration).toBe(45);
  });

  it.each([
    ['an invalid doctorId', { doctorId: 'abc' }, 'doctorId'],
    ['a date that is not ISO 8601', { dateTime: 'next tuesday' }, 'dateTime'],
    ['a date in the past', { dateTime: oneDayAgo() }, 'dateTime'],
    ['an empty reason', { reason: '   ' }, 'reason'],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }, 'reason'],
    ['a duration out of range', { duration: 1000 }, 'duration'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app).post('/appointments').send({ ...valid(), ...override });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toContain(field);
  });
});

describe('appointment update and cancel validation', () => {
  it('allows a partial update', async () => {
    const res = await request(app).patch(`/appointments/${DOCTOR_ID}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown status', async () => {
    const res = await request(app).patch(`/appointments/${DOCTOR_ID}`).send({ status: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/status must be one of/);
  });

  it('rejects moving an appointment into the past', async () => {
    const res = await request(app)
      .patch(`/appointments/${DOCTOR_ID}`)
      .send({ dateTime: oneDayAgo() });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed appointment id', async () => {
    const res = await request(app).delete('/appointments/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });
});

describe('chat and triage validation', () => {
  const aiApp = express();
  aiApp.use(express.json());
  aiApp.post('/chat', validateChatMessage, (req, res) => res.json(req.body));
  aiApp.post('/triage', validateTriage, (req, res) => res.json(req.body));

  it('accepts a normal message and trims it', async () => {
    const res = await request(aiApp).post('/chat').send({ message: '  what was my LDL?  ' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('what was my LDL?');
  });

  it.each([
    ['an empty message', { message: '   ' }],
    ['a non-text message', { message: { $gt: '' } }],
    ['a message over 2000 characters', { message: 'x'.repeat(2001) }],
  ])('rejects %s', async (_label, body) => {
    const res = await request(aiApp).post('/chat').send(body);
    expect(res.status).toBe(400);
  });

  it('requires symptoms and limits the optional fields', async () => {
    expect((await request(aiApp).post('/triage').send({})).status).toBe(400);
    expect((await request(aiApp).post('/triage').send({ symptoms: 'cough', severity: 'x'.repeat(51) })).status).toBe(400);
    expect((await request(aiApp).post('/triage').send({ symptoms: 'cough', duration: '3 days' })).status).toBe(200);
  });
});
