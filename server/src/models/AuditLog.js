import mongoose from 'mongoose';

// Append-only record of AI outputs and privileged actions. The app can only
// create and read entries: every update and delete path below throws, and no
// route exposes one. For tamper resistance against someone with database
// access, give the app's MongoDB user only find/insert on this collection.
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // e.g. ai.chat.answer, admin.user.update
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, enum: ['patient', 'doctor', 'admin', 'system'] },
    targetType: String, // e.g. user, appointment, chat, triage, health-record
    targetId: String,
    details: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export class AppendOnlyError extends Error {
  constructor(operation) {
    super(`Audit log entries are append-only: ${operation} is not allowed`);
    this.name = 'AppendOnlyError';
  }
}

const QUERY_WRITES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'findOneAndRemove',
  'replaceOne',
  'deleteOne',
  'deleteMany',
];
for (const operation of QUERY_WRITES) {
  auditLogSchema.pre(operation, { query: true, document: false }, function blockWrite() {
    throw new AppendOnlyError(operation);
  });
}

// Saving an entry that already exists would modify it.
auditLogSchema.pre('save', function blockResave() {
  if (!this.isNew) throw new AppendOnlyError('save of an existing entry');
});
auditLogSchema.pre('deleteOne', { document: true, query: false }, function blockDocDelete() {
  throw new AppendOnlyError('deleteOne');
});

// Model-level helpers that bypass middleware.
auditLogSchema.statics.bulkWrite = function blockBulkWrite() {
  throw new AppendOnlyError('bulkWrite');
};

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
