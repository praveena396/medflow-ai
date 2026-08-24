import mongoose from 'mongoose';

// One searchable chunk of an uploaded medical document, with its embedding.
const documentChunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicalDocument',
      required: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
      select: false, // large array — only fetch when explicitly asked for
    },
    fileName: String,
  },
  { timestamps: true }
);

documentChunkSchema.index({ patientId: 1 });
documentChunkSchema.index({ documentId: 1 });

export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
