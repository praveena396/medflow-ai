import { validationResult } from 'express-validator';

// Run a list of express-validator rules, then stop the request with a 400 if
// any failed. `message` is the first problem (the client shows it as-is);
// `errors` lists every field that failed.
export const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    const errors = result.array({ onlyFirstError: true }).map((error) => ({
      field: error.path,
      message: error.msg,
    }));
    return res.status(400).json({ message: errors[0].message, errors });
  },
];
