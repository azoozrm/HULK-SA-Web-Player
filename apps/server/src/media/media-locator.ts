import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const LOCATOR_AAD = Buffer.from('hulk-media-locator:v1', 'utf8');
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,16}$/u;
const MAXIMUM_LOCATOR_TOKEN_LENGTH = 16 * 1024;
const MAXIMUM_NESTED_URI_LENGTH = 8192;

export const DEFAULT_MEDIA_LOCATOR_TTL_MS = 5 * 60 * 1000;

export type HlsNestedResourceKind = 'manifest' | 'binary';

export type AuthorizedMediaTarget =
  | Readonly<{ kind: 'live'; id: string }>
  | Readonly<{ kind: 'movie'; id: string; extension: string }>
  | Readonly<{ kind: 'episode'; id: string; seriesId: string; extension: string }>
  | Readonly<{ kind: 'hls'; uri: string; resource: HlsNestedResourceKind }>;

type MediaLocatorEnvelope = Readonly<{
  v: 1;
  owner: string;
  expiresAtEpochMs: number;
  target: AuthorizedMediaTarget;
}>;

export type IssuedMediaLocator = Readonly<{
  token: string;
  expiresAtEpochMs: number;
}>;

export class MediaLocatorError extends Error {
  readonly code: 'invalid' | 'expired' | 'wrong_session';

  constructor(code: MediaLocatorError['code']) {
    super('Media locator is invalid.');
    this.name = 'MediaLocatorError';
    this.code = code;
  }
}

function strictBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new MediaLocatorError('invalid');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new MediaLocatorError('invalid');
  return decoded;
}

function sessionOwner(sessionToken: string): string {
  return createHash('sha256').update(sessionToken, 'utf8').digest('base64url');
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function validExtension(value: unknown): value is string {
  return typeof value === 'string' && SAFE_EXTENSION.test(value);
}

function validNestedUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_NESTED_URI_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function parseTarget(value: unknown): AuthorizedMediaTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MediaLocatorError('invalid');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind === 'live' && validIdentifier(record.id)) {
    return Object.freeze({ kind: 'live', id: record.id });
  }
  if (record.kind === 'movie' && validIdentifier(record.id) && validExtension(record.extension)) {
    return Object.freeze({ kind: 'movie', id: record.id, extension: record.extension.toLowerCase() });
  }
  if (
    record.kind === 'episode' &&
    validIdentifier(record.id) &&
    validIdentifier(record.seriesId) &&
    validExtension(record.extension)
  ) {
    return Object.freeze({
      kind: 'episode',
      id: record.id,
      seriesId: record.seriesId,
      extension: record.extension.toLowerCase(),
    });
  }
  if (
    record.kind === 'hls' &&
    validNestedUri(record.uri) &&
    (record.resource === 'manifest' || record.resource === 'binary')
  ) {
    return Object.freeze({ kind: 'hls', uri: record.uri, resource: record.resource });
  }
  throw new MediaLocatorError('invalid');
}

function parseEnvelope(value: unknown): MediaLocatorEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MediaLocatorError('invalid');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.v !== 1 ||
    typeof record.owner !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(record.owner) ||
    typeof record.expiresAtEpochMs !== 'number' ||
    !Number.isSafeInteger(record.expiresAtEpochMs)
  ) {
    throw new MediaLocatorError('invalid');
  }
  return Object.freeze({
    v: 1,
    owner: record.owner,
    expiresAtEpochMs: record.expiresAtEpochMs,
    target: parseTarget(record.target),
  });
}

export class MediaLocatorCodec {
  constructor(
    private readonly key: Buffer,
    private readonly ttlMs = DEFAULT_MEDIA_LOCATOR_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (key.length !== 32) throw new MediaLocatorError('invalid');
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60 * 1000) {
      throw new MediaLocatorError('invalid');
    }
  }

  issue(
    sessionToken: string,
    target: AuthorizedMediaTarget,
    sessionExpiresAtEpochMs: number,
  ): IssuedMediaLocator {
    const issuedAt = this.now();
    const expiresAtEpochMs = Math.min(sessionExpiresAtEpochMs, issuedAt + this.ttlMs);
    if (!sessionToken || expiresAtEpochMs <= issuedAt) throw new MediaLocatorError('expired');

    const envelope: MediaLocatorEnvelope = Object.freeze({
      v: 1,
      owner: sessionOwner(sessionToken),
      expiresAtEpochMs,
      target,
    });
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(LOCATOR_AAD);
    const plaintext = Buffer.from(JSON.stringify(envelope), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    plaintext.fill(0);

    return Object.freeze({
      token: `1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`,
      expiresAtEpochMs,
    });
  }

  open(token: string, sessionToken: string): MediaLocatorEnvelope {
    if (!token || token.length > MAXIMUM_LOCATOR_TOKEN_LENGTH || !sessionToken) {
      throw new MediaLocatorError('invalid');
    }
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== '1') throw new MediaLocatorError('invalid');

    try {
      const iv = strictBase64Url(parts[1] ?? '');
      const ciphertext = strictBase64Url(parts[2] ?? '');
      const tag = strictBase64Url(parts[3] ?? '');
      if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES || ciphertext.length === 0) {
        throw new MediaLocatorError('invalid');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv, {
        authTagLength: GCM_TAG_BYTES,
      });
      decipher.setAAD(LOCATOR_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
      } finally {
        plaintext.fill(0);
      }
      const envelope = parseEnvelope(parsed);
      if (envelope.expiresAtEpochMs <= this.now()) throw new MediaLocatorError('expired');

      const actualOwner = Buffer.from(envelope.owner, 'utf8');
      const expectedOwner = Buffer.from(sessionOwner(sessionToken), 'utf8');
      if (
        actualOwner.length !== expectedOwner.length ||
        !timingSafeEqual(actualOwner, expectedOwner)
      ) {
        throw new MediaLocatorError('wrong_session');
      }
      return envelope;
    } catch (error) {
      if (error instanceof MediaLocatorError) throw error;
      throw new MediaLocatorError('invalid');
    }
  }
}
