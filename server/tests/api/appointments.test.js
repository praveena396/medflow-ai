import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
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
  beforeEach(() => {
    enqueueNotification.mockClear();
  });

  it('books an appointment and queues confirmation + reminder', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ doctorId: doctor.userId, dateTime: slot(0), reason: 'Annual checkup' });

    expect(res.status).toBe(201);
    expect(res.body.appointment.status).toBe('scheduled');
    // One immediate confirmation + one delayed reminder.
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
    const types = enqueueNotification.mock.calls.map(([payload]) => payload.type);
    expect(types).toContain('appointment-confirmation');
    expect(types).toContain('appointment-reminder');
    // This patient has no phone number, so no SMS is queued.
    expect(types).not.toContain('sms');
  });

  it('also queues an SMS reminder when the patient has a phone number', async () => {
    const withPhone = await registerUser(app, { phone: '+15715550123' });
    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(withPhone.token))
      .send({ doctorId: doctor.userId, dateTime: slot(4), reason: 'Follow-up' });

    expect(res.status).toBe(201);
    expect(enqueueNotification).toHaveBeenCalledTimes(3);
    const calls = enqueueNotification.mock.calls;
    const sms = calls.find(([payload]) => payload.type === 'sms');
    const emailReminder = calls.find(([payload]) => payload.type === 'appointment-reminder');
    expect(sms[0].phoneNumber).toBe('+15715550123');
    expect(sms[0].message).toMatch(/reminder/i);
    // Sent at the same time as the email reminder.
    expect(sms[1]).toEqual(emailReminder[1]);
  });

  it('rejects a booking with missing fields', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ reason: 'no doctor or time' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid doctorId or a date in the past', async () => {
    const badDoctor = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({ doctorId: 'not-an-id', dateTime: slot(30), reason: 'Bad doctor id' });
    expect(badDoctor.status).toBe(400);

    const past = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({
        doctorId: doctor.userId,
        dateTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        reason: 'In the past',
      });
    expect(past.status).toBe(400);
    expect(past.body.message).toMatch(/future/);
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
      .send({ doctorId: doctor.userId, dateTime: slot(2), reason: 'To be cancelled' });

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

  it('returns 400 for a malformed appointment id', async () => {
    const res = await request(app)
      .delete('/api/appointments/not-an-id')
      .set(authHeader(patient.token));
    expect(res.status).toBe(400);
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

describe('double-booking guard', () => {
  let secondDoctor;
  let secondPatient;
  let firstId;

  const book = (user, body) =>
    request(app).post('/api/appointments').set(authHeader(user.token)).send({ reason: 'Visit', ...body });

  beforeAll(async () => {
    secondDoctor = await createStaffUser(app, 'doctor');
    secondPatient = await registerUser(app);
    const res = await book(patient, { doctorId: doctor.userId, dateTime: slot(20) });
    expect(res.status).toBe(201);
    firstId = res.body.appointment._id;
  });

  it('rejects a booking that starts inside an existing appointment', async () => {
    const res = await book(secondPatient, { doctorId: doctor.userId, dateTime: slot(20, 15) });
    expect(res.status).toBe(409);
  });

  it('rejects a booking that starts earlier but runs into an existing appointment', async () => {
    const res = await book(secondPatient, { doctorId: doctor.userId, dateTime: slot(19, 45) });
    expect(res.status).toBe(409);
  });

  it('allows a back-to-back booking that starts when the previous one ends', async () => {
    const res = await book(secondPatient, { doctorId: doctor.userId, dateTime: slot(20, 30) });
    expect(res.status).toBe(201);
  });

  it('allows another doctor at the same time', async () => {
    const res = await book(secondPatient, { doctorId: secondDoctor.userId, dateTime: slot(20) });
    expect(res.status).toBe(201);
  });

  it('rejects rescheduling into a slot the doctor already has booked', async () => {
    const created = await book(secondPatient, { doctorId: doctor.userId, dateTime: slot(23) });
    expect(created.status).toBe(201);
    const res = await request(app)
      .patch(`/api/appointments/${created.body.appointment._id}`)
      .set(authHeader(secondPatient.token))
      .send({ dateTime: slot(20, 10) });
    expect(res.status).toBe(409);
  });

  it('does not treat an appointment as conflicting with itself', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${firstId}`)
      .set(authHeader(patient.token))
      .send({ dateTime: slot(20, 0), reason: 'Same slot, new reason' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.reason).toBe('Same slot, new reason');
  });

  it('frees the slot once the appointment is cancelled', async () => {
    const cancelled = await request(app)
      .delete(`/api/appointments/${firstId}`)
      .set(authHeader(patient.token));
    expect(cancelled.status).toBe(200);
    const res = await book(secondPatient, { doctorId: doctor.userId, dateTime: slot(20) });
    expect(res.status).toBe(201);
  });
});
