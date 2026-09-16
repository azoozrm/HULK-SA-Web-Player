import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { deriveSecurityKeys } from '../dist/apps/server/src/crypto/credential-envelope.js';
import {
  createMediaApiHandler,
  createMediaSessionGuard,
} from '../dist/apps/server/src/http/media-api.js';
import {
  HlsManifestError,
  MAXIMUM_HLS_MANIFEST_BYTES,
  rewriteHlsManifest,
} from '../dist/apps/server/src/media/hls-rewriter.js';
import {
  MediaLocatorCodec,
  MediaLocatorError,
} from '../dist/apps/server/src/media/media-locator.js';
import {
  ByteRangeError,
  parseSingleByteRange,
  validContentRange,
} from '../dist/apps/server/src/media/range.js';
import {
  BoundedProcessPool,
  ffmpegStreamCopyArguments,
  ffprobeArguments,
  mediaProcessPolicy,
  selectRemuxPath,
} from '../dist/apps/server/src/media/remux.js';
import {
  filterProviderMediaResponseHeaders,
  NodeProviderMediaTransport,
} from '../dist/apps/server/src/network/provider-media-transport.js';
import { ProviderNetworkPolicyError } from '../dist/apps/server/src/security/provider-url.js';

const rootSecret = Buffer.alloc(32, 7).toString('base64url');
const keys = deriveSecurityKeys(rootSecret);
const sessionA = 'A'.repeat(32);
const sessionB = 'B'.repeat(32);
const credentials = Object.freeze({
  host: 'https://provider.example/portal/',
  username: 'PRIVATE_USER_778899',
  password: 'PRIVATE_PASS_778899',
});

function bodyStream(value) {
  return Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')]);
}

async function startMediaServer(dependencies) {
  const handler = createMediaApiHandler(dependencies);
  const server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

async function requestJson(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
    text,
  };
}

test('media locator keys are purpose-separated and locators are opaque, session-bound, tamper-evident and expiring', () => {
  assert.notDeepEqual(keys.mediaLocatorKey, keys.credentialEncryptionKey);
  assert.notDeepEqual(keys.mediaLocatorKey, keys.rateLimitFingerprintKey);

  let now = 1_000_000;
  const codec = new MediaLocatorCodec(keys.mediaLocatorKey, 60_000, () => now);
  const nestedUri = `https://cdn.example/live/${credentials.username}/${credentials.password}/segment.ts`;
  const issued = codec.issue(
    sessionA,
    Object.freeze({ kind: 'hls', uri: nestedUri, resource: 'binary' }),
    now + 120_000,
  );
  assert.equal(issued.token.includes(credentials.username), false);
  assert.equal(issued.token.includes(credentials.password), false);
  assert.equal(issued.token.includes('cdn.example'), false);
  assert.equal(codec.open(issued.token, sessionA).target.kind, 'hls');
  assert.throws(() => codec.open(issued.token, sessionB), MediaLocatorError);

  const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => codec.open(tampered, sessionA), MediaLocatorError);
  now += 60_001;
  assert.throws(() => codec.open(issued.token, sessionA), MediaLocatorError);
});

test('HLS rewriting resolves relative references and rewrites modern URI-bearing structures without upstream leakage', () => {
  const source = Buffer.from(`#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/main.m3u8"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1000,URI="iframe.m3u8"\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="keys/session.key"\n#EXT-X-SESSION-DATA:DATA-ID="meta",URI="meta.json"\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant/playlist.m3u8\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=0.2,URI="parts/p1.m4s"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="parts/p2.m4s"\n#EXT-X-RENDITION-REPORT:URI="../other/live.m3u8",LAST-MSN=10\nsegment0001.ts\n`, 'utf8');
  const seen = [];
  const rewritten = rewriteHlsManifest(
    source,
    new URL('https://provider.example/root/live/master.m3u8'),
    (uri, resource) => {
      seen.push([uri.toString(), resource]);
      return `/api/media/r/token-${seen.length}`;
    },
  ).toString('utf8');

  assert.equal(rewritten.includes('provider.example'), false);
  assert.equal(rewritten.includes('https://'), false);
  assert.equal(rewritten.includes('/api/media/r/token-'), true);
  assert.deepEqual(seen[0], ['https://provider.example/root/live/audio/main.m3u8', 'manifest']);
  assert.ok(seen.some(([uri, type]) => uri.endsWith('/variant/playlist.m3u8') && type === 'manifest'));
  assert.ok(seen.some(([uri, type]) => uri.endsWith('/segment0001.ts') && type === 'binary'));

  assert.throws(
    () => rewriteHlsManifest(
      Buffer.from('#EXTM3U\nfile:///etc/passwd\n'),
      new URL('https://provider.example/a.m3u8'),
      () => '/x',
    ),
    HlsManifestError,
  );
  assert.throws(
    () => rewriteHlsManifest(
      Buffer.alloc(MAXIMUM_HLS_MANIFEST_BYTES + 1),
      new URL('https://provider.example/a.m3u8'),
      () => '/x',
    ),
    HlsManifestError,
  );
  assert.throws(
    () => rewriteHlsManifest(
      Buffer.from('#EXTM3U\n#EXT-X-UNKNOWN:URI="https://cdn.example/x"\n'),
      new URL('https://provider.example/a.m3u8'),
      () => '/x',
    ),
    HlsManifestError,
  );
});

