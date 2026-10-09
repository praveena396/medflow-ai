import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { config } from './config/index.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';
import { llmClient } from './ai/llmClient.js';
import { apiLimiter, authLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/authRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import triageRoutes from './routes/triageRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import healthRecordRoutes from './routes/healthRecordRoutes.js';

// Builds the Express app without connecting to the database or listening on
// a port — so tests can exercise it in memory and index.js can start it.
export const createApp = () => {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // Middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
    })
  );
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(cookieParser());

  // Health Check — reports the real status of every dependency.
  app.get('/health', async (req, res) => {
    const [redisOk, llmOk] = await Promise.all([
      redis
        .ping()
        .then(() => true)
        .catch(() => false),
      llmClient.isAvailable(),
    ]);

    const services = {
      database: mongoose.connection.readyState === 1 ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      llm: llmOk ? 'up' : 'down',
    };
    const healthy = Object.values(services).every((status) => status === 'up');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'OK' : 'DEGRADED',
      services,
      timestamp: new Date().toISOString(),
    });
  });

  // API Routes
  app.get('/api', (req, res) => {
    res.json({ message: 'MedFlow AI API v1.0' });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/triage', triageRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/records', healthRecordRoutes);

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Error:', err);
    res.status(err.status || 500).json({
      message: err.message || 'Internal Server Error',
      status: err.status || 500,
    });
  });

  return app;
};
