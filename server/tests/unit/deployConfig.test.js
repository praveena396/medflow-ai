import { describe, it, expect } from 'vitest';
import { parseTrustProxy } from '../../src/config/index.js';
import { redisConnectionArgs } from '../../src/config/redis.js';

describe('parseTrustProxy', () => {
  it('is off unless TRUST_PROXY is set', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('accepts a hop count, true, or a list of addresses', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('redisConnectionArgs', () => {
  it('uses host, port and password when there is no REDIS_URL', () => {
    const [options, extra] = redisConnectionArgs({ host: 'redis.local', port: 6380, password: 'pw' });
    expect(extra).toBeUndefined();
    expect(options).toMatchObject({ host: 'redis.local', port: 6380, password: 'pw', maxRetriesPerRequest: null });
  });

  it('passes a redis:// URL through without TLS', () => {
    const [url, options] = redisConnectionArgs({ url: 'redis://default:pw@cache:6379', host: 'ignored' });
    expect(url).toBe('redis://default:pw@cache:6379');
    expect(options.tls).toBeUndefined();
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it('turns on TLS with the right server name for rediss:// (Upstash)', () => {
    const [url, options] = redisConnectionArgs({ url: 'rediss://default:secret@eu1-example.upstash.io:6379' });
    expect(url).toBe('rediss://default:secret@eu1-example.upstash.io:6379');
    expect(options.tls).toEqual({ servername: 'eu1-example.upstash.io' });
  });
});