test('HLS locator output is field-origin safe and does not reject coincidental short credential characters', () => {
  const rewritten = rewriteHlsManifest(
    Buffer.from('#EXTM3U\nsegment.ts\n', 'utf8'),
    new URL('https://provider.example/live/master.m3u8'),
    () => '/api/media/r/1xSAFELOCATOR',
  ).toString('utf8');
  assert.match(rewritten, /\/api\/media\/r\/1xSAFELOCATOR/u);
  assert.equal(rewritten.includes('https://'), false);
});

test('single-byte Range parser supports closed, open-ended and suffix ranges and rejects malformed or multiple ranges', () => {
  assert.deepEqual(parseSingleByteRange('bytes=10-19'), {
    kind: 'closed', start: 10, end: 19, header: 'bytes=10-19',
  });
  assert.deepEqual(parseSingleByteRange('bytes=10-'), {
    kind: 'open', start: 10, header: 'bytes=10-',
  });
  assert.deepEqual(parseSingleByteRange('bytes=-25'), {
    kind: 'suffix', length: 25, header: 'bytes=-25',
  });
  assert.throws(() => parseSingleByteRange('bytes=20-10'), ByteRangeError);
  assert.throws(() => parseSingleByteRange('bytes=0-1,4-5'), ByteRangeError);
  assert.throws(() => parseSingleByteRange('items=0-1'), ByteRangeError);
  assert.equal(validContentRange('bytes 10-19/100'), true);
  assert.equal(validContentRange('bytes */100', true), true);
  assert.equal(validContentRange('bytes 20-10/100'), false);
});

test('Provider media response headers are allow-listed and never include Set-Cookie or Location', () => {
  const filtered = filterProviderMediaResponseHeaders({
    'content-type': 'video/mp4',
    'content-length': '10',
    'content-range': 'bytes 0-9/100',
    'accept-ranges': 'bytes',
    'set-cookie': ['provider_secret=1'],
    location: 'https://provider.example/credential-path',
    'x-provider-secret': 'secret',
  });
  assert.deepEqual(filtered, {
    contentType: 'video/mp4',
    contentLength: '10',
    contentRange: 'bytes 0-9/100',
    acceptRanges: 'bytes',
  });
  const serialized = JSON.stringify(filtered);
  assert.equal(serialized.includes('provider_secret'), false);
  assert.equal(serialized.includes('location'), false);
  assert.equal(
    filterProviderMediaResponseHeaders({ 'content-length': '999999999999999999999' }).contentLength,
    null,
  );
});

test('nested media destinations reuse production SSRF rejection before opening a socket', async () => {
  const transport = new NodeProviderMediaTransport({
    async resolve() {
      return [{ address: '127.0.0.1', family: 4 }];
    },
  });
  await assert.rejects(
    () => transport.open({
      url: new URL('https://cdn.example/segment.ts'),
      method: 'GET',
      range: null,
      accept: null,
      signal: new AbortController().signal,
    }),
    ProviderNetworkPolicyError,
  );
});

