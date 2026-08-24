import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

const connection = createRedisConnection('queues');

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// Heavy work: extract text from an uploaded document, chunk + embed it.
export const documentQueue = new Queue('document-processing', {
  connection,
  defaultJobOptions,
});

// Outbound messages: emails and SMS, including scheduled appointment reminders.
export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions,
});

export const enqueueDocumentProcessing = async (documentId) => {
  const job = await documentQueue.add('process-document', { documentId });
  logger.info(`📥 Queued document processing job ${job.id} for document ${documentId}`);
  return job;
};

export const enqueueNotification = async (payload, { delayMs = 0 } = {}) => {
  const job = await notificationQueue.add('send-notification', payload, {
    delay: delayMs,
  });
  logger.info(`📥 Queued notification job ${job.id} (delay ${delayMs}ms)`);
  return job;
};
