import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';

const email = () =>
  body('email')
    .exists({ values: 'falsy' })
    .withMessage('Email is required')
    .bail()
    .isString()
    .trim()
    .isEmail()
    .withMessage('Email must be a valid email address')
    .bail()
    // Stored emails are lowercase (see the User model), so match that here.
    .toLowerCase();

export const validateRegister = validate([
  body('name')
    .exists({ values: 'falsy' })
    .withMessage('Name is required')
    .bail()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  email(),
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Password must be text')
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters'),
  // Optional; used for SMS appointment reminders. E.164 format, e.g. +15715550123.
  body('phone')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .matches(/^\+[1-9]\d{7,14}$/)
    .withMessage('Phone must be in international format, e.g. +15715550123'),
]);

export const validateLogin = validate([
  email(),
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('Password is required')
    .bail()
    .isString()
    .withMessage('Password must be text'),
]);
