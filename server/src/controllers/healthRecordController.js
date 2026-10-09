import { Appointment, MedicalDocument, User } from '../models/index.js';
import {
  recordAccess,
  getOrCreateRecord,
  presentRecord,
} from '../services/healthRecordService.js';
import { recordAudit } from '../services/auditService.js';
import { logger } from '../utils/logger.js';

const isPatient = async (patientId) => Boolean(await User.exists({ _id: patientId, role: 'patient' }));

// GET /api/records/me — the signed-in patient's own record.
export const getMyRecord = async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ message: 'Only patients have a health record' });
    }
    const record = await getOrCreateRecord(req.user.userId);
    res.json({ record: await presentRecord(record) });
  } catch (error) {
    logger.error('Get my record error:', error.message);
    res.status(500).json({ message: 'Failed to fetch health record' });
  }
};

// GET /api/records/patients — the patients whose records this user may open:
// a doctor's patients (anyone they have an appointment with), or every
// patient for an admin.
export const listPatients = async (req, res) => {
  try {
    const { role, userId } = req.user;
    let filter;
    if (role === 'doctor') {
      const patientIds = await Appointment.distinct('patientId', { doctorId: userId });
      filter = { _id: { $in: patientIds }, role: 'patient' };
    } else if (role === 'admin') {
      filter = { role: 'patient' };
    } else {
      return res.status(403).json({ message: 'Only doctors and admins can list patients' });
    }
    const patients = await User.find(filter).select('name email phone').sort({ name: 1 }).limit(500);
    res.json({ patients });
  } catch (error) {
    logger.error('List patients error:', error.message);
    res.status(500).json({ message: 'Failed to fetch patients' });
  }
};

// GET /api/records/:patientId
export const getRecord = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!(await isPatient(patientId))) return res.status(404).json({ message: 'Patient not found' });

    const access = await recordAccess(req.user, patientId);
    if (!access.read) return res.status(403).json({ message: "You don't have access to this record" });

    const record = await getOrCreateRecord(patientId);
    res.json({ record: await presentRecord(record), canEdit: access.write });
  } catch (error) {
    logger.error('Get record error:', error.message);
    res.status(500).json({ message: 'Failed to fetch health record' });
  }
};

// PATCH /api/records/:patientId — replace allergies, medications and/or notes.
export const updateRecord = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!(await isPatient(patientId))) return res.status(404).json({ message: 'Patient not found' });

    const access = await recordAccess(req.user, patientId);
    if (!access.write) {
      return res.status(403).json({ message: "Only the patient's doctors can edit this record" });
    }

    const record = await getOrCreateRecord(patientId);
    const changed = [];
    for (const field of ['allergies', 'currentMedications', 'notes']) {
      if (req.body[field] !== undefined) {
        record[field] = req.body[field];
        changed.push(field);
      }
    }
    record.updatedBy = req.user.userId;
    await record.save();

    await recordAudit({
      req,
      action: 'record.update',
      targetType: 'health-record',
      targetId: record._id,
      details: { patientId, fields: changed },
    });

    res.json({ message: 'Health record updated', record: await presentRecord(record) });
  } catch (error) {
    logger.error('Update record error:', error.message);
    res.status(500).json({ message: 'Failed to update health record' });
  }
};

// POST /api/records/:patientId/visits — a doctor adds a visit note.
export const addVisit = async (req, res) => {
  try {
    const { patientId } = req.params;
    if (!(await isPatient(patientId))) return res.status(404).json({ message: 'Patient not found' });

    const access = await recordAccess(req.user, patientId);
    if (!access.write) {
      return res.status(403).json({ message: "Only the patient's doctors can add visits" });
    }

    const { date, reason, diagnosis, notes, appointmentId, documentIds = [] } = req.body;

    if (appointmentId) {
      const owned = await Appointment.exists({ _id: appointmentId, patientId });
      if (!owned) return res.status(400).json({ message: 'That appointment is not this patient’s' });
    }
    if (documentIds.length > 0) {
      const count = await MedicalDocument.countDocuments({ _id: { $in: documentIds }, patientId });
      if (count !== documentIds.length) {
        return res.status(400).json({ message: 'Every linked document must belong to this patient' });
      }
    }

    const record = await getOrCreateRecord(patientId);
    record.visits.push({
      date: date || new Date(),
      doctorId: req.user.userId,
      appointmentId,
      reason,
      diagnosis,
      notes,
      documentIds,
    });
    record.updatedBy = req.user.userId;
    await record.save();

    const visit = record.visits[record.visits.length - 1];
    await recordAudit({
      req,
      action: 'record.visit.add',
      targetType: 'health-record',
      targetId: record._id,
      details: { patientId, visitId: visit._id, appointmentId, documentIds },
    });

    res.status(201).json({ message: 'Visit added', record: await presentRecord(record) });
  } catch (error) {
    logger.error('Add visit error:', error.message);
    res.status(500).json({ message: 'Failed to add visit' });
  }
};
