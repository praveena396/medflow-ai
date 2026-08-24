import { Redis } from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

// BullMQ requires maxRetriesPerRequest: null on its connections.
const baseOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
};

export const createRedisConnection = (name = 'default') => {
  const connection = new Redis(baseOptions);

  connection.on('connect', () => logger.info(`✅ Redis connected (${name})`));
  connection.on('error', (error) => logger.error(`❌ Redis error (${name}): ${error.message}`));

  return connection;
};

// Shared connection for caching and rate limiting
export const redis = createRedisConnection('app');
