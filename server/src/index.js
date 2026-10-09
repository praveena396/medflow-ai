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

// Optionally consume background jobs in this process (RUN_WORKERS_IN_PROCESS).
let workers = [];
if (config.runWorkersInProcess) {
  const { startDocumentWorker } = await import('./workers/documentWorker.js');
  const { startNotificationWorker } = await import('./workers/notificationWorker.js');
  workers = [startDocumentWorker(), startNotificationWorker()];
  logger.info('🧵 Background workers running inside the API process');
}

// Start Server
const server = app.listen(config.port, () => {
  logger.info(`🚀 Server running on http://localhost:${config.port}`);
  logger.info(`📡 Health check: http://localhost:${config.port}/health`);
});

// Graceful shutdown: stop taking requests, finish in-flight ones, close connections.
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    if (workers.length) {
      await Promise.all(workers.map((worker) => worker.close()));
      const { shutdownOcr } = await import('./services/ocrService.js');
      await shutdownOcr();
    }
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