test('remux selection requires probe evidence and process policy never gives FFmpeg a Provider URL', async () => {
  assert.deepEqual(
    selectRemuxPath({ videoCodecs: ['h264'], audioCodecs: ['aac'] }),
    { kind: 'stream-copy-remux' },
  );
  assert.deepEqual(
    selectRemuxPath({ videoCodecs: ['hevc'], audioCodecs: ['aac'] }),
    { kind: 'unsupported' },
  );
  assert.deepEqual(
    selectRemuxPath({ videoCodecs: ['h264'], audioCodecs: ['ac3'] }),
    { kind: 'unsupported' },
  );
  assert.equal(mediaProcessPolicy.shell, false);
  assert.equal(mediaProcessPolicy.inheritProcessEnvironment, false);
  const probe = ffprobeArguments().join(' ');
  const remux = ffmpegStreamCopyArguments().join(' ');
  assert.equal(probe.includes('http://'), false);
  assert.equal(probe.includes('https://'), false);
  assert.equal(remux.includes('http://'), false);
  assert.equal(remux.includes('https://'), false);
  assert.match(probe, /pipe:0/u);
  assert.match(remux, /pipe:0/u);
  assert.match(remux, /pipe:1/u);

  const pool = new BoundedProcessPool(1, 1);
  const firstRelease = await pool.acquire(new AbortController().signal);
  const secondController = new AbortController();
  const queued = pool.acquire(secondController.signal);
  assert.deepEqual(pool.snapshot(), { active: 1, queued: 1, limit: 1, maximumQueue: 1 });
  await assert.rejects(pool.acquire(new AbortController().signal), { code: 'busy' });
  secondController.abort();
  await assert.rejects(queued, { code: 'cancelled' });
  firstRelease();
  assert.deepEqual(pool.snapshot(), { active: 0, queued: 0, limit: 1, maximumQueue: 1 });
});

test('session guard cancels a long-lived media operation shortly after revocation', async () => {
  let checks = 0;
  const sessions = {
    async establish() { throw new Error('unused'); },
    async acquireProviderCredentials() { return null; },
    async revoke() {},
    async resolve() {
      checks += 1;
      return checks < 2
        ? { authenticated: true, expiresAt: new Date(Date.now() + 10_000).toISOString() }
        : null;
    },
  };
  const controller = new AbortController();
  const guard = createMediaSessionGuard(sessions, sessionA, Date.now() + 10_000, controller, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  guard.stop();
  assert.equal(controller.signal.aborted, true);
  assert.ok(checks >= 2);
});

test('session backend failure at media authorization is a HULK-owned 503 rather than expired authentication', async () => {
  const server = await startMediaServer({
    sessions: {
      async establish() { throw new Error('unused'); },
      async resolve() { throw new Error('store unavailable'); },
      async acquireProviderCredentials() { throw new Error('store unavailable'); },
      async revoke() {},
    },
    catalog: {
      async liveChannels() { return []; },
      async movieDetails() { throw new Error('unused'); },
      async seriesDetails() { throw new Error('unused'); },
    },
    transport: { async open() { throw new Error('unused'); } },
    locator: new MediaLocatorCodec(keys.mediaLocatorKey, 60_000),
    adapter: {
      async probe() { throw new Error('unused'); },
      async remux() { throw new Error('unused'); },
    },
    cookieName: 'hulk_session_dev',
    publicOrigin: 'http://placeholder.invalid',
  });
  try {
    const result = await requestJson(server.origin, '/api/media/locators', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://placeholder.invalid',
        cookie: `hulk_session_dev=${sessionA}`,
      },
      body: JSON.stringify({ kind: 'live', id: 'live1' }),
    });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: { code: 'SESSION_UNAVAILABLE' } });
  } finally {
    await server.close();
  }
});

