import { Redis } from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

// BullMQ requires maxRetriesPerRequest: null on its connections.
const commonOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
};

// Arguments for `new Redis(...)`. REDIS_URL (redis:// or rediss:// for TLS)
// takes precedence; otherwise REDIS_HOST / REDIS_PORT / REDIS_PASSWORD.
export const redisConnectionArgs = (redisConfig = config.redis) => {
  if (redisConfig.url) {
    const options = { ...commonOptions };
    // ioredis turns on TLS for rediss:// itself; keep SNI pointed at the host.
    if (redisConfig.url.startsWith('rediss://')) {
      options.tls = { servername: new URL(redisConfig.url).hostname };
    }
    return [redisConfig.url, options];
  }
  return [
    {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      ...commonOptions,
    },
  ];
};

export const createRedisConnection = (name = 'default') => {
  const connection = new Redis(...redisConnectionArgs());

  connection.on('connect', () => logger.info(`✅ Redis connected (${name})`));
  connection.on('error', (error) => logger.error(`❌ Redis error (${name}): ${error.message}`));

  return connection;
};

// Shared connection for caching and rate limiting
export const redis = createRedisConnection('app');
