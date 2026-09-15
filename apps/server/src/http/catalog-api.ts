import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderCredentialLease, ProviderSessionBoundary } from '../control-plane.js';
import { parseBrowserCatalogIdentifier } from '../catalog/catalog-normalizer.js';
import { CatalogProviderError, type CatalogReader } from '../provider/xtream-catalog.js';

export type CatalogApiDependencies = Readonly<{
  sessions: ProviderSessionBoundary;
  catalog: CatalogReader;
  cookieName: string;
}>;

type CatalogRoute =
  | Readonly<{ kind: 'capabilities' }>
  | Readonly<{ kind: 'live-categories' }>
  | Readonly<{ kind: 'live'; categoryId: string | null }>
  | Readonly<{ kind: 'movie-categories' }>
  | Readonly<{ kind: 'movies'; categoryId: string | null }>
  | Readonly<{ kind: 'movie-details'; id: string }>
  | Readonly<{ kind: 'series-categories' }>
  | Readonly<{ kind: 'series'; categoryId: string | null }>
  | Readonly<{ kind: 'series-details'; id: string }>;

class CatalogRequestValidationError extends Error {}

function setCatalogHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  setCatalogHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function errorBody(code: string): Readonly<{ error: Readonly<{ code: string }> }> {
  return Object.freeze({ error: Object.freeze({ code }) });
}

function parseSessionCookie(header: string | undefined, cookieName: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== cookieName) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{20,256}$/u.test(value) ? value : null;
  }
  return null;
}

function noQuery(requestUrl: URL): void {
  if (requestUrl.search || requestUrl.hash) throw new CatalogRequestValidationError();
}

function optionalCategoryId(requestUrl: URL): string | null {
  if (requestUrl.hash) throw new CatalogRequestValidationError();
  const keys = [...requestUrl.searchParams.keys()];
  if (keys.some((key) => key !== 'categoryId')) throw new CatalogRequestValidationError();
  const values = requestUrl.searchParams.getAll('categoryId');
  if (values.length === 0) return null;
  if (values.length !== 1) throw new CatalogRequestValidationError();
  const categoryId = parseBrowserCatalogIdentifier(values[0] ?? '');
  if (!categoryId) throw new CatalogRequestValidationError();
  return categoryId;
}

function detailId(requestUrl: URL, prefix: string): string | null {
  if (!requestUrl.pathname.startsWith(prefix)) return null;
  noQuery(requestUrl);
  const encoded = requestUrl.pathname.slice(prefix.length);
  if (!encoded || encoded.includes('/')) throw new CatalogRequestValidationError();
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new CatalogRequestValidationError();
  }
  const id = parseBrowserCatalogIdentifier(decoded);
  if (!id) throw new CatalogRequestValidationError();
  return id;
}

function parseRoute(requestUrl: URL): CatalogRoute | null {
  if (!requestUrl.pathname.startsWith('/api/catalog')) return null;
  if (requestUrl.pathname === '/api/catalog/capabilities') {
    noQuery(requestUrl);
    return Object.freeze({ kind: 'capabilities' });
  }
  if (requestUrl.pathname === '/api/catalog/live/categories') {
    noQuery(requestUrl);
    return Object.freeze({ kind: 'live-categories' });
  }
  if (requestUrl.pathname === '/api/catalog/live') {
    return Object.freeze({ kind: 'live', categoryId: optionalCategoryId(requestUrl) });
  }
  if (requestUrl.pathname === '/api/catalog/movies/categories') {
    noQuery(requestUrl);
    return Object.freeze({ kind: 'movie-categories' });
  }
  if (requestUrl.pathname === '/api/catalog/movies') {
    return Object.freeze({ kind: 'movies', categoryId: optionalCategoryId(requestUrl) });
  }
  const movieId = detailId(requestUrl, '/api/catalog/movies/');
  if (movieId !== null) return Object.freeze({ kind: 'movie-details', id: movieId });
  if (requestUrl.pathname === '/api/catalog/series/categories') {
    noQuery(requestUrl);
    return Object.freeze({ kind: 'series-categories' });
  }
  if (requestUrl.pathname === '/api/catalog/series') {
    return Object.freeze({ kind: 'series', categoryId: optionalCategoryId(requestUrl) });
  }
  const seriesId = detailId(requestUrl, '/api/catalog/series/');
  if (seriesId !== null) return Object.freeze({ kind: 'series-details', id: seriesId });
  return null;
}

