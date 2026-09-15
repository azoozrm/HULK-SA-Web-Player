import type {
  CatalogCategory,
  LiveChannel,
  MovieDetails,
  MovieSummary,
  SeriesDetails,
  SeriesEpisode,
  SeriesSeason,
  SeriesSummary,
} from '../../../../packages/contracts/src/index.js';
import type { ServerHeldProviderCredentials } from '../control-plane.js';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,16}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const SENSITIVE_QUERY_NAME = /^(?:user(?:name)?|pass(?:word)?|token|auth|authorization|key|api[_-]?key|session|sid|secret|signature|sig|access[_-]?token)$/iu;
const EMPTY_RECORD: Readonly<Record<string, unknown>> = Object.freeze({});

export class CatalogNormalizationError extends Error {
  constructor() {
    super('Provider catalog response is malformed.');
    this.name = 'CatalogNormalizationError';
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || CONTROL_CHARACTER.test(normalized)) {
    return null;
  }
  return normalized;
}

function containsProviderCredential(
  value: string,
  credentials: ServerHeldProviderCredentials,
): boolean {
  return [credentials.username, credentials.password].some(
    (credential) => credential.length > 0 && value.includes(credential),
  );
}

function providerString(
  value: unknown,
  maximumLength: number,
  _credentials: ServerHeldProviderCredentials,
): string | null {
  // Ordinary catalog scalar safety comes from explicit field selection by the caller.
  // Do not infer credential leakage from coincidental scalar value content.
  return boundedString(value, maximumLength);
}

