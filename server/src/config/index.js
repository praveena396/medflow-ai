import dotenv from 'dotenv';

dotenv.config();

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 5000),

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/medflow',

  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiry: process.env.JWT_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  cors: {
    // Comma-separated list of allowed origins
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: num(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  llm: {
    // 'ollama' (local, free) or 'openai' — same chat-completion shape either way
    provider: process.env.LLM_PROVIDER || 'ollama',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    chatModel: process.env.LLM_CHAT_MODEL || 'llama3.2',
    embeddingModel: process.env.LLM_EMBEDDING_MODEL || 'nomic-embed-text',
    openaiApiKey: process.env.OPENAI_API_KEY,
    requestTimeoutMs: num(process.env.LLM_TIMEOUT_MS, 60000),
    similarityThreshold: num(process.env.RAG_SIMILARITY_THRESHOLD, 0.45),
  },

  storage: {
    // 'local' (dev) or 's3' (production / MinIO)
    driver: process.env.FILE_STORAGE_TYPE || 'local',
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    maxFileSizeBytes: num(process.env.MAX_FILE_SIZE, 10 * 1024 * 1024),
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION || 'ap-south-1',
      endpoint: process.env.S3_ENDPOINT, // set for MinIO / S3-compatible stores
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  },

  notifications: {
    // 'smtp' uses the SMTP_* vars; 'ethereal' auto-creates a free test inbox; 'mock' logs only
    emailDriver: process.env.EMAIL_DRIVER || 'ethereal',
    smtp: {
      host: process.env.SMTP_HOST,
      port: num(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.EMAIL_FROM || 'MedFlow AI <no-reply@medflow.local>',
    },
    // 'twilio' requires the TWILIO_* vars; 'mock' logs only
    smsDriver: process.env.SMS_DRIVER || 'mock',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phone: process.env.TWILIO_PHONE,
    },
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 300),
    authWindowMs: num(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authMax: num(process.env.AUTH_RATE_LIMIT_MAX, 20),
    // Per signed-in user (not per IP) on /api/chat and /api/triage.
    aiWindowMs: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    aiMax: num(process.env.AI_RATE_LIMIT_MAX, 20),
  },

  documents: {
    chunkSizeWords: num(process.env.DOC_CHUNK_SIZE_WORDS, 500),
    chunkOverlapWords: num(process.env.DOC_CHUNK_OVERLAP_WORDS, 50),
    // PDFs with a text layer, plain text, and images (read with OCR in the worker).
    allowedMimeTypes: ['application/pdf', 'text/plain', 'image/png', 'image/jpeg'],
  },
};

export default config;
