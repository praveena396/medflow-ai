import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { DEFAULT_MAX_LENGTH } from '../ai/sanitize.js';

const requiredText = (field, label) =>
  body(field)
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ max: DEFAULT_MAX_LENGTH })
    .withMessage(`${label} must be at most ${DEFAULT_MAX_LENGTH} characters`);

export const validateChatMessage = validate([requiredText('message', 'Message')]);

export const validateTriage = validate([
  requiredText('symptoms', 'Symptoms'),
  body('duration').optional().isString().trim().isLength({ max: 100 }).withMessage('duration is too long'),
  body('severity').optional().isString().trim().isLength({ max: 50 }).withMessage('severity is too long'),
]);
