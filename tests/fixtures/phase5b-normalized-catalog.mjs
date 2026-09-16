export const normalizedCapabilities = Object.freeze({
  epg: 'unknown',
  live: true,
  movies: true,
  series: true,
});

export const normalizedMovieDetails = Object.freeze({
  id: 'movie-42',
  name: 'فيلم تجريبي',
  categoryId: 'movie-category',
  posterUrl: null,
  year: 2026,
  rating: null,
  containerExtension: 'mp4',
  plot: null,
  durationSeconds: 5_400,
  cast: null,
  director: 'Director',
  genre: null,
  releasedAt: null,
});

export const normalizedSeriesDetails = Object.freeze({
  id: 'series-1',
  name: 'مسلسل تجريبي',
  categoryId: null,
  posterUrl: null,
  year: null,
  rating: null,
  plot: null,
  cast: null,
  director: null,
  genre: null,
  releasedAt: null,
  seasons: Object.freeze([
    Object.freeze({
      seasonKey: '2',
      seasonNumber: 2,
      name: null,
      episodes: Object.freeze([
        Object.freeze({
          id: 'episode-9',
          seriesId: 'series-1',
          seasonKey: '2',
          episodeNumber: 9,
          name: 'Episode 9',
          durationSeconds: null,
          containerExtension: 'mp4',
          imageUrl: null,
        }),
      ]),
    }),
  ]),
});
