import { keyedFingerprint } from '../crypto/credential-envelope.js';
import type { SessionBackend } from './session-backend.js';

export type LoginRateLimitResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

export class LoginRateLimiter {
  constructor(
    private readonly backend: SessionBackend,
    private readonly fingerprintKey: Buffer,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async consume(
    clientIdentity: string,
    providerHost: string,
    username: string,
  ): Promise<LoginRateLimitResult> {
    const clientKey = keyedFingerprint(`client\0${clientIdentity}`, this.fingerprintKey);
    const accountKey = keyedFingerprint(
      `account\0${providerHost.trim().toLowerCase()}\0${username.trim().toLowerCase()}`,
      this.fingerprintKey,
    );
    const decision = await this.backend.consumeLoginAttempt(
      [`login:client:${clientKey}`, `login:account:${accountKey}`],
      this.limit,
      this.windowMs,
    );
    return Object.freeze({
      allowed: decision.allowed,
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    });
  }
}
