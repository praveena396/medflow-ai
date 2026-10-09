import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const allergySchema = new mongoose.Schema(
  {
    substance: { type: String, required: true, trim: true },
    reaction: { type: String, trim: true },
    severity: { type: String, enum: ['mild', 'moderate', 'severe', 'unknown'], default: 'unknown' },
  },
  { _id: false }
);

const medicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    dose: { type: String, trim: true },
    frequency: { type: String, trim: true },
  },
  { _id: false }
);

const visitSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    doctorId: { type: ObjectId, ref: 'User' },
    appointmentId: { type: ObjectId, ref: 'Appointment' },
    reason: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    notes: { type: String, trim: true },
    documentIds: [{ type: ObjectId, ref: 'MedicalDocument' }],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A lightweight electronic health record: one per patient.
const healthRecordSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'User', required: true, unique: true },
    allergies: [allergySchema],
    currentMedications: [medicationSchema],
    notes: { type: String, trim: true },
    visits: [visitSchema],
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const HealthRecord = mongoose.model('HealthRecord', healthRecordSchema);
