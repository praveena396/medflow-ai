import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { AuditLog, AppendOnlyError } from '../../src/models/AuditLog.js';
import { diffFields } from '../../src/services/auditService.js';

// These run without a database: the append-only guards fire before Mongoose
// sends anything to MongoDB. The API tests cover writing and reading entries.
describe('AuditLog is append-only', () => {
  const id = new mongoose.Types.ObjectId();

  it.each([
    ['updateOne', () => AuditLog.updateOne({ _id: id }, { action: 'x' })],
    ['updateMany', () => AuditLog.updateMany({}, { action: 'x' })],
    ['findOneAndUpdate', () => AuditLog.findOneAndUpdate({ _id: id }, { action: 'x' })],
    ['findByIdAndUpdate', () => AuditLog.findByIdAndUpdate(id, { action: 'x' })],
    ['replaceOne', () => AuditLog.replaceOne({ _id: id }, { action: 'x' })],
    ['findOneAndReplace', () => AuditLog.findOneAndReplace({ _id: id }, { action: 'x' })],
    ['deleteOne', () => AuditLog.deleteOne({ _id: id })],
    ['deleteMany', () => AuditLog.deleteMany({})],
    ['findOneAndDelete', () => AuditLog.findOneAndDelete({ _id: id })],
    ['findByIdAndDelete', () => AuditLog.findByIdAndDelete(id)],
  ])('rejects %s', async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(AppendOnlyError);
  });

  it('rejects re-saving or deleting an existing entry', async () => {
    const entry = AuditLog.hydrate({ _id: id, action: 'ai.triage', createdAt: new Date() });
    entry.action = 'tampered';
    await expect(entry.save()).rejects.toBeInstanceOf(AppendOnlyError);
    await expect(entry.deleteOne()).rejects.toBeInstanceOf(AppendOnlyError);
  });

  it('rejects bulkWrite', () => {
    expect(() => AuditLog.bulkWrite([{ deleteMany: { filter: {} } }])).toThrow(AppendOnlyError);
  });
});

describe('diffFields', () => {
  it('lists only the fields that changed', () => {
    expect(diffFields({ role: 'patient', isActive: true }, { role: 'doctor', isActive: true }, ['role', 'isActive'])).toEqual({
      role: { from: 'patient', to: 'doctor' },
    });
  });
});