test('downstream disconnect aborts the upstream media signal', async () => {
  const sessions = {
    async establish() { throw new Error('unused'); },
    async revoke() {},
    async resolve() {
      return { authenticated: true, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async acquireProviderCredentials() {
      return { credentials, expiresAtEpochMs: Date.now() + 60_000 };
    },
  };
  let pushed = false;
  let observedSignal = null;
  let signalAbortedResolve;
  const signalAborted = new Promise((resolve) => {
    signalAbortedResolve = resolve;
  });
  const transport = {
    async open(request) {
      observedSignal = request.signal;
      request.signal.addEventListener('abort', () => signalAbortedResolve(), { once: true });
      const body = new Readable({
        read() {
          if (!pushed) {
            pushed = true;
            this.push(Buffer.alloc(1024, 1));
          }
        },
      });
      return {
        status: 200,
        headers: {
          contentType: 'video/mp2t',
          contentLength: null,
          contentRange: null,
          acceptRanges: null,
        },
        body,
        abort() { body.destroy(); },
      };
    },
  };
  const locator = new MediaLocatorCodec(keys.mediaLocatorKey, 60_000);
  const issued = locator.issue(
    sessionA,
    { kind: 'hls', uri: 'https://cdn.example/segment.ts', resource: 'binary' },
    Date.now() + 60_000,
  );
  const server = await startMediaServer({
    sessions,
    catalog: {
      async liveChannels() { return []; },
      async movieDetails() { return { containerExtension: null }; },
      async seriesDetails() { return { seasons: [] }; },
    },
    transport,
    locator,
    adapter: {
      async probe() { return { videoCodecs: [], audioCodecs: [] }; },
      async remux(input) { return { output: input, abort() {} }; },
    },
    cookieName: 'hulk_session_dev',
    publicOrigin: 'http://placeholder.invalid',
  });

  try {
    await new Promise((resolve, reject) => {
      const request = httpGet(
        `${server.origin}/api/media/r/${issued.token}`,
        { headers: { cookie: `hulk_session_dev=${sessionA}` } },
        (response) => {
          response.once('data', () => {
            response.destroy();
            resolve();
          });
        },
      );
      request.once('error', (error) => {
        if (error.code === 'ECONNRESET') resolve();
        else reject(error);
      });
    });
    await Promise.race([
      signalAborted,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('upstream signal was not aborted')),
        100,
      )),
    ]);
    assert.equal(observedSignal?.aborted, true);
  } finally {
    await server.close();
  }
});

