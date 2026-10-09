import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/queues/index.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueDocumentProcessing: vi.fn().mockResolvedValue({ id: 'job-2' }),
  documentQueue: {},
  notificationQueue: {},
}));

import { createApp } from '../../src/app.js';
import { AuditLog, MedicalDocument, User } from '../../src/models/index.js';
import { setupTestDB, teardownTestDB, registerUser, createStaffUser, authHeader } from '../helpers.js';

const app = createApp();
let doctor;
let otherDoctor;
let admin;
let patient;
let otherPatient;
let appointmentId;
let documentId;
let otherPatientDocumentId;

const get = (user, path) => request(app).get(`/api/records${path}`).set(authHeader(user.token));
const patch = (user, path, body) =>
  request(app).patch(`/api/records${path}`).set(authHeader(user.token)).send(body);

beforeAll(async () => {
  await setupTestDB();
  doctor = await createStaffUser(app, 'doctor');
  otherDoctor = await createStaffUser(app, 'doctor');
  admin = await createStaffUser(app, 'admin');
  patient = await registerUser(app);
  otherPatient = await registerUser(app);

  // Allergies stored on the user before the record existed are carried over.
  await User.updateOne({ _id: otherPatient.user.id }, { allergies: ['latex'] });

  const booked = await request(app)
    .post('/api/appointments')
    .set(authHeader(patient.token))
    .send({
      doctorId: doctor.userId,
      dateTime: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      reason: 'Blood pressure review',
    });
  appointmentId = booked.body.appointment._id;

  const makeDoc = (patientId, fileName) =>
    MedicalDocument.create({
      patientId,
      documentType: 'lab-report',
      fileName,
      filePath: `documents/${fileName}`,
      mimeType: 'application/pdf',
      processingStatus: 'completed',
    });
  documentId = (await makeDoc(patient.user.id, 'bp-log.pdf'))._id.toString();
  otherPatientDocumentId = (await makeDoc(otherPatient.user.id, 'other.pdf'))._id.toString();
});

afterAll(async () => {
  await teardownTestDB();
});

