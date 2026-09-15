import { createClient } from '@redis/client';
import type { CredentialEnvelopeV1 } from '../crypto/credential-envelope.js';

export type StoredSessionRecord = Readonly<{
  v: 1;
  expiresAtEpochMs: number;
  credentialEnvelope: CredentialEnvelopeV1;
}>;

export type LoginAttemptDecision = Readonly<{
  allowed: boolean;
  retryAfterMs: number;
  count: number;
}>;

export interface SessionBackend {
  putSession(key: string, record: StoredSessionRecord, ttlMs: number): Promise<void>;
  getSession(key: string): Promise<StoredSessionRecord | null>;
  deleteSession(key: string): Promise<void>;
  consumeLoginAttempt(
    keys: readonly string[],
    limit: number,
    windowMs: number,
  ): Promise<LoginAttemptDecision>;
  close(): Promise<void>;
}

function isCredentialEnvelope(value: unknown): value is CredentialEnvelopeV1 {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return (
    record.v === 1 &&
    record.alg === 'A256GCM' &&
    typeof record.iv === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.tag === 'string'
  );
}

function parseStoredSession(value: string): StoredSessionRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      record.v !== 1 ||
      typeof record.expiresAtEpochMs !== 'number' ||
      !Number.isSafeInteger(record.expiresAtEpochMs) ||
      !isCredentialEnvelope(record.credentialEnvelope)
    ) {
      return null;
    }
    return Object.freeze({
      v: 1,
      expiresAtEpochMs: record.expiresAtEpochMs,
      credentialEnvelope: record.credentialEnvelope,
    });
  } catch {
    return null;
  }
}

export class MemorySessionBackend implements SessionBackend {
  private readonly sessions = new Map<string, Readonly<{ value: string; expiresAtEpochMs: number }>>();
  private readonly attempts = new Map<string, Readonly<{ count: number; expiresAtEpochMs: number }>>();

  constructor(private readonly now: () => number = Date.now) {}

  async putSession(key: string, record: StoredSessionRecord, ttlMs: number): Promise<void> {
    this.sessions.set(
      key,
      Object.freeze({ value: JSON.stringify(record), expiresAtEpochMs: this.now() + ttlMs }),
    );
  }

  async getSession(key: string): Promise<StoredSessionRecord | null> {
    const stored = this.sessions.get(key);
    if (!stored) return null;
    if (stored.expiresAtEpochMs <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    const record = parseStoredSession(stored.value);
    if (!record) this.sessions.delete(key);
    return record;
  }

  async deleteSession(key: string): Promise<void> {
    this.sessions.delete(key);
  }

  async consumeLoginAttempt(
    keys: readonly string[],
    limit: number,
    windowMs: number,
  ): Promise<LoginAttemptDecision> {
    const now = this.now();
    let maxCount = 0;
    let retryAfterMs = 0;
    for (const key of keys) {
      const existing = this.attempts.get(key);
      const next = !existing || existing.expiresAtEpochMs <= now
        ? Object.freeze({ count: 1, expiresAtEpochMs: now + windowMs })
        : Object.freeze({ count: existing.count + 1, expiresAtEpochMs: existing.expiresAtEpochMs });
      this.attempts.set(key, next);
      maxCount = Math.max(maxCount, next.count);
      retryAfterMs = Math.max(retryAfterMs, next.expiresAtEpochMs - now);
    }
    return Object.freeze({
      allowed: maxCount <= limit,
      retryAfterMs: Math.max(0, retryAfterMs),
      count: maxCount,
    });
  }

  async close(): Promise<void> {}
}

const RATE_LIMIT_LUA = `
local max_count = 0
local retry_after = 0
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[i], ARGV[1])
  end
  local ttl = redis.call('PTTL', KEYS[i])
  if count > max_count then max_count = count end
  if ttl > retry_after then retry_after = ttl end
end
return {max_count, retry_after}
`;

export async function createRedisSessionBackend(
  redisUrl: string,
  keyPrefix = 'hulk:v1:',
): Promise<SessionBackend> {
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5_000,
      socketTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 2_000),
    },
  });
  client.on('error', () => {
    // Intentionally no sensitive connection details are logged here.
  });
  await client.connect();

  const qualifyKey = (key: string): string => `${keyPrefix}${key}`;

  return Object.freeze({
    async putSession(key: string, record: StoredSessionRecord, ttlMs: number): Promise<void> {
      await client.set(qualifyKey(key), JSON.stringify(record), { PX: ttlMs });
    },
    async getSession(key: string): Promise<StoredSessionRecord | null> {
      const qualifiedKey = qualifyKey(key);
      const value = await client.get(qualifiedKey);
      if (value === null) return null;
      const record = parseStoredSession(value);
      if (!record) {
        await client.del(qualifiedKey);
        return null;
      }
      return record;
    },
    async deleteSession(key: string): Promise<void> {
      await client.del(qualifyKey(key));
    },
    async consumeLoginAttempt(
      keys: readonly string[],
      limit: number,
      windowMs: number,
    ): Promise<LoginAttemptDecision> {
      const result = await client.eval(RATE_LIMIT_LUA, {
        keys: keys.map(qualifyKey),
        arguments: [String(windowMs)],
      });
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Session store rate-limit operation failed.');
      }
      const count = Number(result[0]);
      const retryAfterMs = Math.max(0, Number(result[1]));
      if (!Number.isFinite(count) || !Number.isFinite(retryAfterMs)) {
        throw new Error('Session store rate-limit operation failed.');
      }
      return Object.freeze({ allowed: count <= limit, retryAfterMs, count });
    },
    async close(): Promise<void> {
      if (client.isOpen) await client.close();
    },
  });
}
