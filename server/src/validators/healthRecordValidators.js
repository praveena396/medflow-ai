import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';

const patientId = () => param('patientId').isMongoId().withMessage('Patient id is not valid');
const text = (field, max) =>
  body(field).optional({ values: 'null' }).isString().withMessage(`${field} must be text`).bail().trim().isLength({ max }).withMessage(`${field} must be at most ${max} characters`);

export const validatePatientId = validate([patientId()]);

export const validateUpdateRecord = validate([
  patientId(),
  body('allergies').optional().isArray({ max: 50 }).withMessage('allergies must be a list (at most 50)'),
  body('allergies.*.substance').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Each allergy needs a substance (1-100 characters)'),
  text('allergies.*.reaction', 200),
  body('allergies.*.severity').optional().isIn(['mild', 'moderate', 'severe', 'unknown']).withMessage('severity must be mild, moderate, severe or unknown'),
  body('currentMedications').optional().isArray({ max: 50 }).withMessage('currentMedications must be a list (at most 50)'),
  body('currentMedications.*.name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Each medication needs a name (1-100 characters)'),
  text('currentMedications.*.dose', 100),
  text('currentMedications.*.frequency', 100),
  text('notes', 4000),
  body().custom((value) => ['allergies', 'currentMedications', 'notes'].some((key) => value[key] !== undefined)).withMessage('Nothing to change: send allergies, currentMedications and/or notes'),
]);

export const validateAddVisit = validate([
  patientId(),
  body('date').optional().isISO8601().withMessage('date must be an ISO 8601 date'),
  body('reason').isString().withMessage('reason is required').bail().trim().isLength({ min: 1, max: 500 }).withMessage('reason must be 1-500 characters'),
  text('diagnosis', 500),
  text('notes', 4000),
  body('appointmentId').optional().isMongoId().withMessage('appointmentId is not valid'),
  body('documentIds').optional().isArray({ max: 20 }).withMessage('documentIds must be a list (at most 20)'),
  body('documentIds.*').isMongoId().withMessage('Each document id must be valid'),
]);