test('media HTTP boundary authorizes locators, rewrites HLS, supports Range/HEAD/416/remux and fails after revocation', async () => {
  let activeA = true;
  const sessions = {
    async establish() { throw new Error('unused'); },
    async revoke() { activeA = false; },
    async resolve(token) {
      if ((token === sessionA && activeA) || token === sessionB) {
        return { authenticated: true, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      }
      return null;
    },
    async acquireProviderCredentials(token) {
      if ((token === sessionA && activeA) || token === sessionB) {
        return { credentials, expiresAtEpochMs: Date.now() + 60_000 };
      }
      return null;
    },
  };
  const catalog = {
    async liveChannels() {
      return [{ id: 'live1', name: 'Live', categoryId: null, imageUrl: null, epgChannelId: null }];
    },
    async movieDetails() {
      return { id: 'movie1', containerExtension: 'mp4' };
    },
    async seriesDetails() {
      return {
        seasons: [{
          episodes: [{ id: 'ep1', containerExtension: 'mkv' }],
        }],
      };
    },
  };
  const transportCalls = [];
  const transport = {
    async open(request) {
      transportCalls.push(request);
      if (request.url.pathname.endsWith('.m3u8')) {
        if (request.method === 'HEAD') {
          return {
            status: 200,
            headers: {
              contentType: 'application/vnd.apple.mpegurl',
              contentLength: null,
              contentRange: null,
              acceptRanges: null,
            },
            body: null,
            abort() {},
          };
        }
        return {
          status: 200,
          headers: {
            contentType: 'application/vnd.apple.mpegurl',
            contentLength: null,
            contentRange: null,
            acceptRanges: null,
          },
          body: bodyStream(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/${credentials.username}/${credentials.password}/key"\nsegment.ts\n`),
          abort() {},
        };
      }
      if (request.range === 'bytes=1000-') {
        return {
          status: 416,
          headers: {
            contentType: null,
            contentLength: null,
            contentRange: 'bytes */100',
            acceptRanges: 'bytes',
          },
          body: null,
          abort() {},
        };
      }
      if (request.range) {
        return {
          status: 206,
          headers: {
            contentType: 'video/mp4',
            contentLength: '10',
            contentRange: 'bytes 10-19/100',
            acceptRanges: 'bytes',
          },
          body: request.method === 'HEAD' ? null : bodyStream('0123456789'),
          abort() {},
        };
      }
      return {
        status: 200,
        headers: {
          contentType: 'video/mp4',
          contentLength: '10',
          contentRange: null,
          acceptRanges: 'bytes',
        },
        body: request.method === 'HEAD' ? null : bodyStream('0123456789'),
        abort() {},
      };
    },
  };
  let probeCalls = 0;
  let remuxCalls = 0;
  const adapter = {
    async probe() {
      probeCalls += 1;
      return { videoCodecs: ['h264'], audioCodecs: ['aac'] };
    },
    async remux(input) {
      remuxCalls += 1;
      return { output: input, abort() {} };
    },
  };
  const locator = new MediaLocatorCodec(keys.mediaLocatorKey, 60_000);
  const server = await startMediaServer({
    sessions,
    catalog,
    transport,
    locator,
    adapter,
    cookieName: 'hulk_session_dev',
    publicOrigin: 'http://placeholder.invalid',
  });

  try {
    const unauthenticated = await requestJson(server.origin, '/api/media/locators', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://placeholder.invalid' },
      body: JSON.stringify({ kind: 'live', id: 'live1' }),
    });
    assert.equal(unauthenticated.response.status, 401);

    const issuedLive = await requestJson(server.origin, '/api/media/locators', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://placeholder.invalid',
        cookie: `hulk_session_dev=${sessionA}`,
      },
      body: JSON.stringify({ kind: 'live', id: 'live1' }),
    });
    assert.equal(issuedLive.response.status, 201);
    assert.match(issuedLive.body.url, /^\/api\/media\/r\//u);
    assert.equal(issuedLive.text.includes(credentials.username), false);
    assert.equal(issuedLive.text.includes(credentials.password), false);
    assert.equal(issuedLive.text.includes(credentials.host), false);

    const wrongSession = await requestJson(server.origin, issuedLive.body.url, {
      headers: { cookie: `hulk_session_dev=${sessionB}` },
    });
    assert.equal(wrongSession.response.status, 404);

    const live = await fetch(`${server.origin}${issuedLive.body.url}`, {
      headers: { cookie: `hulk_session_dev=${sessionA}` },
    });
    const manifest = await live.text();
    assert.equal(live.status, 200);
    assert.equal(manifest.includes('provider.example'), false);
    assert.equal(manifest.includes('cdn.example'), false);
    assert.equal(manifest.includes(credentials.username), false);
    assert.match(manifest, /\/api\/media\/r\//u);

    const liveHead = await fetch(`${server.origin}${issuedLive.body.url}`, {
      method: 'HEAD',
      headers: { cookie: `hulk_session_dev=${sessionA}` },
    });
    assert.equal(liveHead.status, 200);
    assert.match(liveHead.headers.get('content-type') ?? '', /mpegurl/iu);

    const issuedMovie = await requestJson(server.origin, '/api/media/locators', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://placeholder.invalid',
        cookie: `hulk_session_dev=${sessionA}`,
      },
      body: JSON.stringify({ kind: 'movie', id: 'movie1' }),
    });
    const range = await fetch(`${server.origin}${issuedMovie.body.url}`, {
      headers: {
        cookie: `hulk_session_dev=${sessionA}`,
        range: 'bytes=10-19',
      },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 10-19/100');
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.equal(await range.text(), '0123456789');

    const movieHead = await fetch(`${server.origin}${issuedMovie.body.url}`, {
      method: 'HEAD',
      headers: { cookie: `hulk_session_dev=${sessionA}` },
    });
    assert.equal(movieHead.status, 200);
    assert.equal(await movieHead.text(), '');

    const unsatisfied = await fetch(`${server.origin}${issuedMovie.body.url}`, {
      headers: {
        cookie: `hulk_session_dev=${sessionA}`,
        range: 'bytes=1000-',
      },
    });
    assert.equal(unsatisfied.status, 416);
    assert.equal(unsatisfied.headers.get('content-range'), 'bytes */100');

    const multiRange = await fetch(`${server.origin}${issuedMovie.body.url}`, {
      headers: {
        cookie: `hulk_session_dev=${sessionA}`,
        range: 'bytes=0-1,4-5',
      },
    });
    assert.equal(multiRange.status, 416);

    const issuedEpisode = await requestJson(server.origin, '/api/media/locators', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://placeholder.invalid',
        cookie: `hulk_session_dev=${sessionA}`,
      },
      body: JSON.stringify({ kind: 'episode', seriesId: 'series1', id: 'ep1' }),
    });
    const remuxed = await fetch(`${server.origin}${issuedEpisode.body.url}`, {
      headers: { cookie: `hulk_session_dev=${sessionA}` },
    });
    assert.equal(remuxed.status, 200);
    assert.equal(remuxed.headers.get('content-type'), 'video/mp4');
    assert.equal(await remuxed.text(), '0123456789');
    assert.equal(probeCalls, 1);
    assert.equal(remuxCalls, 1);

    activeA = false;
    const revoked = await requestJson(server.origin, issuedMovie.body.url, {
      headers: { cookie: `hulk_session_dev=${sessionA}` },
    });
    assert.equal(revoked.response.status, 401);
    assert.ok(transportCalls.length >= 5);
  } finally {
    await server.close();
  }
});
