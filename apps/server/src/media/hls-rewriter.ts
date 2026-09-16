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

function rewriteUriAttributes(
  line: string,
  manifestUri: URL,
  resource: HlsNestedResourceKind,
  makeLocator: HlsLocatorFactory,
): Readonly<{ line: string; count: number }> {
  let count = 0;
  const rewritten = line.replace(/(^|[,:])URI="([^"\r\n]*)"/gu, (_match, prefix: string, uri: string) => {
    count += 1;
    return `${prefix}URI="${makeLocator(resolveMediaUri(uri, manifestUri), resource)}"`;
  });
  return Object.freeze({ line: rewritten, count });
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

    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      if (/[,:]URI="/u.test(trimmed)) throw new HlsManifestError();
      output.push(trimmed);
      nextUriIsManifest = true;
      continue;
    }

    const configuration = URI_TAGS.get(tagName(trimmed));
    if (configuration) {
      const rewritten = rewriteUriAttributes(
        trimmed,
        manifestUri,
        configuration.resource,
        makeLocator,
      );
      if (configuration.required && rewritten.count !== 1) throw new HlsManifestError();
      if (rewritten.count > 1) throw new HlsManifestError();
      output.push(rewritten.line);
      continue;
    }

    if (/[,:]URI="/u.test(trimmed)) throw new HlsManifestError();
    output.push(trimmed);
  }

  if (nextUriIsManifest) throw new HlsManifestError();
  const rewrittenText = output.join('\n');
  assertNoUpstreamUri(rewrittenText);
  return Buffer.from(rewrittenText, 'utf8');
}
