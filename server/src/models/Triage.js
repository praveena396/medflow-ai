import mongoose from 'mongoose';

const triageSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    symptoms: {
      type: String,
      required: true,
    },
    duration: String,
    severity: String,
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
    },
    recommendation: String,
    nextSteps: [String],
  },
  { timestamps: true }
);

triageSchema.index({ patientId: 1, createdAt: -1 });

export const Triage = mongoose.model('Triage', triageSchema);
