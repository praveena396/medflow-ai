import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

const MAX_STRING = 4000;

// Keep entries a bounded size: long strings (AI answers, symptoms) are cut.
const trimDetails = (value, depth = 0) => {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => trimDetails(item, depth + 1));
  if (value && typeof value === 'object' && depth < 4 && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimDetails(item, depth + 1)]));
  }
  return value;
};

// Record one audit entry. Never throws: a logging failure must not break the
// request it describes, but it is logged as an error.
export const recordAudit = async ({ req, action, targetType, targetId, details, actor }) => {
  try {
    const who = actor || req?.user;
    await AuditLog.create({
      action,
      actorId: who?.userId,
      actorRole: who?.role || 'system',
      targetType,
      targetId: targetId === undefined || targetId === null ? undefined : String(targetId),
      details: trimDetails(details),
      ip: req?.ip,
    });
  } catch (error) {
    logger.error(`Audit log write failed (${action}): ${error.message}`);
  }
};

// Field-by-field diff of the keys in `changes`, for "what did the admin change".
export const diffFields = (before, after, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => String(before[key]) !== String(after[key]))
      .map((key) => [key, { from: before[key], to: after[key] }])
  );
