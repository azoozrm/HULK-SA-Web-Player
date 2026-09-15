import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCatalogCategories,
  normalizeLiveChannels,
  normalizeMetadataUrl,
  normalizeMovieDetails,
  normalizeMovieSummaries,
  normalizeSeriesDetails,
  normalizeSeriesSummaries,
} from '../dist/apps/server/src/catalog/catalog-normalizer.js';

const shortCredentials = Object.freeze({
  host: 'https://provider.example/portal/',
  username: '1',
  password: 'x',
});

test('allow-listed catalog scalars remain valid when their exact value equals an active credential', () => {
  const categories = normalizeCatalogCategories(
    [
      {
        category_id: '1',
        category_name: 'x',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-category',
      },
    ],
    shortCredentials,
  );
  assert.deepEqual(categories, [{ id: '1', name: 'x' }]);

  const live = normalizeLiveChannels(
    [
      {
        stream_id: '1',
        name: 'x',
        category_id: '1',
        epg_channel_id: '1',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-live',
      },
    ],
    shortCredentials,
  );
  assert.deepEqual(live, [
    {
      id: '1',
      name: 'x',
      categoryId: '1',
      imageUrl: null,
      epgChannelId: '1',
    },
  ]);

  const movies = normalizeMovieSummaries(
    [
      {
        stream_id: '1',
        name: 'x',
        category_id: '1',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-movie',
      },
    ],
    shortCredentials,
  );
  assert.equal(movies[0].id, '1');
  assert.equal(movies[0].name, 'x');
  assert.equal(movies[0].categoryId, '1');

  const series = normalizeSeriesSummaries(
    [
      {
        series_id: '1',
        name: 'x',
        category_id: '1',
        plot: 'x',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-series',
      },
    ],
    shortCredentials,
  );
  assert.equal(series[0].id, '1');
  assert.equal(series[0].name, 'x');
  assert.equal(series[0].plot, 'x');

  const movieDetails = normalizeMovieDetails(
    {
      info: {
        name: 'x',
        plot: 'x',
        cast: 'x',
        director: 'x',
        genre: 'x',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-movie-info',
      },
      movie_data: {
        name: 'x',
        category_id: '1',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-movie-data',
      },
    },
    '1',
    shortCredentials,
  );
  assert.equal(movieDetails.id, '1');
  assert.equal(movieDetails.name, 'x');
  assert.equal(movieDetails.categoryId, '1');
  assert.equal(movieDetails.plot, 'x');
  assert.equal(movieDetails.cast, 'x');
  assert.equal(movieDetails.director, 'x');
  assert.equal(movieDetails.genre, 'x');

  const seriesDetails = normalizeSeriesDetails(
    {
      info: {
        name: 'x',
        category_id: '1',
        plot: 'x',
        cast: 'x',
        director: 'x',
        genre: 'x',
        username: '1',
        password: 'x',
        unknown_provider_field: 'raw-series-info',
      },
      seasons: [
        {
          season_number: '1',
          name: 'x',
          username: '1',
          password: 'x',
          unknown_provider_field: 'raw-season',
        },
      ],
      episodes: {
        '1': [
          {
            id: '1',
            title: 'x',
            username: '1',
            password: 'x',
            unknown_provider_field: 'raw-episode',
            info: {
              username: '1',
              password: 'x',
              unknown_provider_field: 'raw-episode-info',
            },
          },
        ],
      },
    },
    '1',
    shortCredentials,
  );
  assert.equal(seriesDetails.id, '1');
  assert.equal(seriesDetails.name, 'x');
  assert.equal(seriesDetails.categoryId, '1');
  assert.deepEqual(seriesDetails.seasons.map((season) => season.seasonKey), ['1']);
  assert.equal(seriesDetails.seasons[0].name, 'x');
  assert.equal(seriesDetails.seasons[0].episodes[0].id, '1');
  assert.equal(seriesDetails.seasons[0].episodes[0].name, 'x');

  for (const normalized of [categories, live, movies, series, movieDetails, seriesDetails]) {
    const serialized = JSON.stringify(normalized);
    assert.equal(serialized.includes('"username"'), false);
    assert.equal(serialized.includes('"password"'), false);
    assert.equal(serialized.includes('unknown_provider_field'), false);
  }
});

test('metadata URL safety remains credential-content sensitive', () => {
  assert.equal(
    normalizeMetadataUrl('https://images.example/library/1/poster.jpg', shortCredentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl('https://images.example/library/x/poster.jpg', shortCredentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl('https://viewer:secret@images.example/poster.jpg', shortCredentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl('https://images.example/poster.jpg?token=safe-looking-value', shortCredentials),
    null,
  );
  assert.equal(
    normalizeMetadataUrl('https://images.example/poster.jpg?username=customer', shortCredentials),
    null,
  );
  assert.equal(normalizeMetadataUrl('javascript:alert(1)', shortCredentials), null);
});
