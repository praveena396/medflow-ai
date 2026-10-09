import { config } from './index.js';
import { logger } from '../utils/logger.js';

// Fail fast on missing/unsafe configuration instead of failing mid-request.
export const validateEnv = () => {
  const errors = [];
  const warnings = [];

  if (!config.jwt.secret) errors.push('JWT_SECRET is required');
  if (!config.jwt.refreshSecret) errors.push('JWT_REFRESH_SECRET is required');
  if (config.jwt.secret && config.jwt.secret.length < 32) {
    warnings.push('JWT_SECRET should be at least 32 characters');
  }
  if (config.jwt.secret && config.jwt.secret === config.jwt.refreshSecret) {
    errors.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
  }

  if (!config.mongoUri) errors.push('MONGO_URI is required');

  if (!['strict', 'lax', 'none'].includes(config.refreshCookie.sameSite)) {
    errors.push('REFRESH_COOKIE_SAMESITE must be strict, lax or none');
  }
  if (config.refreshCookie.sameSite === 'none' && !config.refreshCookie.secure) {
    errors.push('REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true (browsers reject it otherwise)');
  }
  if (config.isProduction && !config.refreshCookie.secure) {
    warnings.push('REFRESH_COOKIE_SECURE=false sends the refresh cookie over plain HTTP; use it only for local development');
  }

  if (config.llm.provider === 'openai' && !config.llm.openaiApiKey) {
    errors.push('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  }

  if (!['mongo', 'chroma'].includes(config.vectorStore.driver)) {
    errors.push('VECTOR_STORE must be mongo or chroma');
  }
  if (config.vectorStore.driver === 'chroma') {
    try {
      const { protocol } = new URL(config.vectorStore.chroma.url);
      if (!['http:', 'https:'].includes(protocol)) throw new Error('bad protocol');
    } catch {
      errors.push('CHROMA_URL must be an http(s) URL, e.g. http://localhost:8000');
    }
  }

  if (config.storage.driver === 's3') {
    if (!config.storage.s3.bucket) errors.push('S3_BUCKET is required when FILE_STORAGE_TYPE=s3');
    if (!config.storage.s3.accessKeyId) errors.push('S3_ACCESS_KEY_ID is required when FILE_STORAGE_TYPE=s3');
    if (!config.storage.s3.secretAccessKey) errors.push('S3_SECRET_ACCESS_KEY is required when FILE_STORAGE_TYPE=s3');
  }

  if (config.notifications.emailDriver === 'smtp') {
    if (!config.notifications.smtp.host) errors.push('SMTP_HOST is required when EMAIL_DRIVER=smtp');
    if (!config.notifications.smtp.user) errors.push('SMTP_USER is required when EMAIL_DRIVER=smtp');
    if (!config.notifications.smtp.pass) errors.push('SMTP_PASS is required when EMAIL_DRIVER=smtp');
  }

  if (config.notifications.smsDriver === 'twilio') {
    const { accountSid, authToken, phone } = config.notifications.twilio;
    if (!accountSid || !authToken || !phone) {
      errors.push('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE are required when SMS_DRIVER=twilio');
    }
  }

  if (config.isProduction) {
    if (config.notifications.emailDriver !== 'smtp') {
      warnings.push('EMAIL_DRIVER should be smtp in production');
    }
    if (config.storage.driver === 'local') {
      warnings.push('FILE_STORAGE_TYPE=local is not recommended in production');
    }
  }

  warnings.forEach((warning) => logger.warn(`⚠️  Config warning: ${warning}`));

  if (errors.length > 0) {
    errors.forEach((error) => logger.error(`❌ Config error: ${error}`));
    throw new Error(`Invalid configuration: ${errors.join('; ')}`);
  }

  logger.info('✅ Environment configuration validated');
};
