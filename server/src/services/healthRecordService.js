import { Appointment, HealthRecord, MedicalDocument, User } from '../models/index.js';

// A doctor may see and edit a patient's record once they share an appointment.
export const isDoctorOfPatient = async (doctorId, patientId) =>
  Boolean(await Appointment.exists({ doctorId, patientId }));

// Who may do what with a patient's record:
//   patient: read their own        doctor: read + edit their patients'
//   admin:   read any
export const recordAccess = async (user, patientId) => {
  if (user.role === 'admin') return { read: true, write: false };
  if (user.role === 'patient') return { read: user.userId === String(patientId), write: false };
  if (user.role === 'doctor') {
    const related = await isDoctorOfPatient(user.userId, patientId);
    return { read: related, write: related };
  }
  return { read: false, write: false };
};

// Fetch the record, creating it on first use. Allergies and medications
// already stored as plain strings on the User are carried over once.
export const getOrCreateRecord = async (patientId) => {
  const existing = await HealthRecord.findOne({ patientId });
  if (existing) return existing;

  const patient = await User.findById(patientId).select('allergies currentMedications');
  try {
    return await HealthRecord.create({
      patientId,
      allergies: (patient?.allergies || []).map((substance) => ({ substance })),
      currentMedications: (patient?.currentMedications || []).map((name) => ({ name })),
    });
  } catch (error) {
    // Another request created it first (unique patientId).
    if (error.code === 11000) return HealthRecord.findOne({ patientId });
    throw error;
  }
};

// The record as the API returns it: patient details, newest visits first
// with doctor names, and references to every document the patient uploaded.
export const presentRecord = async (record) => {
  const patientId = record.patientId?._id ?? record.patientId;
  await record.populate([
    { path: 'patientId', select: 'name email phone dateOfBirth' },
    { path: 'visits.doctorId', select: 'name email' },
  ]);
  const documents = await MedicalDocument.find({ patientId })
    .select('fileName documentType uploadDate processingStatus summary mimeType')
    .sort({ uploadDate: -1 })
    .lean();

  const json = record.toObject();
  return {
    id: json._id,
    patient: json.patientId || { _id: patientId },
    allergies: json.allergies,
    currentMedications: json.currentMedications,
    notes: json.notes,
    visits: [...json.visits].sort((a, b) => new Date(b.date) - new Date(a.date)),
    documents,
    updatedAt: json.updatedAt,
  };
};

// Add a visit for a completed appointment (once per appointment).
export const addVisitFromAppointment = async (appointment, notes) => {
  const record = await getOrCreateRecord(appointment.patientId);
  const already = record.visits.some(
    (visit) => visit.appointmentId && String(visit.appointmentId) === String(appointment._id)
  );
  if (already) return { record, added: false };

  record.visits.push({
    date: appointment.dateTime,
    doctorId: appointment.doctorId,
    appointmentId: appointment._id,
    reason: appointment.reason,
    notes,
  });
  await record.save();
  return { record, added: true };
};
