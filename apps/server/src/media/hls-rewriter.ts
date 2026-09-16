import type { HlsNestedResourceKind } from './media-locator.js';

export const MAXIMUM_HLS_MANIFEST_BYTES = 2 * 1024 * 1024;

export class HlsManifestError extends Error {
  constructor() {
    super('HLS manifest is invalid.');
    this.name = 'HlsManifestError';
  }
}

export type HlsLocatorFactory = (
  upstreamUri: URL,
  resource: HlsNestedResourceKind,
) => string;

const URI_TAGS = new Map<string, Readonly<{ resource: HlsNestedResourceKind; required: boolean }>>([
  ['#EXT-X-KEY', { resource: 'binary', required: false }],
  ['#EXT-X-MAP', { resource: 'binary', required: true }],
  ['#EXT-X-MEDIA', { resource: 'manifest', required: false }],
  ['#EXT-X-I-FRAME-STREAM-INF', { resource: 'manifest', required: true }],
  ['#EXT-X-SESSION-KEY', { resource: 'binary', required: false }],
  ['#EXT-X-SESSION-DATA', { resource: 'binary', required: false }],
  ['#EXT-X-PART', { resource: 'binary', required: true }],
  ['#EXT-X-PRELOAD-HINT', { resource: 'binary', required: true }],
  ['#EXT-X-RENDITION-REPORT', { resource: 'manifest', required: true }],
]);

const UNSUPPORTED_URI_ATTRIBUTES = new Map<string, readonly string[]>([
  ['#EXT-X-DATERANGE', ['X-ASSET-URI', 'X-ASSET-LIST', 'X-URI']],
]);

function resolveMediaUri(raw: string, manifestUri: URL): URL {
  if (!raw || raw.length > 8192 || /[\u0000-\u001F\u007F]/u.test(raw)) {
    throw new HlsManifestError();
  }
  let resolved: URL;
  try {
    resolved = new URL(raw, manifestUri);
  } catch {
    throw new HlsManifestError();
  }
  if (
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
    resolved.username ||
    resolved.password ||
    resolved.hash
  ) {
    throw new HlsManifestError();
  }
  return resolved;
}

function tagName(line: string): string {
  const colon = line.indexOf(':');
  return colon === -1 ? line : line.slice(0, colon);
}

function attributeSegments(line: string): readonly string[] {
  const colon = line.indexOf(':');
  if (colon === -1) return Object.freeze([]);
  const attributes = line.slice(colon + 1);
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < attributes.length; index += 1) {
    const character = attributes[index];
    if (character === '"') quoted = !quoted;
    if (character === ',' && !quoted) {
      segments.push(attributes.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) throw new HlsManifestError();
  segments.push(attributes.slice(start));
  return Object.freeze(segments);
}

function attributeName(segment: string): string | null {
  const trimmed = segment.trim();
  const separator = trimmed.indexOf('=');
  if (separator < 1) return null;
  const name = trimmed.slice(0, separator).trim();
  return name || null;
}

function parsedUriAttributes(line: string): readonly string[] {
  const values: string[] = [];
  for (const segment of attributeSegments(line)) {
    const name = attributeName(segment);
    if (name?.toUpperCase() !== 'URI') continue;
    const match = /^URI="([^"\r\n]*)"$/u.exec(segment.trim());
    if (!match) throw new HlsManifestError();
    values.push(match[1] ?? '');
  }
  return Object.freeze(values);
}

function hasUnsupportedUriAttribute(line: string, normalizedTag: string): boolean {
  const unsupported = UNSUPPORTED_URI_ATTRIBUTES.get(normalizedTag);
  if (!unsupported) return false;
  for (const segment of attributeSegments(line)) {
    const name = attributeName(segment);
    if (name && unsupported.includes(name.toUpperCase())) return true;
  }
  return false;
}

function rewriteUriAttribute(
  line: string,
  rawUri: string,
  manifestUri: URL,
  resource: HlsNestedResourceKind,
  makeLocator: HlsLocatorFactory,
): string {
  return line.replace(
    `URI="${rawUri}"`,
    `URI="${makeLocator(resolveMediaUri(rawUri, manifestUri), resource)}"`,
  );
}

function assertNoUpstreamUri(text: string): void {
  if (/https?:\/\//iu.test(text)) throw new HlsManifestError();
}

export function rewriteHlsManifest(
  body: Uint8Array,
  manifestUri: URL,
  makeLocator: HlsLocatorFactory,
): Uint8Array {
  if (body.byteLength === 0 || body.byteLength > MAXIMUM_HLS_MANIFEST_BYTES) {
    throw new HlsManifestError();
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new HlsManifestError();
  }
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const firstContent = lines.find((line) => line.trim().length > 0);
  if (firstContent?.trim() !== '#EXTM3U') throw new HlsManifestError();

  let nextUriIsManifest = false;
  const output: string[] = [];
  for (const rawLine of lines) {
    if (rawLine.length > 64 * 1024) throw new HlsManifestError();
    const trimmed = rawLine.trim();
    if (!trimmed) {
      output.push('');
      continue;
    }

    if (!trimmed.startsWith('#')) {
      const resource: HlsNestedResourceKind = nextUriIsManifest ? 'manifest' : 'binary';
      output.push(makeLocator(resolveMediaUri(trimmed, manifestUri), resource));
      nextUriIsManifest = false;
      continue;
    }

    const currentTag = tagName(trimmed);
    const normalizedTag = currentTag.toUpperCase();
    if (normalizedTag === '#EXT-X-CONTENT-STEERING') throw new HlsManifestError();
    if (hasUnsupportedUriAttribute(trimmed, normalizedTag)) throw new HlsManifestError();

    const uriAttributes = parsedUriAttributes(trimmed);
    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      if (uriAttributes.length !== 0) throw new HlsManifestError();
      output.push(trimmed);
      nextUriIsManifest = true;
      continue;
    }

    const configuration = URI_TAGS.get(currentTag);
    if (configuration) {
      if (configuration.required && uriAttributes.length !== 1) throw new HlsManifestError();
      if (uriAttributes.length > 1) throw new HlsManifestError();
      const uri = uriAttributes[0];
      output.push(
        uri === undefined
          ? trimmed
          : rewriteUriAttribute(trimmed, uri, manifestUri, configuration.resource, makeLocator),
      );
      continue;
    }

    if (uriAttributes.length !== 0) throw new HlsManifestError();
    output.push(trimmed);
  }

  if (nextUriIsManifest) throw new HlsManifestError();
  const rewrittenText = output.join('\n');
  assertNoUpstreamUri(rewrittenText);
  return Buffer.from(rewrittenText, 'utf8');
}
