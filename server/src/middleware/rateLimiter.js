import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { config } from '../config/index.js';

// Counters live in Redis so limits hold across multiple server instances.
const redisStore = (prefix) =>
  new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });

// General API limit per IP.
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:api:'),
  message: { message: 'Too many requests, please try again later' },
});

// Stricter limit for login/register to slow down credential guessing.
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:auth:'),
  message: { message: 'Too many attempts, please try again later' },
});
