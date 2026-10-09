import dotenv from 'dotenv';

dotenv.config();

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseTrustProxy = (value) => {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 5000),

  // Set when the API runs behind a proxy or load balancer (Render, Fly,
  // nginx) so req.ip and the per-IP rate limits see the real client:
  // a hop count ("1"), "true", or a list of trusted addresses.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // Run the BullMQ workers inside the API process instead of a separate
  // `npm run worker` process. Useful on hosts where a second process costs
  // extra (e.g. a single Render web service).
  runWorkersInProcess: process.env.RUN_WORKERS_IN_PROCESS === 'true',

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/medflow',

  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiry: process.env.JWT_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // The refresh token travels only in this httpOnly cookie, scoped to the
  // auth routes. SameSite=Strict works when the client and API share a site
  // (localhost:3000 -> localhost:5000); use 'none' (which requires Secure)
  // when they are on different sites, e.g. Vercel + Render.
  refreshCookie: {
    name: process.env.REFRESH_COOKIE_NAME || 'medflow_rt',
    secure: process.env.REFRESH_COOKIE_SECURE !== 'false',
    sameSite: (process.env.REFRESH_COOKIE_SAMESITE || 'strict').toLowerCase(),
    path: '/api/auth',
    domain: process.env.REFRESH_COOKIE_DOMAIN || undefined,
  },

  cors: {
    // Comma-separated list of allowed origins
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  redis: {
    // A full URL wins over host/port/password. Use rediss:// for TLS, which
    // hosted Redis such as Upstash requires.
    url: process.env.REDIS_URL || undefined,
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
    // Lifetime of S3 pre-signed download links, in seconds (15 minutes).
    downloadUrlExpirySeconds: num(process.env.DOWNLOAD_URL_EXPIRY_SECONDS, 15 * 60),
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION || 'ap-south-1',
      endpoint: process.env.S3_ENDPOINT || undefined, // set for MinIO / R2 / S3-compatible stores
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
