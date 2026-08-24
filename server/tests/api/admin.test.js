import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/queues/index.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueDocumentProcessing: vi.fn().mockResolvedValue({ id: 'job-2' }),
  documentQueue: {},
  notificationQueue: {},
}));

import { createApp } from '../../src/app.js';
import { setupTestDB, teardownTestDB, registerUser, createStaffUser, authHeader } from '../helpers.js';

const app = createApp();
let admin;
let patient;
let doctor;

beforeAll(async () => {
  await setupTestDB();
  admin = await createStaffUser(app, 'admin');
  doctor = await createStaffUser(app, 'doctor');
  patient = await registerUser(app, { name: 'Findable Patient' });

  // Seed one appointment so stats/queue/export have data.
  await request(app)
    .post('/api/appointments')
    .set(authHeader(patient.token))
    .send({
      doctorId: doctor.userId,
      dateTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      reason: 'Admin test appointment',
    });
});

afterAll(async () => {
  await teardownTestDB();
});

describe('admin access control', () => {
  it('blocks patients from admin endpoints', async () => {
    const res = await request(app).get('/api/admin/stats').set(authHeader(patient.token));
    expect(res.status).toBe(403);
  });

  it('blocks unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/stats', () => {
  it('returns dashboard summary numbers', async () => {
    const res = await request(app).get('/api/admin/stats').set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.users.patient).toBeGreaterThanOrEqual(1);
    expect(res.body.users.admin).toBeGreaterThanOrEqual(1);
    expect(res.body.upcomingAppointments).toBeGreaterThanOrEqual(1);
    expect(res.body.database).toBe('up');
  });
});

describe('GET /api/admin/appointments', () => {
  it('returns the upcoming appointment queue with names', async () => {
    const res = await request(app).get('/api/admin/appointments').set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBeGreaterThanOrEqual(1);
    expect(res.body.appointments[0].patientId.name).toBeTruthy();
    expect(res.body.appointments[0].doctorId.name).toBeTruthy();
  });
});

describe('GET /api/admin/users', () => {
  it('searches users by name', async () => {
    const res = await request(app)
      .get('/api/admin/users?search=Findable')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(1);
    expect(res.body.users[0].name).toBe('Findable Patient');
    // Password hashes must never be exposed.
    expect(res.body.users[0].password).toBeUndefined();
  });
});

describe('GET /api/admin/export/appointments', () => {
  it('downloads a CSV with a header row', async () => {
    const res = await request(app)
      .get('/api/admin/export/appointments')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.split('\n');
    expect(lines[0]).toContain('Patient');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(res.text).toContain('Admin test appointment');
  });
});
