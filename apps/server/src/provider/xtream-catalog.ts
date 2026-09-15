import type {
  CatalogCategory,
  LiveChannel,
  MovieDetails,
  MovieSummary,
  ProviderCapabilities,
  SeriesDetails,
  SeriesSummary,
} from '../../../../packages/contracts/src/index.js';
import type {
  ProviderCatalogOperation,
  ProviderCatalogTransport,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import { ProviderTransportError } from '../network/provider-authentication-transport.js';
import { ProviderCatalogOperationError } from '../network/provider-catalog-transport.js';
import { ProviderNetworkPolicyError } from '../security/provider-url.js';
import {
  CatalogNormalizationError,
  normalizeCatalogCategories,
  normalizeLiveChannels,
  normalizeMovieDetails,
  normalizeMovieSummaries,
  normalizeSeriesDetails,
  normalizeSeriesSummaries,
} from '../catalog/catalog-normalizer.js';

export type CatalogProviderErrorCode =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'malformed_response'
  | 'response_too_large'
  | 'not_found';

export class CatalogProviderError extends Error {
  readonly code: CatalogProviderErrorCode;

  constructor(code: CatalogProviderErrorCode) {
    super('Provider catalog request failed.');
    this.name = 'CatalogProviderError';
    this.code = code;
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function parseProviderJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
  } catch {
    throw new CatalogProviderError('malformed_response');
  }
}

function providerRejectedAuthentication(value: unknown): boolean {
  const root = asRecord(value);
  const userInfo = root ? asRecord(root.user_info) : null;
  if (!userInfo || !Object.hasOwn(userInfo, 'auth')) return false;
  return userInfo.auth === 0 || userInfo.auth === '0' || userInfo.auth === false;
}

function mapTransportFailure(error: unknown): CatalogProviderError {
  if (error instanceof ProviderTransportError) {
    if (error.code === 'timeout') return new CatalogProviderError('provider_timeout');
    if (error.code === 'response_too_large') return new CatalogProviderError('response_too_large');
    return new CatalogProviderError('provider_unavailable');
  }
  if (error instanceof ProviderNetworkPolicyError) {
    return new CatalogProviderError('provider_unavailable');
  }
  if (error instanceof ProviderCatalogOperationError) {
    return new CatalogProviderError('provider_rejected');
  }
  return new CatalogProviderError('provider_unavailable');
}

function ensureSuccessfulStatus(status: number, detailRequest: boolean): void {
  if (status >= 200 && status < 300) return;
  if (detailRequest && status === 404) throw new CatalogProviderError('not_found');
  if (status >= 500 || status === 0) throw new CatalogProviderError('provider_unavailable');
  throw new CatalogProviderError('provider_rejected');
}

function detailPayloadMissing(value: unknown): boolean {
  return value === null || value === false || (Array.isArray(value) && value.length === 0);
}

export interface CatalogReader {
  capabilities(credentials: ServerHeldProviderCredentials): Promise<ProviderCapabilities>;
  liveCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]>;
  liveChannels(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly LiveChannel[]>;
  movieCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]>;
  movies(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly MovieSummary[]>;
  movieDetails(credentials: ServerHeldProviderCredentials, id: string): Promise<MovieDetails>;
  seriesCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]>;
  series(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly SeriesSummary[]>;
  seriesDetails(credentials: ServerHeldProviderCredentials, id: string): Promise<SeriesDetails>;
}

export class XtreamCatalogService implements CatalogReader {
  constructor(private readonly transport: ProviderCatalogTransport) {}

  async capabilities(credentials: ServerHeldProviderCredentials): Promise<ProviderCapabilities> {
    const [live, movies, series] = await Promise.all([
      this.probeCategoryOperation(credentials, Object.freeze({ kind: 'live-categories' })),
      this.probeCategoryOperation(credentials, Object.freeze({ kind: 'movie-categories' })),
      this.probeCategoryOperation(credentials, Object.freeze({ kind: 'series-categories' })),
    ]);
    return Object.freeze({ epg: 'unknown', live, movies, series });
  }

  async liveCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]> {
    const payload = await this.requestJson(credentials, Object.freeze({ kind: 'live-categories' }), false);
    return this.normalize(() => normalizeCatalogCategories(payload, credentials));
  }

  async liveChannels(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly LiveChannel[]> {
    const payload = await this.requestJson(
      credentials,
      Object.freeze({ kind: 'live-streams', categoryId }),
      false,
    );
    return this.normalize(() => normalizeLiveChannels(payload, credentials));
  }

  async movieCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]> {
    const payload = await this.requestJson(credentials, Object.freeze({ kind: 'movie-categories' }), false);
    return this.normalize(() => normalizeCatalogCategories(payload, credentials));
  }

  async movies(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly MovieSummary[]> {
    const payload = await this.requestJson(
      credentials,
      Object.freeze({ kind: 'movie-streams', categoryId }),
      false,
    );
    return this.normalize(() => normalizeMovieSummaries(payload, credentials));
  }

  async movieDetails(
    credentials: ServerHeldProviderCredentials,
    id: string,
  ): Promise<MovieDetails> {
    const payload = await this.requestJson(
      credentials,
      Object.freeze({ kind: 'movie-info', id }),
      true,
    );
    return this.normalize(() => normalizeMovieDetails(payload, id, credentials));
  }

  async seriesCategories(credentials: ServerHeldProviderCredentials): Promise<readonly CatalogCategory[]> {
    const payload = await this.requestJson(credentials, Object.freeze({ kind: 'series-categories' }), false);
    return this.normalize(() => normalizeCatalogCategories(payload, credentials));
  }

  async series(
    credentials: ServerHeldProviderCredentials,
    categoryId: string | null,
  ): Promise<readonly SeriesSummary[]> {
    const payload = await this.requestJson(
      credentials,
      Object.freeze({ kind: 'series', categoryId }),
      false,
    );
    return this.normalize(() => normalizeSeriesSummaries(payload, credentials));
  }

  async seriesDetails(
    credentials: ServerHeldProviderCredentials,
    id: string,
  ): Promise<SeriesDetails> {
    const payload = await this.requestJson(
      credentials,
      Object.freeze({ kind: 'series-info', id }),
      true,
    );
    return this.normalize(() => normalizeSeriesDetails(payload, id, credentials));
  }

  private async requestJson(
    credentials: ServerHeldProviderCredentials,
    operation: ProviderCatalogOperation,
    detailRequest: boolean,
  ): Promise<unknown> {
    try {
      const response = await this.transport.request(credentials, operation);
      ensureSuccessfulStatus(response.status, detailRequest);
      const payload = parseProviderJson(response.body);
      if (providerRejectedAuthentication(payload)) {
        throw new CatalogProviderError('provider_rejected');
      }
      if (detailRequest && detailPayloadMissing(payload)) {
        throw new CatalogProviderError('not_found');
      }
      return payload;
    } catch (error) {
      if (error instanceof CatalogProviderError) throw error;
      throw mapTransportFailure(error);
    }
  }

  private normalize<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CatalogNormalizationError) {
        throw new CatalogProviderError('malformed_response');
      }
      throw error;
    }
  }

  private async probeCategoryOperation(
    credentials: ServerHeldProviderCredentials,
    operation: ProviderCatalogOperation,
  ): Promise<boolean> {
    try {
      const response = await this.transport.request(credentials, operation);
      if (response.status >= 200 && response.status < 300) {
        const payload = parseProviderJson(response.body);
        if (providerRejectedAuthentication(payload)) {
          throw new CatalogProviderError('provider_rejected');
        }
        this.normalize(() => normalizeCatalogCategories(payload, credentials));
        return true;
      }
      if (response.status === 400 || response.status === 404 || response.status === 405) return false;
      ensureSuccessfulStatus(response.status, false);
      return true;
    } catch (error) {
      if (error instanceof CatalogProviderError) throw error;
      throw mapTransportFailure(error);
    }
  }
}