function firstProviderString(
  maximumLength: number,
  credentials: ServerHeldProviderCredentials,
  ...values: readonly unknown[]
): string | null {
  for (const value of values) {
    const normalized = providerString(value, maximumLength, credentials);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function normalizeCatalogIdentifier(value: unknown): string | null {
  let normalized: string;
  if (typeof value === 'string') {
    normalized = value.trim();
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    normalized = String(value);
  } else {
    return null;
  }
  return SAFE_IDENTIFIER.test(normalized) ? normalized : null;
}

function normalizeProviderIdentifier(
  value: unknown,
  _credentials: ServerHeldProviderCredentials,
): string | null {
  return normalizeCatalogIdentifier(value);
}

export function parseBrowserCatalogIdentifier(value: string): string | null {
  return normalizeCatalogIdentifier(value);
}

function optionalNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizedYear(value: unknown): number | null {
  const numberValue = optionalNumber(value);
  if (numberValue === null || !Number.isInteger(numberValue)) return null;
  return numberValue >= 1800 && numberValue <= 3000 ? numberValue : null;
}

function normalizedRating(value: unknown): number | null {
  const numberValue = optionalNumber(value);
  if (numberValue === null || numberValue < 0 || numberValue > 10) return null;
  return Math.round(numberValue * 10) / 10;
}

function normalizedPositiveInteger(value: unknown, maximum: number): number | null {
  const numberValue = optionalNumber(value);
  if (
    numberValue === null ||
    !Number.isInteger(numberValue) ||
    numberValue <= 0 ||
    numberValue > maximum
  ) {
    return null;
  }
  return numberValue;
}

function normalizedDurationSeconds(record: Readonly<Record<string, unknown>>): number | null {
  const direct = normalizedPositiveInteger(record.duration_secs, 7 * 24 * 60 * 60);
  if (direct !== null) return direct;
  const duration = boundedString(record.duration, 64);
  if (!duration) return null;
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/u.exec(duration);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 && total <= 7 * 24 * 60 * 60 ? total : null;
}

function normalizedExtension(value: unknown): string | null {
  const extension = boundedString(value, 16);
  return extension && SAFE_EXTENSION.test(extension) ? extension.toLowerCase() : null;
}

function normalizedDate(value: unknown): string | null {
  const text = boundedString(value, 64);
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dateOnly) {
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
  }
  const epochMs = Date.parse(text);
  if (!Number.isFinite(epochMs)) return null;
  return new Date(epochMs).toISOString();
}

export function normalizeMetadataUrl(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): string | null {
  const text = boundedString(value, 4096);
  if (!text || containsProviderCredential(text, credentials)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  for (const [name] of url.searchParams) {
    if (SENSITIVE_QUERY_NAME.test(name)) return null;
  }
  url.hash = '';
  return url.toString();
}

function normalizedCategoryItem(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): CatalogCategory | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = normalizeProviderIdentifier(record.category_id, credentials);
  const name = providerString(record.category_name, 512, credentials);
  return id && name ? Object.freeze({ id, name }) : null;
}

function normalizeList<T>(
  value: unknown,
  normalizeItem: (item: unknown) => T | null,
): readonly T[] {
  if (!Array.isArray(value)) throw new CatalogNormalizationError();
  const items: T[] = [];
  let malformedItems = 0;
  for (const item of value) {
    const normalized = normalizeItem(item);
    if (normalized === null) malformedItems += 1;
    else items.push(normalized);
  }
  if (value.length > 0 && items.length === 0 && malformedItems > 0) {
    throw new CatalogNormalizationError();
  }
  return Object.freeze(items);
}

export function normalizeCatalogCategories(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): readonly CatalogCategory[] {
  return normalizeList(value, (item) => normalizedCategoryItem(item, credentials));
}

export function normalizeLiveChannels(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): readonly LiveChannel[] {
  return normalizeList(value, (item) => {
    const record = asRecord(item);
    if (!record) return null;
    const id = normalizeProviderIdentifier(record.stream_id, credentials);
    const name = providerString(record.name, 512, credentials);
    if (!id || !name) return null;
    return Object.freeze({
      id,
      name,
      categoryId: normalizeProviderIdentifier(record.category_id, credentials),
      imageUrl: normalizeMetadataUrl(record.stream_icon, credentials),
      epgChannelId: providerString(record.epg_channel_id, 256, credentials),
    });
  });
}

export function normalizeMovieSummaries(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): readonly MovieSummary[] {
  return normalizeList(value, (item) => {
    const record = asRecord(item);
    if (!record) return null;
    const id = normalizeProviderIdentifier(record.stream_id, credentials);
    const name = providerString(record.name, 512, credentials);
    if (!id || !name) return null;
    return Object.freeze({
      id,
      name,
      categoryId: normalizeProviderIdentifier(record.category_id, credentials),
      posterUrl: normalizeMetadataUrl(record.stream_icon, credentials),
      year: normalizedYear(record.year),
      rating: normalizedRating(record.rating),
      containerExtension: normalizedExtension(record.container_extension),
    });
  });
}

export function normalizeMovieDetails(
  value: unknown,
  requestedId: string,
  credentials: ServerHeldProviderCredentials,
): MovieDetails {
  const root = asRecord(value);
  if (!root) throw new CatalogNormalizationError();
  const infoRecord = asRecord(root.info);
  const movieRecord = asRecord(root.movie_data);
  if (!infoRecord && !movieRecord) throw new CatalogNormalizationError();
  const info: Readonly<Record<string, unknown>> = infoRecord ?? EMPTY_RECORD;
  const movie: Readonly<Record<string, unknown>> = movieRecord ?? EMPTY_RECORD;
  const releaseValue = info.releaseDate ?? info.release_date ?? info.releasedate;
  const year = normalizedYear(info.year ?? movie.year);
  const releaseYear = normalizedDate(releaseValue)?.slice(0, 4);
  return Object.freeze({
    id: requestedId,
    name: firstProviderString(512, credentials, movie.name, info.name),
    categoryId: normalizeProviderIdentifier(movie.category_id ?? info.category_id, credentials),
    posterUrl: normalizeMetadataUrl(info.movie_image ?? movie.stream_icon, credentials),
    year: year ?? (releaseYear ? normalizedYear(releaseYear) : null),
    rating: normalizedRating(info.rating ?? movie.rating),
    containerExtension: normalizedExtension(movie.container_extension),
    plot: firstProviderString(8_192, credentials, info.plot, info.description),
    durationSeconds: normalizedDurationSeconds(info),
    cast: firstProviderString(4_096, credentials, info.cast),
    director: firstProviderString(2_048, credentials, info.director),
    genre: firstProviderString(2_048, credentials, info.genre),
    releasedAt: normalizedDate(releaseValue),
  });
}

export function normalizeSeriesSummaries(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): readonly SeriesSummary[] {
  return normalizeList(value, (item) => {
    const record = asRecord(item);
    if (!record) return null;
    const id = normalizeProviderIdentifier(record.series_id, credentials);
    const name = providerString(record.name, 512, credentials);
    if (!id || !name) return null;
    return Object.freeze({
      id,
      name,
      categoryId: normalizeProviderIdentifier(record.category_id, credentials),
      posterUrl: normalizeMetadataUrl(record.cover, credentials),
      year: normalizedYear(record.year),
      rating: normalizedRating(record.rating),
      plot: firstProviderString(8_192, credentials, record.plot),
    });
  });
}

type SeasonMetadata = Readonly<{
  name: string | null;
  seasonNumber: number | null;
}>;

function seasonMetadata(
  value: unknown,
  credentials: ServerHeldProviderCredentials,
): ReadonlyMap<string, SeasonMetadata> {
  if (!Array.isArray(value)) return new Map();
  const metadata = new Map<string, SeasonMetadata>();
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const rawKey = normalizeSeasonKey(record.season_number, credentials);
    if (!rawKey) continue;
    metadata.set(
      rawKey,
      Object.freeze({
        name: providerString(record.name, 512, credentials),
        seasonNumber: normalizedPositiveInteger(record.season_number, 10_000),
      }),
    );
  }
  return metadata;
}

function normalizeSeasonKey(
  value: unknown,
  _credentials: ServerHeldProviderCredentials,
): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const key = String(value).trim();
  if (!key || key.length > 64 || CONTROL_CHARACTER.test(key)) {
    return null;
  }
  return key;
}