function writeCatalogError(response: ServerResponse, error: CatalogProviderError): void {
  switch (error.code) {
    case 'not_found':
      writeJson(response, 404, errorBody('CATALOG_ITEM_NOT_FOUND'));
      return;
    case 'provider_timeout':
      writeJson(response, 504, errorBody('PROVIDER_TIMEOUT'));
      return;
    case 'provider_unavailable':
      writeJson(response, 502, errorBody('PROVIDER_UNAVAILABLE'));
      return;
    case 'provider_rejected':
      writeJson(response, 502, errorBody('PROVIDER_REJECTED'));
      return;
    case 'malformed_response':
      writeJson(response, 502, errorBody('MALFORMED_PROVIDER_RESPONSE'));
      return;
    case 'response_too_large':
      writeJson(response, 502, errorBody('PROVIDER_RESPONSE_TOO_LARGE'));
      return;
  }
}

export function createCatalogApiHandler(dependencies: CatalogApiDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const requestUrl = new URL(request.url ?? '/', 'http://hulk.invalid');
    let route: CatalogRoute | null;
    try {
      route = parseRoute(requestUrl);
    } catch (error) {
      if (error instanceof CatalogRequestValidationError) {
        writeJson(response, 400, errorBody('INVALID_REQUEST'));
        return true;
      }
      throw error;
    }
    if (route === null) return false;

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED'));
      return true;
    }

    const token = parseSessionCookie(request.headers.cookie, dependencies.cookieName);
    if (!token) {
      writeJson(response, 401, errorBody('UNAUTHENTICATED'));
      return true;
    }

    let lease: ProviderCredentialLease | null;
    try {
      lease = await dependencies.sessions.acquireProviderCredentials(token);
    } catch {
      writeJson(response, 503, errorBody('SESSION_UNAVAILABLE'));
      return true;
    }
    if (!lease || lease.expiresAtEpochMs <= Date.now()) {
      writeJson(response, 401, errorBody('SESSION_EXPIRED'));
      return true;
    }

    try {
      switch (route.kind) {
        case 'capabilities':
          writeJson(response, 200, await dependencies.catalog.capabilities(lease.credentials));
          break;
        case 'live-categories':
          writeJson(response, 200, { items: await dependencies.catalog.liveCategories(lease.credentials) });
          break;
        case 'live':
          writeJson(
            response,
            200,
            { items: await dependencies.catalog.liveChannels(lease.credentials, route.categoryId) },
          );
          break;
        case 'movie-categories':
          writeJson(response, 200, { items: await dependencies.catalog.movieCategories(lease.credentials) });
          break;
        case 'movies':
          writeJson(
            response,
            200,
            { items: await dependencies.catalog.movies(lease.credentials, route.categoryId) },
          );
          break;
        case 'movie-details':
          writeJson(response, 200, await dependencies.catalog.movieDetails(lease.credentials, route.id));
          break;
        case 'series-categories':
          writeJson(response, 200, { items: await dependencies.catalog.seriesCategories(lease.credentials) });
          break;
        case 'series':
          writeJson(
            response,
            200,
            { items: await dependencies.catalog.series(lease.credentials, route.categoryId) },
          );
          break;
        case 'series-details':
          writeJson(response, 200, await dependencies.catalog.seriesDetails(lease.credentials, route.id));
          break;
      }
    } catch (error) {
      if (error instanceof CatalogProviderError) {
        writeCatalogError(response, error);
      } else {
        writeJson(response, 500, errorBody('INTERNAL_ERROR'));
      }
    }
    return true;
  };
}
