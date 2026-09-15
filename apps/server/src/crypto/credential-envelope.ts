import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { ServerHeldProviderCredentials } from '../control-plane.js';

const ROOT_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HKDF_SALT = Buffer.from('hulk-sa-web-player:phase-2:v1', 'utf8');
const CREDENTIAL_INFO = Buffer.from('provider-credential-envelope:v1', 'utf8');
const RATE_LIMIT_INFO = Buffer.from('login-rate-limit-fingerprint:v1', 'utf8');
const CREDENTIAL_AAD = Buffer.from('hulk-provider-credentials:v1', 'utf8');

export type CredentialEnvelopeV1 = Readonly<{
  v: 1;
  alg: 'A256GCM';
  iv: string;
  ciphertext: string;
  tag: string;
}>;

export type DerivedSecurityKeys = Readonly<{
  credentialEncryptionKey: Buffer;
  rateLimitFingerprintKey: Buffer;
}>;

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretConfigurationError';
  }
}

export class CredentialEnvelopeError extends Error {
  constructor(message = 'Credential envelope authentication failed.') {
    super(message);
    this.name = 'CredentialEnvelopeError';
  }
}

function decodeBase64UrlStrict(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new SecretConfigurationError('Session encryption key must be base64url encoded.');
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value.replace(/=+$/u, '')) {
    throw new SecretConfigurationError('Session encryption key encoding is invalid.');
  }
  return decoded;
}

export function deriveSecurityKeys(rootSecret: string): DerivedSecurityKeys {
  const root = decodeBase64UrlStrict(rootSecret);
  if (root.length !== ROOT_KEY_BYTES) {
    throw new SecretConfigurationError('Session encryption key must decode to exactly 32 bytes.');
  }

  const credentialEncryptionKey = Buffer.from(
    hkdfSync('sha256', root, HKDF_SALT, CREDENTIAL_INFO, 32),
  );
  const rateLimitFingerprintKey = Buffer.from(
    hkdfSync('sha256', root, HKDF_SALT, RATE_LIMIT_INFO, 32),
  );
  root.fill(0);

  return Object.freeze({ credentialEncryptionKey, rateLimitFingerprintKey });
}

export function encryptProviderCredentials(
  credentials: ServerHeldProviderCredentials,
  key: Buffer,
): CredentialEnvelopeV1 {
  if (key.length !== 32) throw new CredentialEnvelopeError('Credential encryption key is invalid.');

  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(CREDENTIAL_AAD);
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  plaintext.fill(0);

  return Object.freeze({
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: tag.toString('base64url'),
  });
}

function assertEnvelopeV1(value: CredentialEnvelopeV1): void {
  if (
    value.v !== 1 ||
    value.alg !== 'A256GCM' ||
    typeof value.iv !== 'string' ||
    typeof value.ciphertext !== 'string' ||
    typeof value.tag !== 'string'
  ) {
    throw new CredentialEnvelopeError();
  }
}

export function decryptProviderCredentials(
  envelope: CredentialEnvelopeV1,
  key: Buffer,
): ServerHeldProviderCredentials {
  try {
    assertEnvelopeV1(envelope);
    if (key.length !== 32) throw new CredentialEnvelopeError();
    const iv = Buffer.from(envelope.iv, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
      throw new CredentialEnvelopeError();
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAAD(CREDENTIAL_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    plaintext.fill(0);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('host' in parsed) ||
      !('username' in parsed) ||
      !('password' in parsed) ||
      typeof parsed.host !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.password !== 'string'
    ) {
      throw new CredentialEnvelopeError();
    }

    return Object.freeze({
      host: parsed.host,
      username: parsed.username,
      password: parsed.password,
    });
  } catch (error) {
    if (error instanceof CredentialEnvelopeError) throw error;
    throw new CredentialEnvelopeError();
  }
}

export function keyedFingerprint(value: string, key: Buffer): string {
  if (key.length !== 32) throw new SecretConfigurationError('Fingerprint key is invalid.');
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}