function numericSeasonKey(key: string): bigint | null {
  return /^\d{1,32}$/u.test(key) ? BigInt(key) : null;
}

function compareSeasonKeys(left: string, right: string): number {
  const leftNumeric = numericSeasonKey(left);
  const rightNumeric = numericSeasonKey(right);
  if (leftNumeric !== null && rightNumeric !== null) {
    if (leftNumeric < rightNumeric) return -1;
    if (leftNumeric > rightNumeric) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (leftNumeric !== null) return -1;
  if (rightNumeric !== null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeEpisode(
  value: unknown,
  seriesId: string,
  seasonKey: string,
  credentials: ServerHeldProviderCredentials,
): SeriesEpisode | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = normalizeProviderIdentifier(record.id, credentials);
  if (!id) return null;
  const infoRecord = asRecord(record.info);
  const info: Readonly<Record<string, unknown>> = infoRecord ?? EMPTY_RECORD;
  return Object.freeze({
    id,
    seriesId,
    seasonKey,
    episodeNumber: normalizedPositiveInteger(record.episode_num, 1_000_000),
    name: firstProviderString(512, credentials, record.title, record.name),
    durationSeconds: normalizedDurationSeconds(info),
    containerExtension: normalizedExtension(record.container_extension),
    imageUrl: normalizeMetadataUrl(info.movie_image ?? info.cover_big ?? info.cover, credentials),
  });
}

function normalizeSeasons(
  root: Readonly<Record<string, unknown>>,
  seriesId: string,
  credentials: ServerHeldProviderCredentials,
): readonly SeriesSeason[] {
  const rawEpisodes = root.episodes;
  if (rawEpisodes === undefined || rawEpisodes === null) return Object.freeze([]);
  const groups = asRecord(rawEpisodes);
  if (!groups) throw new CatalogNormalizationError();
  const metadata = seasonMetadata(root.seasons, credentials);
  const seasons: SeriesSeason[] = [];
  let malformedGroups = 0;

  for (const [rawKey, rawGroup] of Object.entries(groups)) {
    const seasonKey = normalizeSeasonKey(rawKey, credentials);
    if (!seasonKey || !Array.isArray(rawGroup)) {
      malformedGroups += 1;
      continue;
    }
    const episodes: SeriesEpisode[] = [];
    for (const rawEpisode of rawGroup) {
      const episode = normalizeEpisode(rawEpisode, seriesId, seasonKey, credentials);
      if (episode) episodes.push(episode);
    }
    if (rawGroup.length > 0 && episodes.length === 0) {
      malformedGroups += 1;
      continue;
    }
    const numeric = numericSeasonKey(seasonKey);
    const metadataEntry = metadata.get(seasonKey);
    const seasonNumber = metadataEntry?.seasonNumber
      ?? (numeric !== null && numeric <= BigInt(10_000) ? Number(numeric) : null);
    seasons.push(
      Object.freeze({
        seasonKey,
        seasonNumber,
        name: metadataEntry?.name ?? null,
        episodes: Object.freeze(episodes),
      }),
    );
  }

  if (Object.keys(groups).length > 0 && seasons.length === 0 && malformedGroups > 0) {
    throw new CatalogNormalizationError();
  }
  seasons.sort((left, right) => compareSeasonKeys(left.seasonKey, right.seasonKey));
  return Object.freeze(seasons);
}

export function normalizeSeriesDetails(
  value: unknown,
  requestedId: string,
  credentials: ServerHeldProviderCredentials,
): SeriesDetails {
  const root = asRecord(value);
  if (!root) throw new CatalogNormalizationError();
  const infoRecord = asRecord(root.info);
  const episodeRecord = asRecord(root.episodes);
  if (!infoRecord && !episodeRecord) throw new CatalogNormalizationError();
  const info: Readonly<Record<string, unknown>> = infoRecord ?? EMPTY_RECORD;
  const releaseValue = info.releaseDate ?? info.release_date ?? info.releasedate;
  const year = normalizedYear(info.year);
  const releaseYear = normalizedDate(releaseValue)?.slice(0, 4);
  return Object.freeze({
    id: requestedId,
    name: firstProviderString(512, credentials, info.name),
    categoryId: normalizeProviderIdentifier(info.category_id, credentials),
    posterUrl: normalizeMetadataUrl(info.cover, credentials),
    year: year ?? (releaseYear ? normalizedYear(releaseYear) : null),
    rating: normalizedRating(info.rating),
    plot: firstProviderString(8_192, credentials, info.plot, info.description),
    cast: firstProviderString(4_096, credentials, info.cast),
    director: firstProviderString(2_048, credentials, info.director),
    genre: firstProviderString(2_048, credentials, info.genre),
    releasedAt: normalizedDate(releaseValue),
    seasons: normalizeSeasons(root, requestedId, credentials),
  });
}
