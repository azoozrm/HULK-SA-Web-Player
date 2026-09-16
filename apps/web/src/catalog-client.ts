import type {
  CatalogCategory,
  CatalogCollection,
  LiveChannel,
  MovieDetails,
  MovieSummary,
  ProviderCapabilities,
  SeriesDetails,
  SeriesSummary,
} from '../../../packages/contracts/src/index.js';
import { resolveAppPath } from './ui-model.js';

export type CatalogFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type CatalogErrorKind =
  | 'session-expired'
  | 'session-unavailable'
  | 'request-failed'
  | 'network'
  | 'aborted';

export class CatalogClientError extends Error {
  readonly kind: CatalogErrorKind;
  readonly status: number | null;

  constructor(kind: CatalogErrorKind, status: number | null = null) {
    super(`Catalog request failed: ${kind}`);
    this.name = 'CatalogClientError';
    this.kind = kind;
    this.status = status;
  }
}

function categoryQuery(categoryId: string | null): string {
  return categoryId === null ? '' : `?categoryId=${encodeURIComponent(categoryId)}`;
}

export function catalogEndpoint(
  basePath: string,
  route:
    | 'capabilities'
    | 'live-categories'
    | 'live'
    | 'movie-categories'
    | 'movies'
    | 'series-categories'
    | 'series',
  categoryId: string | null = null,
): string {
  switch (route) {
    case 'capabilities':
      return resolveAppPath(basePath, '/api/catalog/capabilities');
    case 'live-categories':
      return resolveAppPath(basePath, '/api/catalog/live/categories');
    case 'live':
      return `${resolveAppPath(basePath, '/api/catalog/live')}${categoryQuery(categoryId)}`;
    case 'movie-categories':
      return resolveAppPath(basePath, '/api/catalog/movies/categories');
    case 'movies':
      return `${resolveAppPath(basePath, '/api/catalog/movies')}${categoryQuery(categoryId)}`;
    case 'series-categories':
      return resolveAppPath(basePath, '/api/catalog/series/categories');
    case 'series':
      return `${resolveAppPath(basePath, '/api/catalog/series')}${categoryQuery(categoryId)}`;
  }
}

function detailEndpoint(basePath: string, family: 'movies' | 'series', id: string): string {
  return resolveAppPath(basePath, `/api/catalog/${family}/${encodeURIComponent(id)}`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class CatalogClient {
  readonly #fetcher: CatalogFetch;
  readonly #basePath: string;

  constructor(fetcher: CatalogFetch, basePath: string) {
    this.#fetcher = fetcher;
    this.#basePath = basePath;
  }

  async #request<T>(url: string, signal: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetcher(url, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw new CatalogClientError('aborted');
      throw new CatalogClientError('network');
    }

    if (response.status === 401) throw new CatalogClientError('session-expired', 401);
    if (response.status === 503) throw new CatalogClientError('session-unavailable', 503);
    if (!response.ok) throw new CatalogClientError('request-failed', response.status);

    try {
      return await response.json() as T;
    } catch {
      throw new CatalogClientError('request-failed', response.status);
    }
  }

  capabilities(signal: AbortSignal): Promise<ProviderCapabilities> {
    return this.#request(catalogEndpoint(this.#basePath, 'capabilities'), signal);
  }

  liveCategories(signal: AbortSignal): Promise<CatalogCollection<CatalogCategory>> {
    return this.#request(catalogEndpoint(this.#basePath, 'live-categories'), signal);
  }

  liveChannels(categoryId: string | null, signal: AbortSignal): Promise<CatalogCollection<LiveChannel>> {
    return this.#request(catalogEndpoint(this.#basePath, 'live', categoryId), signal);
  }

  movieCategories(signal: AbortSignal): Promise<CatalogCollection<CatalogCategory>> {
    return this.#request(catalogEndpoint(this.#basePath, 'movie-categories'), signal);
  }

  movies(categoryId: string | null, signal: AbortSignal): Promise<CatalogCollection<MovieSummary>> {
    return this.#request(catalogEndpoint(this.#basePath, 'movies', categoryId), signal);
  }

  movieDetails(id: string, signal: AbortSignal): Promise<MovieDetails> {
    return this.#request(detailEndpoint(this.#basePath, 'movies', id), signal);
  }

  seriesCategories(signal: AbortSignal): Promise<CatalogCollection<CatalogCategory>> {
    return this.#request(catalogEndpoint(this.#basePath, 'series-categories'), signal);
  }

  series(categoryId: string | null, signal: AbortSignal): Promise<CatalogCollection<SeriesSummary>> {
    return this.#request(catalogEndpoint(this.#basePath, 'series', categoryId), signal);
  }

  seriesDetails(id: string, signal: AbortSignal): Promise<SeriesDetails> {
    return this.#request(detailEndpoint(this.#basePath, 'series', id), signal);
  }
}
