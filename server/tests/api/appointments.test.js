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
import { Appointment } from '../../src/models/index.js';

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

// Fixed future slots, counted in hours from a base three days ahead, so
// bookings made by different tests never fall on the same time.
const BASE_TIME = (() => {
  const base = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  base.setUTCMinutes(0, 0, 0);
  return base.getTime();
})();
const slot = (hours, minutes = 0) =>
  new Date(BASE_TIME + hours * 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();

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

describe('appointment ownership', () => {
  let otherPatient;
  let otherDoctor;
  let admin;
  let appointmentId;

  beforeAll(async () => {
    otherPatient = await registerUser(app);
    otherDoctor = await createStaffUser(app, 'doctor');
    admin = await createStaffUser(app, 'admin');

    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ doctorId: doctor.userId, dateTime: slot(10), reason: 'Ownership check' });
    appointmentId = res.body.appointment._id;
  });

  it('lets the patient who booked it update it', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(patient.token))
      .send({ reason: 'Ownership check (updated)' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.reason).toBe('Ownership check (updated)');
  });

  it('stops another patient from updating it', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(otherPatient.token))
      .send({ reason: 'Hijacked' });
    expect(res.status).toBe(403);
    const stored = await Appointment.findById(appointmentId);
    expect(stored.reason).toBe('Ownership check (updated)');
  });

  it('stops another patient from cancelling it', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .set(authHeader(otherPatient.token));
    expect(res.status).toBe(403);
    const stored = await Appointment.findById(appointmentId);
    expect(stored.status).toBe('scheduled');
  });

  it('stops a doctor who is not assigned to it from changing it', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(otherDoctor.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('lets the assigned doctor update it', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(doctor.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('completed');
  });

  it('lets an admin cancel any appointment', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('cancelled');
  });
});
