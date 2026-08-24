import { connectDB, disconnectDB } from '../utils/database.js';
import { validateEnv } from '../config/validateEnv.js';
import { logger } from '../utils/logger.js';
import { startDocumentWorker } from './documentWorker.js';
import { startNotificationWorker } from './notificationWorker.js';

// Standalone worker process: `npm run worker`
// Runs alongside the API server and consumes background jobs from Redis.
const main = async () => {
  validateEnv();
  await connectDB();

  const workers = [startDocumentWorker(), startNotificationWorker()];

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down workers gracefully`);
    await Promise.all(workers.map((worker) => worker.close()));
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('🚀 Worker process ready and waiting for jobs');
};

main().catch((error) => {
  logger.error('Worker startup failed:', error.message);
  process.exit(1);
});
