import mongoose from 'mongoose';

const chatHistorySchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    messages: [
      {
        sender: {
          type: String,
          enum: ['user', 'bot'],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        sourceDocument: String, // Reference to document used for RAG response
        confidence: Number, // Confidence score of retrieval
      },
    ],
    sessionStarted: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

chatHistorySchema.index({ patientId: 1, createdAt: -1 });

export const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);
