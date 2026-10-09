import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validate.js';

export const validateUpdateUser = validate([
  param('id').isMongoId().withMessage('User id is not valid'),
  body('role').optional().isIn(['patient', 'doctor', 'admin']).withMessage('role must be patient, doctor or admin'),
  body('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false'),
  body().custom((value) => value.role !== undefined || value.isActive !== undefined).withMessage('Nothing to change: send role and/or isActive'),
]);

export const validateAuditQuery = validate([
  query('action')
    .optional()
    .matches(/^[a-z][a-z.-]{0,80}\*?$/)
    .withMessage('action must look like ai.chat.answer, or a prefix such as ai.*'),
  query('actorId').optional().isMongoId().withMessage('actorId is not valid'),
  query('targetType').optional().isString().isLength({ max: 40 }),
  query('targetId').optional().isString().isLength({ max: 40 }),
  query('from').optional().isISO8601().withMessage('from must be a date'),
  query('to').optional().isISO8601().withMessage('to must be a date'),
  query('page').optional().isInt({ min: 1, max: 10000 }).withMessage('page must be 1 or more').toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be 1-200').toInt(),
]);
