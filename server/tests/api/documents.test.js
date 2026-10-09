import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';

vi.mock('../../src/queues/index.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueDocumentProcessing: vi.fn().mockResolvedValue({ id: 'job-2' }),
  documentQueue: {},
  notificationQueue: {},
}));

import { enqueueDocumentProcessing } from '../../src/queues/index.js';
import { createApp } from '../../src/app.js';
import { setupTestDB, teardownTestDB, registerUser, createStaffUser, authHeader } from '../helpers.js';

const app = createApp();
let patient;
let otherPatient;
let imagePatient;
let documentId;
let doctor;
let otherDoctor;
let admin;

beforeAll(async () => {
  await setupTestDB();
  patient = await registerUser(app);
  otherPatient = await registerUser(app);
  imagePatient = await registerUser(app);
  doctor = await createStaffUser(app, 'doctor');
  otherDoctor = await createStaffUser(app, 'doctor');
  admin = await createStaffUser(app, 'admin');
  // The doctor becomes "the patient's doctor" by sharing an appointment.
  await request(app)
    .post('/api/appointments')
    .set(authHeader(patient.token))
    .send({
      doctorId: doctor.userId,
      dateTime: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
      reason: 'Review lab results',
    });
});

afterAll(async () => {
  await teardownTestDB();
  // Remove files written by the local storage driver during tests.
  fs.rmSync('./uploads-test', { recursive: true, force: true });
});

describe('POST /api/documents', () => {
  it('accepts a text file and queues background processing', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(patient.token))
      .field('documentType', 'lab-report')
      .attach('file', Buffer.from('Cholesterol: 242 mg/dL. LDL: 165 mg/dL.'), {
        filename: 'lab.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(201);
    expect(res.body.document.processingStatus).toBe('pending');
    documentId = res.body.document.id;
    expect(enqueueDocumentProcessing).toHaveBeenCalledWith(documentId);
  });

  it('rejects a request without a file', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(patient.token))
      .field('documentType', 'other');
    expect(res.status).toBe(400);
  });

  it('rejects a disallowed file type', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(patient.token))
      .attach('file', Buffer.from('MZfake-executable'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      });
    expect(res.status).toBe(400);
  });

  it('accepts PNG and JPEG images for OCR and queues processing', async () => {
    for (const [filename, contentType] of [
      ['lab-scan.png', 'image/png'],
      ['prescription.jpg', 'image/jpeg'],
    ]) {
      const res = await request(app)
        .post('/api/documents')
        .set(authHeader(imagePatient.token))
        .field('documentType', 'prescription')
        .attach('file', Buffer.from('image-bytes'), { filename, contentType });
      expect(res.status).toBe(201);
      expect(enqueueDocumentProcessing).toHaveBeenCalledWith(res.body.document.id);
    }
  });
});

describe('GET /api/documents', () => {
  it('lists the patient’s own documents without the bulky extracted text', async () => {
    const res = await request(app).get('/api/documents').set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBe(1);
    expect(res.body.documents[0].extractedText).toBeUndefined();
  });

  it('does not show another patient’s documents', async () => {
    const res = await request(app).get('/api/documents').set(authHeader(otherPatient.token));
    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBe(0);
  });
});

describe('GET /api/documents/:id/status', () => {
  it('returns the processing status to the owner', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/status`)
      .set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns 404 for another user (no information leak)', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/status`)
      .set(authHeader(otherPatient.token));
    expect(res.status).toBe(404);
  });
});

describe('downloading documents (local storage)', () => {
  it('points the owner to the authenticated file route', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/download`)
      .set(authHeader(patient.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'local', url: `/api/documents/${documentId}/file` });
  });

  it('streams the file with its original name to the owner', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/file`)
      .set(authHeader(patient.token))
      .buffer(true)
      .parse((response, done) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => done(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="lab.txt"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toBe('Cholesterol: 242 mg/dL. LDL: 165 mg/dL.');
  });

  it("lets the patient's doctor and an admin open it", async () => {
    for (const user of [doctor, admin]) {
      const res = await request(app).get(`/api/documents/${documentId}/file`).set(authHeader(user.token));
      expect(res.status).toBe(200);
    }
  });

  it('hides it from other patients, unrelated doctors and anonymous users', async () => {
    for (const user of [otherPatient, otherDoctor]) {
      const res = await request(app).get(`/api/documents/${documentId}/download`).set(authHeader(user.token));
      expect(res.status).toBe(404);
    }
    expect((await request(app).get(`/api/documents/${documentId}/file`)).status).toBe(401);
    expect((await request(app).get('/api/documents/not-an-id/file').set(authHeader(patient.token))).status).toBe(400);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('prevents deleting someone else’s document', async () => {
    const res = await request(app)
      .delete(`/api/documents/${documentId}`)
      .set(authHeader(otherPatient.token));
    expect(res.status).toBe(404);
  });

  it('deletes the owner’s document', async () => {
    const res = await request(app)
      .delete(`/api/documents/${documentId}`)
      .set(authHeader(patient.token));
    expect(res.status).toBe(200);

    const list = await request(app).get('/api/documents').set(authHeader(patient.token));
    expect(list.body.documents.length).toBe(0);
  });
});
