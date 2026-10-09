import { inject } from 'vitest';

// Runs before every test file, BEFORE the app code is imported.
// dotenv never overwrites variables that are already set, so these values
// win over anything in .env — keeping tests away from real data/services.
process.env.NODE_ENV = 'test';
// Chosen once in tests/globalSetup.js (MONGO_URI, an in-memory server, or localhost).
process.env.MONGO_URI = inject('mongoUri');
process.env.JWT_SECRET = 'test_jwt_secret_0123456789_0123456789_0123456789';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_9876543210_9876543210_98';
process.env.EMAIL_DRIVER = 'mock';
process.env.SMS_DRIVER = 'mock';
process.env.FILE_STORAGE_TYPE = 'local';
process.env.UPLOAD_DIR = './uploads-test';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.LOG_LEVEL = 'error';
