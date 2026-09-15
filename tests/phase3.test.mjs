import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createCatalogApiHandler } from '../dist/apps/server/src/http/catalog-api.js';
import {
  CatalogNormalizationError,
  normalizeCatalogCategories,
  normalizeLiveChannels,
  normalizeMetadataUrl,
  normalizeMovieDetails,
  normalizeMovieSummaries,
  normalizeSeriesDetails,
  normalizeSeriesSummaries,
} from '../dist/apps/server/src/catalog/catalog-normalizer.js';
import {
  NodeProviderCatalogTransport,
  ProviderCatalogOperationError,
} from '../dist/apps/server/src/network/provider-catalog-transport.js';
import { ProviderTransportError } from '../dist/apps/server/src/network/provider-authentication-transport.js';
import {
  CatalogProviderError,
  XtreamCatalogService,
} from '../dist/apps/server/src/provider/xtream-catalog.js';

const credentials = Object.freeze({
  host: 'https://provider.example/portal/',
  username: 'PRIVATE_USER_778899',
  password: 'PRIVATE_PASS_778899',
});

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

async function startCatalogServer(dependencies) {
  const handler = createCatalogApiHandler(dependencies);
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
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('categories, live channels, and movie summaries normalize Provider variations without raw or credential leakage', () => {
  assert.deepEqual(normalizeCatalogCategories([], credentials), []);
  assert.deepEqual(
    normalizeCatalogCategories(
      [
        { category_id: 7, category_name: ' News ' },
        { category_id: '8', category_name: 'Sports' },
        { category_id: {}, category_name: 'bad' },
      ],
      credentials,
    ),
    [
      { id: '7', name: 'News' },
      { id: '8', name: 'Sports' },
    ],
  );

  const live = normalizeLiveChannels(
    [
      {
        stream_id: '900719925474099312345',
        name: 'Channel One',
        category_id: 7,
        stream_icon: 'https://images.example/channel.png',
        epg_channel_id: 123,
        upstream_only_field: 'must not leak',
      },
      { stream_id: 2, name: 'Channel Two', category_id: null, stream_icon: {} },
      { stream_id: null, name: 'broken' },
    ],
    credentials,
  );
  assert.deepEqual(live, [
    {
      id: '900719925474099312345',
      name: 'Channel One',
      categoryId: '7',
      imageUrl: 'https://images.example/channel.png',
      epgChannelId: null,
    },
    {
      id: '2',
      name: 'Channel Two',
      categoryId: null,
      imageUrl: null,
      epgChannelId: null,
    },
  ]);
  assert.equal(JSON.stringify(live).includes('stream_id'), false);
  assert.equal(JSON.stringify(live).includes('upstream_only_field'), false);

  const movies = normalizeMovieSummaries(
    [
      {
        stream_id: '44',
        name: 'Movie',
        category_id: '3',
        stream_icon: `https://images.example/poster.jpg?username=${credentials.username}`,
        year: '2025',
        rating: '8.4',
        container_extension: 'MP4',
      },
    ],
    credentials,
  );
  assert.deepEqual(movies, [
    {
      id: '44',
      name: 'Movie',
      categoryId: '3',
      posterUrl: null,
      year: 2025,
      rating: 8.4,
      containerExtension: 'mp4',
    },
  ]);

  assert.deepEqual(
    normalizeLiveChannels(
      [{ stream_id: '5', name: credentials.password, category_id: '1' }],
      credentials,
    ),
    [
      {
        id: '5',
        name: credentials.password,
        categoryId: '1',
        imageUrl: null,
        epgChannelId: null,
      },
    ],
  );
  assert.throws(() => normalizeCatalogCategories({}, credentials), CatalogNormalizationError);
  assert.throws(
    () => normalizeLiveChannels([{ stream_id: null, name: null }], credentials),
    CatalogNormalizationError,
  );
});

test('short credentials do not destroy unrelated catalog values that only overlap incidentally', () => {
  const shortCredentials = Object.freeze({
    host: 'https://provider.example/portal/',
    username: '1',
    password: 'x',
  });

  assert.deepEqual(
    normalizeCatalogCategories(
      [{ category_id: '10', category_name: 'News 1', username: '1', password: 'x' }],
      shortCredentials,
    ),
    [{ id: '10', name: 'News 1' }],
  );

  const live = normalizeLiveChannels(
    [
      {
        stream_id: '101',
        name: 'Channel 1 Extra',
        category_id: '10',
        username: '1',
        password: 'x',
        raw_provider_field: 'must stay server-side',
      },
    ],
    shortCredentials,
  );
  assert.equal(live[0].id, '101');
  assert.equal(live[0].name, 'Channel 1 Extra');
  assert.equal(live[0].categoryId, '10');
  const serializedLive = JSON.stringify(live);
  assert.equal(serializedLive.includes('username'), false);
  assert.equal(serializedLive.includes('password'), false);
  assert.equal(serializedLive.includes('raw_provider_field'), false);

  const movies = normalizeMovieSummaries(
    [{ stream_id: '210', name: 'Movie x Edition', category_id: '10' }],
    shortCredentials,
  );
  assert.equal(movies[0].name, 'Movie x Edition');
  assert.equal(movies[0].categoryId, '10');

  const series = normalizeSeriesSummaries(
    [{ series_id: '310', name: 'Series 1 x', category_id: '10' }],
    shortCredentials,
  );
  assert.equal(series[0].name, 'Series 1 x');

  const details = normalizeSeriesDetails(
    {
      info: { name: 'Series 1 x' },
      seasons: [],
      episodes: {
        '10': [{ id: 'e10', title: 'Episode 1 x', info: {} }],
      },
    },
    '310',
    shortCredentials,
  );
  assert.deepEqual(details.seasons.map((season) => season.seasonKey), ['10']);
  assert.equal(details.seasons[0].episodes[0].name, 'Episode 1 x');

  assert.equal(
    normalizeMetadataUrl('https://images.example/library/1/poster.jpg', shortCredentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl('https://images.example/poster.jpg?token=x', shortCredentials),
    null,
  );
  assert.equal(normalizeMetadataUrl('https://user:pass@images.example/a.jpg', shortCredentials), null);
  assert.equal(normalizeMetadataUrl('https://images.example/a.jpg?session=value', shortCredentials), null);
});

test('movie details tolerate incomplete optional metadata but reject completely invalid detail payloads', () => {
  const details = normalizeMovieDetails(
    {
      info: {
        movie_image: 'https://images.example/movie.jpg',
        plot: 'Plot',
        duration_secs: '5400',
        cast: 'Actor A',
        director: null,
        genre: 'Drama',
        releaseDate: '2025-05-01',
        rating: '7.5',
      },
      movie_data: {
        stream_id: '999',
        name: 'Movie Name',
        category_id: 4,
        container_extension: 'mkv',
      },
    },
    '999',
    credentials,
  );
  assert.equal(details.id, '999');
  assert.equal(details.name, 'Movie Name');
  assert.equal(details.durationSeconds, 5400);
  assert.equal(details.director, null);
  assert.equal(details.releasedAt, '2025-05-01');
  assert.equal(details.year, 2025);
  assert.equal(details.containerExtension, 'mkv');

  const sparse = normalizeMovieDetails({ info: {} }, '11', credentials);
  assert.equal(sparse.name, null);
  assert.equal(sparse.posterUrl, null);
  assert.equal(sparse.durationSeconds, null);
  assert.equal(sparse.releasedAt, null);
  assert.throws(() => normalizeMovieDetails({}, '11', credentials), CatalogNormalizationError);
});

test('series episode groups remain authoritative when top-level seasons are empty or incomplete', () => {
  const summaries = normalizeSeriesSummaries(
    [{ series_id: '55', name: 'Series', category_id: '9', year: '2024', rating: '9.1' }],
    credentials,
  );
  assert.equal(summaries[0].id, '55');
  assert.equal(summaries[0].year, 2024);

  const details = normalizeSeriesDetails(
    {
      info: {
        name: 'Series',
        category_id: '9',
        cover: 'https://images.example/series.jpg',
      },
      seasons: [],
      episodes: {
        '2': [
          { id: 'e2', episode_num: '2', title: 'Episode 2', container_extension: 'mp4', info: {} },
        ],
        Specials: [
          { id: 'sp1', episode_num: 'not-a-number', title: 'Special', info: {} },
        ],
        '1': [
          { id: 'e1', episode_num: 1, title: 'Episode 1', info: { duration_secs: '1500' } },
          { id: null, episode_num: 99, title: 'Malformed item' },
        ],
      },
    },
    '55',
    credentials,
  );
  assert.deepEqual(details.seasons.map((season) => season.seasonKey), ['1', '2', 'Specials']);
  assert.equal(details.seasons[0].seasonNumber, 1);
  assert.equal(details.seasons[0].episodes.length, 1);
  assert.equal(details.seasons[2].episodes[0].episodeNumber, null);

  const incompleteMetadata = normalizeSeriesDetails(
    {
      info: { name: 'Series' },
      seasons: [{ season_number: '1', name: 'Season One' }],
      episodes: {
        '1': [{ id: 'a', title: 'A', info: {} }],
        '3': [{ id: 'b', title: 'B', info: {} }],
      },
    },
    '55',
    credentials,
  );
  assert.deepEqual(incompleteMetadata.seasons.map((season) => season.seasonKey), ['1', '3']);
  assert.equal(incompleteMetadata.seasons[0].name, 'Season One');
  assert.equal(incompleteMetadata.seasons[1].name, null);

  assert.throws(
    () => normalizeSeriesDetails({ episodes: { '1': [{ id: null }] } }, '55', credentials),
    CatalogNormalizationError,
  );
  assert.throws(() => normalizeSeriesDetails({}, '55', credentials), CatalogNormalizationError);
});

test('metadata URL safety rejects credentials, userinfo, secret query names, and non-HTTP schemes', () => {
  assert.equal(
    normalizeMetadataUrl('https://images.example/poster.jpg?size=large', credentials),
    'https://images.example/poster.jpg?size=large',
  );
  assert.equal(normalizeMetadataUrl('https://user:pass@images.example/a.jpg', credentials), null);
  assert.equal(normalizeMetadataUrl('javascript:alert(1)', credentials), null);
  assert.equal(
    normalizeMetadataUrl(`https://images.example/a.jpg?token=${credentials.password}`, credentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl(`https://images.example/${credentials.username}/a.jpg`, credentials),
    null,
  );
});

test('catalog transport constructs only allow-listed Xtream operations on the SSRF-bound destination', async () => {
  let resolverCalls = 0;
  let capturedRequest;
  let capturedLimits;
  const transport = new NodeProviderCatalogTransport(
    {
      async resolve(hostname) {
        resolverCalls += 1;
        assert.equal(hostname, 'provider.example');
        return [{ address: '93.184.216.34', family: 4 }];
      },
    },
    async (request, limits) => {
      capturedRequest = request;
      capturedLimits = limits;
      return { status: 200, body: jsonBytes([]) };
    },
  );

  await transport.request(credentials, { kind: 'movie-streams', categoryId: '7' });
  assert.equal(resolverCalls, 1);
  assert.equal(capturedRequest.connectAddress, '93.184.216.34');
  assert.equal(capturedRequest.family, 4);
  assert.equal(capturedRequest.tlsServername, 'provider.example');
  assert.equal(capturedRequest.hostHeader, 'provider.example');
  const internalUrl = new URL(`https://provider.example${capturedRequest.pathWithQuery}`);
  assert.equal(internalUrl.searchParams.get('action'), 'get_vod_streams');
  assert.equal(internalUrl.searchParams.get('category_id'), '7');
  assert.equal(internalUrl.searchParams.get('username'), credentials.username);
  assert.equal(internalUrl.searchParams.get('password'), credentials.password);
  assert.equal(capturedLimits.maximumResponseBytes, 16 * 1024 * 1024);

  await assert.rejects(
    transport.request(credentials, { kind: 'movie-info', id: '7&action=get_live_streams' }),
    ProviderCatalogOperationError,
  );
  await assert.rejects(
    transport.request(credentials, { kind: 'arbitrary-provider-action', action: 'anything' }),
    ProviderCatalogOperationError,
  );
});

test('catalog service maps bounded transport failures, authentication rejection, and malformed Provider data without exposing raw bodies', async () => {
  const timeoutService = new XtreamCatalogService({
    async request() {
      throw new ProviderTransportError('timeout');
    },
  });
  await assert.rejects(
    timeoutService.liveCategories(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'provider_timeout',
  );

  const oversizedService = new XtreamCatalogService({
    async request() {
      throw new ProviderTransportError('response_too_large');
    },
  });
  await assert.rejects(
    oversizedService.movies(credentials, null),
    (error) => error instanceof CatalogProviderError && error.code === 'response_too_large',
  );

  const rejectedService = new XtreamCatalogService({
    async request() {
      return { status: 302, body: jsonBytes({ password: credentials.password, raw: 'PRIVATE' }) };
    },
  });
  await assert.rejects(
    rejectedService.liveCategories(credentials),
    (error) => {
      assert.ok(error instanceof CatalogProviderError);
      assert.equal(error.code, 'provider_rejected');
      assert.equal(error.message.includes(credentials.password), false);
      assert.equal(error.message.includes('PRIVATE'), false);
      return true;
    },
  );

  const authRejected = new XtreamCatalogService({
    async request() {
      return { status: 200, body: jsonBytes({ user_info: { auth: 0 } }) };
    },
  });
  await assert.rejects(
    authRejected.liveCategories(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'provider_rejected',
  );

  const malformedService = new XtreamCatalogService({
    async request() {
      return { status: 200, body: jsonBytes({ unexpected: true }) };
    },
  });
  await assert.rejects(
    malformedService.liveCategories(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'malformed_response',
  );

  const missingDetail = new XtreamCatalogService({
    async request() {
      return { status: 200, body: jsonBytes([]) };
    },
  });
  await assert.rejects(
    missingDetail.movieDetails(credentials, '1'),
    (error) => error instanceof CatalogProviderError && error.code === 'not_found',
  );
});

test('capability discovery requires structurally usable category evidence', async () => {
  const structurallySupported = new XtreamCatalogService({
    async request(_credentials, operation) {
      if (operation.kind === 'live-categories') return { status: 200, body: jsonBytes([]) };
      if (operation.kind === 'movie-categories') {
        return {
          status: 200,
          body: jsonBytes([{ category_id: '10', category_name: 'Movies' }]),
        };
      }
      return {
        status: 200,
        body: jsonBytes([
          { category_id: '20', category_name: 'Series' },
          { unexpected: true },
        ]),
      };
    },
  });
  assert.deepEqual(await structurallySupported.capabilities(credentials), {
    epg: 'unknown',
    live: true,
    movies: true,
    series: true,
  });

  const explicitlyUnsupported = new XtreamCatalogService({
    async request(_credentials, operation) {
      if (operation.kind === 'movie-categories') return { status: 404, body: jsonBytes({}) };
      return { status: 200, body: jsonBytes([]) };
    },
  });
  assert.deepEqual(await explicitlyUnsupported.capabilities(credentials), {
    epg: 'unknown',
    live: true,
    movies: false,
    series: true,
  });

  const unusableArray = new XtreamCatalogService({
    async request(_credentials, operation) {
      if (operation.kind === 'live-categories') {
        return { status: 200, body: jsonBytes([{ unexpected: true }]) };
      }
      return { status: 200, body: jsonBytes([]) };
    },
  });
  await assert.rejects(
    unusableArray.capabilities(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'malformed_response',
  );

  const nonArray = new XtreamCatalogService({
    async request(_credentials, operation) {
      if (operation.kind === 'live-categories') {
        return { status: 200, body: jsonBytes({ category_id: '1', category_name: 'Live' }) };
      }
      return { status: 200, body: jsonBytes([]) };
    },
  });
  await assert.rejects(
    nonArray.capabilities(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'malformed_response',
  );

  const authRejected = new XtreamCatalogService({
    async request() {
      return { status: 200, body: jsonBytes({ user_info: { auth: 0 } }) };
    },
  });
  await assert.rejects(
    authRejected.capabilities(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'provider_rejected',
  );

  const unavailable = new XtreamCatalogService({
    async request() {
      throw new ProviderTransportError('timeout');
    },
  });
  await assert.rejects(
    unavailable.capabilities(credentials),
    (error) => error instanceof CatalogProviderError && error.code === 'provider_timeout',
  );
});

test('catalog HTTP API requires a valid HULK session, uses the credential lease, isolates accounts, validates inputs, and sends no-store', async () => {
  const tokenA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const tokenB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const tokenExpired = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
  const leaseByToken = new Map([
    [tokenA, { credentials: { ...credentials, host: 'https://provider-a.example/' }, expiresAtEpochMs: Date.now() + 60_000 }],
    [tokenB, { credentials: { ...credentials, host: 'https://provider-b.example/', username: 'OTHER_PRIVATE_USER' }, expiresAtEpochMs: Date.now() + 60_000 }],
    [tokenExpired, { credentials, expiresAtEpochMs: Date.now() - 1 }],
  ]);
  const acquired = [];
  const categoryCalls = [];
  const catalogCalls = [];
  const sessions = {
    async establish() { throw new Error('not used'); },
    async resolve() { throw new Error('catalog must use credential lease'); },
    async acquireProviderCredentials(token) {
      acquired.push(token);
      return leaseByToken.get(token) ?? null;
    },
    async revoke() {},
  };
  const catalog = {
    async capabilities() { return { epg: 'unknown', live: true, movies: true, series: true }; },
    async liveCategories(account) {
      catalogCalls.push(account.host);
      return [{ id: account.host.includes('provider-a') ? 'account-a' : 'account-b', name: 'Owned catalog' }];
    },
    async liveChannels(_account, categoryId) {
      categoryCalls.push(categoryId);
      return [];
    },
    async movieCategories() { return []; },
    async movies() { return []; },
    async movieDetails(_account, id) { return { id, name: null, categoryId: null, posterUrl: null, year: null, rating: null, containerExtension: null, plot: null, durationSeconds: null, cast: null, director: null, genre: null, releasedAt: null }; },
    async seriesCategories() { return []; },
    async series() { return []; },
    async seriesDetails(_account, id) { return { id, name: null, categoryId: null, posterUrl: null, year: null, rating: null, plot: null, cast: null, director: null, genre: null, releasedAt: null, seasons: [] }; },
  };
  const server = await startCatalogServer({ sessions, catalog, cookieName: 'hulk_session' });
  try {
    const unauthenticated = await fetch(`${server.baseUrl}/api/catalog/live/categories`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(acquired.length, 0);

    const revoked = await fetch(`${server.baseUrl}/api/catalog/live/categories`, {
      headers: { Cookie: 'hulk_session=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
    });
    assert.equal(revoked.status, 401);

    const expired = await fetch(`${server.baseUrl}/api/catalog/live/categories`, {
      headers: { Cookie: `hulk_session=${tokenExpired}` },
    });
    assert.equal(expired.status, 401);
    assert.equal(catalogCalls.length, 0);

    const responseA = await fetch(`${server.baseUrl}/api/catalog/live/categories`, {
      headers: { Cookie: `hulk_session=${tokenA}` },
    });
    const bodyA = await responseA.json();
    assert.equal(responseA.status, 200);
    assert.equal(responseA.headers.get('cache-control'), 'no-store');
    assert.equal(bodyA.items[0].id, 'account-a');
    const serializedA = JSON.stringify(bodyA);
    assert.equal(serializedA.includes(credentials.username), false);
    assert.equal(serializedA.includes(credentials.password), false);
    assert.equal(serializedA.includes(tokenA), false);

    const responseB = await fetch(`${server.baseUrl}/api/catalog/live/categories`, {
      headers: { Cookie: `hulk_session=${tokenB}` },
    });
    const bodyB = await responseB.json();
    assert.equal(bodyB.items[0].id, 'account-b');
    assert.notDeepEqual(bodyA, bodyB);

    const filtered = await fetch(`${server.baseUrl}/api/catalog/live?categoryId=77`, {
      headers: { Cookie: `hulk_session=${tokenA}` },
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(categoryCalls, ['77']);

    const injected = await fetch(`${server.baseUrl}/api/catalog/movies/7%26action%3Dget_live_streams`, {
      headers: { Cookie: `hulk_session=${tokenA}` },
    });
    assert.equal(injected.status, 400);

    const unknownQuery = await fetch(`${server.baseUrl}/api/catalog/live?action=get_live_streams`, {
      headers: { Cookie: `hulk_session=${tokenA}` },
    });
    assert.equal(unknownQuery.status, 400);
  } finally {
    await server.close();
  }
});

test('catalog HTTP errors are HULK-owned and do not expose Provider body, credentials, session tokens, or stacks', async () => {
  const token = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  const sessions = {
    async establish() { throw new Error('not used'); },
    async resolve() { return null; },
    async acquireProviderCredentials() {
      return { credentials, expiresAtEpochMs: Date.now() + 60_000 };
    },
    async revoke() {},
  };
  const catalog = {
    async capabilities() { throw new CatalogProviderError('provider_timeout'); },
    async liveCategories() { throw new CatalogProviderError('malformed_response'); },
    async liveChannels() { return []; },
    async movieCategories() { return []; },
    async movies() { return []; },
    async movieDetails() { throw new CatalogProviderError('not_found'); },
    async seriesCategories() { return []; },
    async series() { return []; },
    async seriesDetails() { return { id: '1', name: null, categoryId: null, posterUrl: null, year: null, rating: null, plot: null, cast: null, director: null, genre: null, releasedAt: null, seasons: [] }; },
  };
  const server = await startCatalogServer({ sessions, catalog, cookieName: 'hulk_session' });
  try {
    const response = await fetch(`${server.baseUrl}/api/catalog/live/categories`, {
      headers: { Cookie: `hulk_session=${token}` },
    });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal(text, JSON.stringify({ error: { code: 'MALFORMED_PROVIDER_RESPONSE' } }));
    for (const forbidden of [credentials.username, credentials.password, token, 'stack', 'provider.example']) {
      assert.equal(text.includes(forbidden), false);
    }

    const timeout = await fetch(`${server.baseUrl}/api/catalog/capabilities`, {
      headers: { Cookie: `hulk_session=${token}` },
    });
    assert.equal(timeout.status, 504);
    assert.deepEqual(await timeout.json(), { error: { code: 'PROVIDER_TIMEOUT' } });

    const missing = await fetch(`${server.baseUrl}/api/catalog/movies/44`, {
      headers: { Cookie: `hulk_session=${token}` },
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: 'CATALOG_ITEM_NOT_FOUND' } });
  } finally {
    await server.close();
  }
});
