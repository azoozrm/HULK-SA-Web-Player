import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizedCapabilities,
  normalizedMovieDetails,
  normalizedSeriesDetails,
} from './fixtures/phase5b-normalized-catalog.mjs';
import { CatalogClient, CatalogClientError, catalogEndpoint } from '../dist/apps/web/src/catalog-client.js';
import {
  browserSafeImageUrl,
  CATALOG_COPY,
  CATALOG_RENDER_BATCH_SIZE,
  initialCatalogRenderCount,
  initialSeriesSeasonKey,
  isCatalogFamilySupported,
  movieDetailsMetadata,
  nextCatalogRenderCount,
  RequestOwner,
  resolveSeriesSeason,
} from '../dist/apps/web/src/catalog-model.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Phase 5B catalog client remains /player base-path safe and maps category selection to Phase 3 routes', () => {
  assert.equal(catalogEndpoint('/player', 'capabilities'), '/player/api/catalog/capabilities');
  assert.equal(catalogEndpoint('/player', 'live-categories'), '/player/api/catalog/live/categories');
  assert.equal(catalogEndpoint('/player', 'live'), '/player/api/catalog/live');
  assert.equal(catalogEndpoint('/player', 'live', 'news 1'), '/player/api/catalog/live?categoryId=news%201');
  assert.equal(catalogEndpoint('/player', 'movie-categories'), '/player/api/catalog/movies/categories');
  assert.equal(catalogEndpoint('/player', 'movies', '4'), '/player/api/catalog/movies?categoryId=4');
  assert.equal(catalogEndpoint('/player', 'series-categories'), '/player/api/catalog/series/categories');
  assert.equal(catalogEndpoint('/player', 'series', '7'), '/player/api/catalog/series?categoryId=7');
});

test('Phase 5B catalog requests use same-origin credentials and normalized HULK endpoints only', async () => {
  const calls = [];
  const client = new CatalogClient(async (input, init) => {
    calls.push({ input, init });
    if (input.endsWith('/capabilities')) return jsonResponse(normalizedCapabilities);
    return jsonResponse({ items: [] });
  }, '/player');
  const controller = new AbortController();
  await client.capabilities(controller.signal);
  await client.liveChannels(null, controller.signal);
  await client.movies('12', controller.signal);
  await client.series('8', controller.signal);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.cache, 'no-store');
    assert.match(call.input, /^\/player\/api\/catalog\//u);
    assert.doesNotMatch(call.input, /\/api\/media\//u);
  }
});

test('Phase 5B capability contract directly drives supported and unsupported family state', () => {
  const capabilities = Object.freeze({ ...normalizedCapabilities, movies: false });
  assert.equal(isCatalogFamilySupported(capabilities, 'live'), true);
  assert.equal(isCatalogFamilySupported(capabilities, 'movies'), false);
  assert.equal(isCatalogFamilySupported(capabilities, 'series'), true);
});

test('Phase 5B request ownership aborts obsolete work and stale generations lose ownership', () => {
  const owner = new RequestOwner();
  const first = owner.begin();
  assert.equal(owner.owns(first.id), true);
  const second = owner.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(owner.owns(first.id), false);
  assert.equal(owner.owns(second.id), true);
  owner.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(owner.owns(second.id), false);
});

test('Phase 5B confirmed unauthenticated catalog response becomes explicit session-expired state', async () => {
  const client = new CatalogClient(async () => jsonResponse({ error: { code: 'SESSION_EXPIRED' } }, 401), '/player');
  const controller = new AbortController();
  await assert.rejects(
    () => client.capabilities(controller.signal),
    (error) => error instanceof CatalogClientError && error.kind === 'session-expired' && error.status === 401,
  );
});

test('Phase 5B Movie details presentation emits only normalized metadata that actually exists', () => {
  const metadata = movieDetailsMetadata(normalizedMovieDetails);
  assert.deepEqual(metadata.map(({ label, value }) => [label, value]), [
    [CATALOG_COPY.year, '2026'],
    [CATALOG_COPY.duration, '1:30'],
    [CATALOG_COPY.director, 'Director'],
  ]);
});

test('Phase 5B Series presentation consumes normalized seasons and episode groups without raw Provider reinterpretation', () => {
  assert.equal(initialSeriesSeasonKey(normalizedSeriesDetails), '2');
  assert.equal(resolveSeriesSeason(normalizedSeriesDetails, '2')?.episodes[0]?.id, 'episode-9');
  assert.equal(resolveSeriesSeason(normalizedSeriesDetails, '1'), null);
});

