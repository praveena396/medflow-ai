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

// Per-user limit for routes that call the LLM. Must run after
// authenticateToken: the key is the user id from the verified JWT, so one
// user can't exhaust the limit for everyone behind the same IP, and one user
// can't dodge it by switching IPs.
export const createUserRateLimiter = ({
  windowMs = config.rateLimit.aiWindowMs,
  max = config.rateLimit.aiMax,
  prefix,
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.userId}`,
    store: redisStore(prefix),
    message: { message: 'Too many AI requests. Please wait a minute and try again.' },
  });

export const chatLimiter = createUserRateLimiter({ prefix: 'rl:chat:' });
export const triageLimiter = createUserRateLimiter({ prefix: 'rl:triage:' });
