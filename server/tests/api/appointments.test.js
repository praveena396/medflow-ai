import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Queue jobs go to Redis in production; in tests we just record the calls.
vi.mock('../../src/queues/index.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueDocumentProcessing: vi.fn().mockResolvedValue({ id: 'job-2' }),
  documentQueue: {},
  notificationQueue: {},
}));

import { enqueueNotification } from '../../src/queues/index.js';
import { createApp } from '../../src/app.js';
import { setupTestDB, teardownTestDB, registerUser, createStaffUser, authHeader } from '../helpers.js';

const app = createApp();
let patient;
let doctor;

beforeAll(async () => {
  await setupTestDB();
  patient = await registerUser(app);
  doctor = await createStaffUser(app, 'doctor');
});

afterAll(async () => {
  await teardownTestDB();
});

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();

describe('GET /api/appointments/doctors', () => {
  it('lists available doctors', async () => {
    const res = await request(app).get('/api/appointments/doctors').set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.body.doctors.some((d) => d._id === doctor.userId)).toBe(true);
  });
});

describe('POST /api/appointments', () => {
  it('books an appointment and queues confirmation + reminder', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ doctorId: doctor.userId, dateTime: tomorrow(), reason: 'Annual checkup' });

    expect(res.status).toBe(201);
    expect(res.body.appointment.status).toBe('scheduled');
    // One immediate confirmation + one delayed reminder.
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
    const types = enqueueNotification.mock.calls.map(([payload]) => payload.type);
    expect(types).toContain('appointment-confirmation');
    expect(types).toContain('appointment-reminder');
  });

  it('rejects a booking with missing fields', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ reason: 'no doctor or time' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/appointments', () => {
  it('lists the patient’s appointments', async () => {
    const res = await request(app).get('/api/appointments').set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBeGreaterThan(0);
    expect(res.body.appointments[0].reason).toBe('Annual checkup');
  });
});

describe('DELETE /api/appointments/:id', () => {
  it('cancels an appointment', async () => {
    const created = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ doctorId: doctor.userId, dateTime: tomorrow(), reason: 'To be cancelled' });

    const res = await request(app)
      .delete(`/api/appointments/${created.body.appointment._id}`)
      .set(authHeader(patient.token));

    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('cancelled');
  });

  it('returns 404 for a nonexistent appointment', async () => {
    const res = await request(app)
      .delete('/api/appointments/64b000000000000000000000')
      .set(authHeader(patient.token));
    expect(res.status).toBe(404);
  });
});
