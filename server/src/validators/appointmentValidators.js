import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'];

const futureDateTime = (field) =>
  field
    .isISO8601()
    .withMessage('dateTime must be an ISO 8601 date, e.g. 2026-10-20T14:30:00Z')
    .bail()
    .custom((value) => new Date(value).getTime() > Date.now())
    .withMessage('dateTime must be in the future');

const reason = (field) =>
  field
    .isString()
    .withMessage('reason must be text')
    .bail()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('reason must be between 1 and 500 characters');

const appointmentId = () => param('id').isMongoId().withMessage('Appointment id is not valid');

export const validateCreateAppointment = validate([
  body('doctorId')
    .exists({ values: 'falsy' })
    .withMessage('doctorId is required')
    .bail()
    .isMongoId()
    .withMessage('doctorId is not valid'),
  futureDateTime(body('dateTime').exists({ values: 'falsy' }).withMessage('dateTime is required').bail()),
  reason(body('reason').exists({ values: 'falsy' }).withMessage('reason is required').bail()),
  body('duration')
    .optional()
    .isInt({ min: 5, max: 480 })
    .withMessage('duration must be a whole number of minutes between 5 and 480')
    .toInt(),
]);

export const validateUpdateAppointment = validate([
  appointmentId(),
  futureDateTime(body('dateTime').optional()),
  reason(body('reason').optional()),
  body('status')
    .optional()
    .isIn(APPOINTMENT_STATUSES)
    .withMessage(`status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`),
  // Visit notes saved to the health record when a doctor completes the appointment.
  body('notes').optional().isString().withMessage('notes must be text').bail().trim().isLength({ max: 4000 }),
]);

export const validateAppointmentId = validate([appointmentId()]);
