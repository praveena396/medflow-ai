import mongoose from 'mongoose';

const medicalDocumentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    documentType: {
      type: String,
      enum: ['lab-report', 'prescription', 'medical-record', 'imaging', 'other'],
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    extractedText: String, // text from the PDF text layer, the .txt file, or OCR
    extractionMethod: {
      type: String,
      enum: ['pdf-text', 'text', 'ocr'],
    },
    ocrConfidence: Number, // tesseract mean confidence, 0-100 (images only)
    summary: String, // AI-generated summary
    uploadDate: {
      type: Date,
      default: Date.now,
    },
    isProcessed: {
      type: Boolean,
      default: false,
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    processingError: String,
    chunkCount: {
      type: Number,
      default: 0,
    },
    fileSize: Number,
    mimeType: String,
  },
  { timestamps: true }
);

medicalDocumentSchema.index({ patientId: 1 });
medicalDocumentSchema.index({ documentType: 1 });

export const MedicalDocument = mongoose.model(
  'MedicalDocument',
  medicalDocumentSchema
);
