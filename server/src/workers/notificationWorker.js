import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import {
  sendEmail,
  sendSMS,
  sendAppointmentReminder,
  sendAppointmentConfirmation,
} from '../services/notificationService.js';
import { logger } from '../utils/logger.js';

// payload: { type, ...data } — see enqueueNotification call sites
const processNotification = async (job) => {
  const { type } = job.data;
  logger.info(`📨 Processing notification job ${job.id} (${type})`);

  let result;
  switch (type) {
    case 'appointment-confirmation':
      result = await sendAppointmentConfirmation(job.data.email, job.data.appointment);
      break;
    case 'appointment-reminder':
      result = await sendAppointmentReminder(job.data.email, job.data.appointment);
      break;
    case 'email':
      result = await sendEmail(job.data.email, job.data.subject, job.data.html);
      break;
    case 'sms':
      result = await sendSMS(job.data.phoneNumber, job.data.message);
      break;
    default:
      throw new Error(`Unknown notification type: ${type}`);
  }

  if (!result.success) {
    throw new Error(result.error); // rethrow so BullMQ retries
  }
  return result;
};

export const startNotificationWorker = () => {
  const worker = new Worker('notifications', processNotification, {
    connection: createRedisConnection('notification-worker'),
    concurrency: 5,
  });

  worker.on('completed', (job) => logger.info(`✅ Notification job ${job.id} sent`));
  worker.on('failed', (job, error) =>
    logger.error(`❌ Notification job ${job?.id} failed: ${error.message}`)
  );

  logger.info('👷 Notification worker started');
  return worker;
};
