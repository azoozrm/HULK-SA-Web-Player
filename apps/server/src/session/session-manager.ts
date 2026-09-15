import { createHash, randomBytes } from 'node:crypto';
import type { OpaqueSessionDescriptor, ProviderLoginRequest } from '../../../../packages/contracts/src/index.js';
import type {
  ProviderCredentialLease,
  ProviderSessionBoundary,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
} from '../crypto/credential-envelope.js';
import type { SessionBackend, StoredSessionRecord } from './session-backend.js';

export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function sessionLookupKey(sessionToken: string): string {
  return `session:${createHash('sha256').update(sessionToken, 'utf8').digest('base64url')}`;
}

export class SessionManager implements ProviderSessionBoundary {
  constructor(
    private readonly backend: SessionBackend,
    private readonly credentialEncryptionKey: Buffer,
    private readonly sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async establish(
    input: ProviderLoginRequest,
    providerExpiresAtEpochMs: number | null,
  ): Promise<Readonly<{ descriptor: OpaqueSessionDescriptor; bearerToken: string }>> {
    const now = this.now();
    const configuredExpiry = now + this.sessionTtlMs;
    const expiresAtEpochMs =
      providerExpiresAtEpochMs !== null && providerExpiresAtEpochMs < configuredExpiry
        ? providerExpiresAtEpochMs
        : configuredExpiry;
    if (expiresAtEpochMs <= now) throw new Error('Cannot create an already expired session.');

    const bearerToken = randomBytes(32).toString('base64url');
    const credentials: ServerHeldProviderCredentials = Object.freeze({
      host: input.host.trim(),
      username: input.username.trim(),
      password: input.password,
    });
    const credentialEnvelope = encryptProviderCredentials(
      credentials,
      this.credentialEncryptionKey,
    );
    const record: StoredSessionRecord = Object.freeze({
      v: 1,
      expiresAtEpochMs,
      credentialEnvelope,
    });
    await this.backend.putSession(
      sessionLookupKey(bearerToken),
      record,
      expiresAtEpochMs - now,
    );

    return Object.freeze({
      bearerToken,
      descriptor: Object.freeze({
        authenticated: true,
        expiresAt: new Date(expiresAtEpochMs).toISOString(),
      }),
    });
  }

  async resolve(sessionToken: string): Promise<OpaqueSessionDescriptor | null> {
    const record = await this.getValidRecord(sessionToken);
    if (!record) return null;
    return Object.freeze({
      authenticated: true,
      expiresAt: new Date(record.expiresAtEpochMs).toISOString(),
    });
  }

  async acquireProviderCredentials(sessionToken: string): Promise<ProviderCredentialLease | null> {
    const record = await this.getValidRecord(sessionToken);
    if (!record) return null;
    const credentials = decryptProviderCredentials(
      record.credentialEnvelope,
      this.credentialEncryptionKey,
    );
    return Object.freeze({ credentials, expiresAtEpochMs: record.expiresAtEpochMs });
  }

  async revoke(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    await this.backend.deleteSession(sessionLookupKey(sessionToken));
  }

  private async getValidRecord(sessionToken: string): Promise<StoredSessionRecord | null> {
    if (!sessionToken || sessionToken.length > 256) return null;
    const key = sessionLookupKey(sessionToken);
    const record = await this.backend.getSession(key);
    if (!record) return null;
    if (record.expiresAtEpochMs <= this.now()) {
      await this.backend.deleteSession(key);
      return null;
    }
    return record;
  }
}
