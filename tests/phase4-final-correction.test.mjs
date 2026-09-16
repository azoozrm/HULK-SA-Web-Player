import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HlsManifestError,
  rewriteHlsManifest,
} from '../dist/apps/server/src/media/hls-rewriter.js';
import {
  ProviderMediaTransportError,
  validateProviderMediaRangeResponse,
} from '../dist/apps/server/src/network/provider-media-transport.js';

function mediaHeaders(contentRange, contentLength = null) {
  return Object.freeze({
    contentType: 'video/mp4',
    contentLength,
    contentRange,
    acceptRanges: 'bytes',
  });
}

function assertRangeProtocolError(callback) {
  assert.throws(callback, (error) => (
    error instanceof ProviderMediaTransportError && error.code === 'upstream_protocol_error'
  ));
}

test('Provider 206 and 416 responses remain bound to the exact browser byte-range request', () => {
  assert.doesNotThrow(() => validateProviderMediaRangeResponse(
    'bytes=10-19',
    206,
    mediaHeaders('bytes 10-19/100', '10'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=10-19',
    206,
    mediaHeaders('bytes 0-9/100', '10'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=10-19',
    206,
    mediaHeaders('bytes 10-29/100', '20'),
  ));

  assert.doesNotThrow(() => validateProviderMediaRangeResponse(
    'bytes=10-',
    206,
    mediaHeaders('bytes 10-99/100', '90'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=10-',
    206,
    mediaHeaders('bytes 11-99/100', '89'),
  ));

  assert.doesNotThrow(() => validateProviderMediaRangeResponse(
    'bytes=-25',
    206,
    mediaHeaders('bytes 75-99/100', '25'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=-25',
    206,
    mediaHeaders('bytes 74-99/100', '26'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=-25',
    206,
    mediaHeaders('bytes 75-99/*', '25'),
  ));

  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    null,
    206,
    mediaHeaders('bytes 10-19/100', '10'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=10-19',
    206,
    mediaHeaders('bytes 10-19/100', '9'),
  ));

  assert.doesNotThrow(() => validateProviderMediaRangeResponse(
    'bytes=10-19',
    200,
    mediaHeaders(null, '100'),
  ));

  assert.doesNotThrow(() => validateProviderMediaRangeResponse(
    'bytes=1000-',
    416,
    mediaHeaders('bytes */100'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    null,
    416,
    mediaHeaders('bytes */100'),
  ));
  assertRangeProtocolError(() => validateProviderMediaRangeResponse(
    'bytes=10-',
    416,
    mediaHeaders('bytes */100'),
  ));
});

test('HLS URI attributes fail closed on malformed case while valid uppercase and optional absence remain safe', () => {
  const manifestUrl = new URL('https://provider.example/root/master.m3u8');
  const locator = () => '/api/media/r/opaque-locator';
  const malformedLines = [
    '#EXT-X-KEY:METHOD=AES-128,uri="segment.ts"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",Uri="audio/main.m3u8"',
    '#EXT-X-KEY:METHOD=AES-128,uRi="PRIVATE_USER_778899/PRIVATE_PASS_778899/key"',
    '#EXT-X-KEY:METHOD=AES-128,uri="https://cdn.example/key"',
    '#EXT-X-UNKNOWN:TYPE=TEST,UrI="relative/path.ts"',
  ];

  for (const line of malformedLines) {
    assert.throws(
      () => rewriteHlsManifest(
        Buffer.from(`#EXTM3U\n${line}\n`, 'utf8'),
        manifestUrl,
        locator,
      ),
      HlsManifestError,
    );
  }

  const rewritten = rewriteHlsManifest(
    Buffer.from(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key"\nsegment.ts\n',
      'utf8',
    ),
    manifestUrl,
    locator,
  ).toString('utf8');
  assert.match(rewritten, /\/api\/media\/r\/opaque-locator/u);
  assert.equal(rewritten.includes('provider.example'), false);
  assert.equal(rewritten.includes('cdn.example'), false);
  assert.equal(rewritten.includes('http://'), false);
  assert.equal(rewritten.includes('https://'), false);

  const optionalWithoutUri = rewriteHlsManifest(
    Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\nsegment.ts\n', 'utf8'),
    manifestUrl,
    locator,
  ).toString('utf8');
  assert.match(optionalWithoutUri, /#EXT-X-KEY:METHOD=NONE/u);
  assert.match(optionalWithoutUri, /\/api\/media\/r\/opaque-locator/u);
});

test('HLS Content Steering and other known unsupported client-fetch URI surfaces fail closed', () => {
  const manifestUrl = new URL('https://provider.example/root/master.m3u8');
  const locator = () => '/api/media/r/opaque-locator';
  const steeringLines = [
    '#EXT-X-CONTENT-STEERING:SERVER-URI="https://steering.example/manifest.json"',
    '#EXT-X-CONTENT-STEERING:SERVER-URI="http://steering.example/manifest.json"',
    '#EXT-X-CONTENT-STEERING:SERVER-URI="data:application/json,%7B%7D"',
    '#EXT-X-CONTENT-STEERING:SERVER-URI="//steering.example/manifest.json"',
    '#EXT-X-CONTENT-STEERING:SERVER-URI="steering/manifest.json"',
    '#EXT-X-CONTENT-STEERING:server-uri="steering/manifest.json"',
    '#EXT-X-CONTENT-STEERING:Server-Uri="steering/manifest.json"',
  ];

  for (const line of steeringLines) {
    assert.throws(
      () => rewriteHlsManifest(
        Buffer.from(`#EXTM3U\n${line}\n`, 'utf8'),
        manifestUrl,
        locator,
      ),
      HlsManifestError,
    );
  }

  const unsupportedDateRangeLines = [
    '#EXT-X-DATERANGE:ID="ad1",CLASS="com.apple.hls.interstitial",X-ASSET-URI="ad.m3u8"',
    '#EXT-X-DATERANGE:ID="ad2",CLASS="com.apple.hls.interstitial",X-ASSET-LIST="assets.json"',
    '#EXT-X-DATERANGE:ID="preload1",CLASS="com.apple.hls.preload",X-URI="resource.json"',
    '#EXT-X-DATERANGE:ID="ad3",CLASS="com.apple.hls.interstitial",x-asset-uri="ad.m3u8"',
  ];

  for (const line of unsupportedDateRangeLines) {
    assert.throws(
      () => rewriteHlsManifest(
        Buffer.from(`#EXTM3U\n${line}\n`, 'utf8'),
        manifestUrl,
        locator,
      ),
      HlsManifestError,
    );
  }

  const rewritten = rewriteHlsManifest(
    Buffer.from(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key"\n#EXT-X-KEY:METHOD=NONE\nsegment.ts\n',
      'utf8',
    ),
    manifestUrl,
    locator,
  ).toString('utf8');
  assert.match(rewritten, /URI="\/api\/media\/r\/opaque-locator"/u);
  assert.match(rewritten, /#EXT-X-KEY:METHOD=NONE/u);
  assert.equal(rewritten.includes('provider.example'), false);
  assert.equal(rewritten.includes('cdn.example'), false);
  assert.equal(rewritten.includes('steering.example'), false);
  assert.equal(rewritten.includes('http://'), false);
  assert.equal(rewritten.includes('https://'), false);
});