describe('reading health records', () => {
  it("gives a patient their own record, with linked documents", async () => {
    const res = await get(patient, '/me');
    expect(res.status).toBe(200);
    expect(res.body.record.patient._id).toBe(patient.user.id);
    expect(res.body.record.allergies).toEqual([]);
    expect(res.body.record.documents.map((d) => d.fileName)).toEqual(['bp-log.pdf']);
  });

  it('only patients have /me', async () => {
    expect((await get(doctor, '/me')).status).toBe(403);
  });

  it("lets a patient read their own record by id but not someone else's", async () => {
    const own = await get(patient, `/${patient.user.id}`);
    expect(own.status).toBe(200);
    expect(own.body.canEdit).toBe(false);
    expect((await get(patient, `/${otherPatient.user.id}`)).status).toBe(403);
  });

  it("lets a doctor read their patients' records, but not other patients'", async () => {
    const res = await get(doctor, `/${patient.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(true);
    expect((await get(doctor, `/${otherPatient.user.id}`)).status).toBe(403);
    expect((await get(otherDoctor, `/${patient.user.id}`)).status).toBe(403);
  });

  it('lets an admin read any record, read-only', async () => {
    const res = await get(admin, `/${otherPatient.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.record.allergies).toEqual([{ substance: 'latex', severity: 'unknown' }]);
  });

  it('lists a doctor’s patients, every patient for an admin, and nothing for patients', async () => {
    const forDoctor = await get(doctor, '/patients');
    expect(forDoctor.body.patients.map((p) => p._id)).toEqual([patient.user.id]);
    const forAdmin = await get(admin, '/patients');
    expect(forAdmin.body.patients.map((p) => p._id).sort()).toEqual([patient.user.id, otherPatient.user.id].sort());
    expect((await get(patient, '/patients')).status).toBe(403);
  });

  it('returns 404 for a non-patient id and 400 for a malformed one', async () => {
    expect((await get(admin, `/${doctor.userId}`)).status).toBe(404);
    expect((await get(admin, '/not-an-id')).status).toBe(400);
  });
});

describe('editing health records', () => {
  const changes = {
    allergies: [{ substance: 'Penicillin', reaction: 'Hives', severity: 'severe' }],
    currentMedications: [{ name: 'Amlodipine', dose: '5 mg', frequency: 'once daily' }],
    notes: 'Home BP readings requested.',
  };

  it("lets the patient's doctor update allergies, medications and notes", async () => {
    const res = await patch(doctor, `/${patient.user.id}`, changes);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject(changes);

    const entry = await AuditLog.findOne({ action: 'record.update' }).lean();
    expect(entry.actorId.toString()).toBe(doctor.userId);
    expect(entry.details.fields).toEqual(['allergies', 'currentMedications', 'notes']);
  });

  it('does not let patients, admins or other doctors edit', async () => {
    expect((await patch(patient, `/${patient.user.id}`, { notes: 'x' })).status).toBe(403);
    expect((await patch(admin, `/${patient.user.id}`, { notes: 'x' })).status).toBe(403);
    expect((await patch(otherDoctor, `/${patient.user.id}`, { notes: 'x' })).status).toBe(403);
    expect((await get(patient, '/me')).body.record.notes).toBe(changes.notes);
  });

  it('validates the fields', async () => {
    expect((await patch(doctor, `/${patient.user.id}`, { allergies: [{ substance: 'Dust', severity: 'deadly' }] })).status).toBe(400);
    expect((await patch(doctor, `/${patient.user.id}`, { currentMedications: [{ dose: '5 mg' }] })).status).toBe(400);
    expect((await patch(doctor, `/${patient.user.id}`, {})).status).toBe(400);
  });
});

describe('visits', () => {
  it('lets a doctor add a visit that links the patient’s documents', async () => {
    const res = await request(app)
      .post(`/api/records/${patient.user.id}/visits`)
      .set(authHeader(doctor.token))
      .send({ reason: 'Follow-up call', diagnosis: 'Hypertension', documentIds: [documentId] });
    expect(res.status).toBe(201);
    const [visit] = res.body.record.visits;
    expect(visit).toMatchObject({ reason: 'Follow-up call', diagnosis: 'Hypertension', documentIds: [documentId] });
    expect(visit.doctorId.name).toBe(doctor.credentials.name);
  });

  it("refuses to link another patient's document", async () => {
    const res = await request(app)
      .post(`/api/records/${patient.user.id}/visits`)
      .set(authHeader(doctor.token))
      .send({ reason: 'x', documentIds: [otherPatientDocumentId] });
    expect(res.status).toBe(400);
  });

  it('adds a visit when the doctor marks the appointment completed, once', async () => {
    const done = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(doctor.token))
      .send({ status: 'completed', notes: 'BP 128/82, continue amlodipine.' });
    expect(done.status).toBe(200);
    expect(done.body.visitAdded).toBe(true);

    const again = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set(authHeader(doctor.token))
      .send({ status: 'completed' });
    expect(again.body.visitAdded).toBe(false);

    const { record } = (await get(patient, '/me')).body;
    const fromAppointment = record.visits.filter((v) => v.appointmentId === appointmentId);
    expect(fromAppointment).toHaveLength(1);
    expect(fromAppointment[0]).toMatchObject({ reason: 'Blood pressure review', notes: 'BP 128/82, continue amlodipine.' });
  });

  it("doesn't let a patient mark their own appointment completed", async () => {
    const booked = await request(app)
      .post('/api/appointments')
      .set(authHeader(patient.token))
      .send({
        doctorId: doctor.userId,
        dateTime: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
        reason: 'Second visit',
      });
    const res = await request(app)
      .patch(`/api/appointments/${booked.body.appointment._id}`)
      .set(authHeader(patient.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });
});
