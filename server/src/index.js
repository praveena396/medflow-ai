import { config } from './config/index.js';
import { validateEnv } from './config/validateEnv.js';
import { redis } from './config/redis.js';
import { connectDB, disconnectDB } from './utils/database.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

// Fail fast on bad configuration before opening any connections.
validateEnv();

// Connect to Database
try {
  await connectDB();
  logger.info('✅ Database connected');
} catch (err) {
  logger.error('❌ Database connection failed:', err);
  process.exit(1);
}

const app = createApp();

// Start Server
const server = app.listen(config.port, () => {
  logger.info(`🚀 Server running on http://localhost:${config.port}`);
  logger.info(`📡 Health check: http://localhost:${config.port}/health`);
});

// Graceful shutdown: stop taking requests, finish in-flight ones, close connections.
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await disconnectDB();
    redis.disconnect();
    process.exit(0);
  });
  // Force-exit if connections refuse to drain.
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