test('Phase 5B large-list policy is deterministic and bounded without claiming Provider pagination', () => {
  assert.equal(CATALOG_RENDER_BATCH_SIZE, 60);
  assert.equal(initialCatalogRenderCount(0), 0);
  assert.equal(initialCatalogRenderCount(12), 12);
  assert.equal(initialCatalogRenderCount(5000), 60);
  assert.equal(nextCatalogRenderCount(60, 5000), 120);
  assert.equal(nextCatalogRenderCount(4980, 5000), 5000);
});

test('Phase 5B image policy preserves the self-only CSP boundary and falls back for Provider origins', () => {
  assert.equal(
    browserSafeImageUrl('https://hulksa.com/player/poster.jpg', 'https://hulksa.com'),
    'https://hulksa.com/player/poster.jpg',
  );
  assert.equal(browserSafeImageUrl('https://provider.example/poster.jpg', 'https://hulksa.com'), null);
  assert.equal(browserSafeImageUrl('http://hulksa.com/poster.jpg', 'https://hulksa.com'), null);
  assert.equal(browserSafeImageUrl('https://user:pass@hulksa.com/poster.jpg', 'https://hulksa.com'), null);
});

test('Phase 5B browser source uses normalized contracts only and adds no media locator, persistence or client logging', async () => {
  const files = [
    '../apps/web/src/catalog-app.ts',
    '../apps/web/src/catalog-client.ts',
    '../apps/web/src/catalog-model.ts',
    '../apps/web/src/catalog-view.ts',
    '../apps/web/src/catalog-view-details.ts',
    '../apps/web/src/catalog-view-helpers.ts',
    '../apps/web/src/catalog-view-listing.ts',
    '../apps/web/src/catalog-view-state.ts',
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')));
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/iu);
  assert.doesNotMatch(combined, /\bconsole\.(?:log|info|warn|error|debug)\b/u);
  assert.doesNotMatch(combined, /\/api\/media\/locators|MediaLocatorDescriptor|MediaLocatorRequest/u);
  assert.doesNotMatch(combined, /stream_id|series_id|get_live_streams|get_vod_streams|get_series_info|root\.episodes/u);
  assert.match(combined, /credentials:\s*'same-origin'/u);
  assert.match(combined, /details\.seasons/u);
});

test('Phase 5B destination, category, detail, logout and session-expiry work have explicit invalidation ownership', async () => {
  const source = await readFile(new URL('../apps/web/src/catalog-app.ts', import.meta.url), 'utf8');
  assert.match(source, /function resetData\(\): void \{[\s\S]*capabilitiesOwner\.invalidate\(\)[\s\S]*listingOwner\.invalidate\(\)[\s\S]*detailsOwner\.invalidate\(\)/u);
  assert.match(source, /function leaveExpiredSession\(\): void \{[\s\S]*resetData\(\)[\s\S]*root\.replaceChildren\(\)[\s\S]*window\.location\.reload\(\)/u);
  assert.match(source, /if \(shellBusy\(\)\) \{[\s\S]*resetData\(\)/u);
  assert.match(source, /if \(next !== destination\) \{[\s\S]*listingOwner\.invalidate\(\)[\s\S]*detailsOwner\.invalidate\(\)/u);
  assert.match(source, /const owned = listingOwner\.begin\(\)/u);
  assert.match(source, /const owned = detailsOwner\.begin\(\)/u);
  assert.match(source, /new MutationObserver\(sync\)\.observe\(root, \{ childList: true \}\)/u);
});

test('Phase 5B added Arabic catalog copy follows the no-hamza, no-harakat and no trailing-full-stop rule', () => {
  for (const value of Object.values(CATALOG_COPY)) {
    assert.doesNotMatch(value, /[أإآ\u064B-\u065F\u0670]/u);
    assert.doesNotMatch(value, /\.$/u);
  }
});

test('Phase 5B qualification packaging and static revisioning include the complete catalog browser surface', async () => {
  const [workflow, appPath, appHandler, index, copyStatic] = await Promise.all([
    readFile(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8'),
    readFile(new URL('../apps/server/src/http/app-path.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/server/src/http/app-handler.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../tools/copy-static.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(workflow, /Phase-5B-Rendered-Qualification/u);
  assert.doesNotMatch(workflow, /Phase-5A-Rendered-Qualification/u);
  assert.match(appPath, /catalog\.css/u);
  assert.match(appPath, /catalog-app\.js/u);
  for (const asset of [
    'catalog-app.js',
    'catalog-view.js',
    'catalog-view-details.js',
    'catalog-view-helpers.js',
    'catalog-view-listing.js',
    'catalog-view-state.js',
    'catalog-client.js',
    'catalog-model.js',
  ]) {
    assert.match(appHandler, new RegExp(asset.replace('.', '\\.'), 'u'));
  }
  assert.match(appHandler, /img-src 'self'/u);
  assert.match(index, /catalog\.css/u);
  assert.match(index, /catalog-app\.js/u);
  assert.match(copyStatic, /catalog\.css/u);
});
