import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/ai/llmClient.js', () => ({
  llmClient: {
    chat: vi.fn().mockResolvedValue('{"urgency": "high", "recommendation": "See a doctor today."}'),
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
import { AuditLog, DocumentChunk } from '../../src/models/index.js';
import { AppendOnlyError } from '../../src/models/AuditLog.js';
import { setupTestDB, teardownTestDB, registerUser, createStaffUser, authHeader } from '../helpers.js';

const app = createApp();
let admin;
let doctor;
let patient;

const audit = (query = '') =>
  request(app).get(`/api/admin/audit${query}`).set(authHeader(admin.token));

beforeAll(async () => {
  await setupTestDB();
  admin = await createStaffUser(app, 'admin');
  doctor = await createStaffUser(app, 'doctor');
  patient = await registerUser(app);
});

afterAll(async () => {
  await teardownTestDB();
});

describe('AI outputs are audited', () => {
  it('records a declined chat answer', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set(authHeader(patient.token))
      .send({ message: 'What is my blood type?' });
    expect(res.body.response.declined).toBe(true);

    const log = await audit('?action=ai.chat.declined');
    expect(log.status).toBe(200);
    expect(log.body.total).toBe(1);
    const [entry] = log.body.entries;
    expect(entry.actorId._id).toBe(patient.user.id);
    expect(entry.actorRole).toBe('patient');
    expect(entry.details.question).toBe('What is my blood type?');
    expect(entry.details.answer).toMatch(/not enough information/i);
  });

  it('records an answered chat question with its sources', async () => {
    await DocumentChunk.create({
      documentId: new mongoose.Types.ObjectId(),
      patientId: patient.user.id,
      chunkIndex: 0,
      text: 'LDL 165 mg/dL',
      embedding: Array(768).fill(0.1),
      fileName: 'lipids.pdf',
    });
    llmClient.chat
      .mockResolvedValueOnce('{"answerable": true}') // grounding check
      .mockResolvedValueOnce('Your LDL was 165 mg/dL.');
    await request(app).post('/api/chat').set(authHeader(patient.token)).send({ message: 'My LDL?' });

    const log = await audit('?action=ai.chat.answer');
    expect(log.body.total).toBe(1);
    expect(log.body.entries[0].details).toMatchObject({
      question: 'My LDL?',
      answer: 'Your LDL was 165 mg/dL.',
      sources: ['lipids.pdf'],
    });
  });

  it('records triage results', async () => {
    const res = await request(app)
      .post('/api/triage')
      .set(authHeader(patient.token))
      .send({ symptoms: 'high fever for two days' });
    expect(res.status).toBe(200);

    const log = await audit('?action=ai.triage');
    expect(log.body.total).toBe(1);
    expect(log.body.entries[0].details).toMatchObject({ symptoms: 'high fever for two days', urgency: 'high' });
    expect(log.body.entries[0].targetId).toBe(res.body.triage.id);
  });

  it('filters by an action prefix', async () => {
    const log = await audit('?action=ai.*');
    expect(log.body.total).toBe(3);
    expect(log.body.entries.every((entry) => entry.action.startsWith('ai.'))).toBe(true);
  });
});

describe('admin actions are audited', () => {
  let appointmentId;

  beforeAll(async () => {
    const booked = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({
        doctorId: doctor.userId,
        dateTime: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
        reason: 'Audit check',
      });
    appointmentId = booked.body.appointment._id;
  });

  it('records appointment changes and cancellations made by an admin', async () => {
    await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(admin.token))
      .send({ reason: 'Audit check (edited)' });
    await request(app).delete(`/api/appointments/${appointmentId}`).set(authHeader(admin.token));

    const updates = await audit(`?action=admin.appointment.update&targetId=${appointmentId}`);
    expect(updates.body.entries[0].details.changes).toEqual({
      reason: { from: 'Audit check', to: 'Audit check (edited)' },
    });
    const cancels = await audit('?action=admin.appointment.cancel');
    expect(cancels.body.entries[0].details.changes.status).toEqual({ from: 'scheduled', to: 'cancelled' });
  });

  it("doesn't record patients' own appointment changes as admin actions", async () => {
    const log = await audit(`?action=admin.*&actorId=${patient.user.id}`);
    expect(log.body.total).toBe(0);
  });

  it('records CSV exports', async () => {
    const res = await request(app).get('/api/admin/export/appointments').set(authHeader(admin.token));
    expect(res.status).toBe(200);
    const log = await audit('?action=admin.export.appointments');
    expect(log.body.entries[0].details.rows).toBe(1);
  });

  it('records user changes, and a deactivated user can no longer log in', async () => {
    const victim = await registerUser(app);
    const res = await request(app)
      .patch(`/api/admin/users/${victim.user.id}`)
      .set(authHeader(admin.token))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);

    const log = await audit(`?action=admin.user.update&targetId=${victim.user.id}`);
    expect(log.body.entries[0].details.changes).toEqual({ isActive: { from: true, to: false } });

    const login = await request(app).post('/api/auth/login').send({
      email: victim.credentials.email,
      password: victim.credentials.password,
    });
    expect(login.status).toBe(403);
  });

  it("won't let an admin demote or deactivate themselves", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${admin.userId}`)
      .set(authHeader(admin.token))
      .send({ role: 'patient' });
    expect(res.status).toBe(400);
  });

  it('validates user changes', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${patient.user.id}`)
      .set(authHeader(admin.token))
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });
});

describe('reading the audit log', () => {
  it('is admin-only', async () => {
    expect((await request(app).get('/api/admin/audit').set(authHeader(patient.token))).status).toBe(403);
    expect((await request(app).get('/api/admin/audit').set(authHeader(doctor.token))).status).toBe(403);
  });

  it('pages newest first and validates filters', async () => {
    const page = await audit('?limit=2&page=1');
    expect(page.body.entries).toHaveLength(2);
    expect(page.body.total).toBeGreaterThan(2);
    const [first, second] = page.body.entries;
    expect(new Date(first.createdAt) >= new Date(second.createdAt)).toBe(true);

    expect((await audit('?action=DROP TABLE')).status).toBe(400);
    expect((await audit('?limit=1000')).status).toBe(400);
  });

  it('has no API to change or delete entries', async () => {
    const [entry] = (await audit('?limit=1')).body.entries;
    expect((await request(app).delete(`/api/admin/audit/${entry._id}`).set(authHeader(admin.token))).status).toBe(404);
    expect((await request(app).patch(`/api/admin/audit/${entry._id}`).set(authHeader(admin.token))).status).toBe(404);
  });

  it('refuses updates and deletes at the model level against the real database', async () => {
    const before = await AuditLog.countDocuments();
    await expect(AuditLog.deleteMany({})).rejects.toBeInstanceOf(AppendOnlyError);
    await expect(AuditLog.updateMany({}, { action: 'tampered' })).rejects.toBeInstanceOf(AppendOnlyError);
    expect(await AuditLog.countDocuments()).toBe(before);
    expect(await AuditLog.countDocuments({ action: 'tampered' })).toBe(0);
  });
});
