import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { CatalogReader } from '../provider/xtream-catalog.js';
import { createCatalogApiHandler } from './catalog-api.js';
import {
  createMediaApiHandler,
  type MediaApiRuntimeDependencies,
} from './media-api.js';
import type { SessionApiDependencies } from './session-api.js';
import { createSessionApiHandler } from './session-api.js';

const webRoot = new URL('../../../web/', import.meta.url);
const staticFiles = new Map<string, Readonly<{ relativePath: string; contentType: string }>>([
  ['/', { relativePath: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/index.html', { relativePath: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/styles.css', { relativePath: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/src/main.js', { relativePath: 'src/main.js', contentType: 'text/javascript; charset=utf-8' }],
  [
    '/src/session-client.js',
    { relativePath: 'src/session-client.js', contentType: 'text/javascript; charset=utf-8' },
  ],
]);

export type AppHandlerDependencies = SessionApiDependencies & Readonly<{
  catalog: CatalogReader;
  media: MediaApiRuntimeDependencies;
}>;

function staticSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

export function createAppHandler(dependencies: AppHandlerDependencies) {
  const sessionApi = createSessionApiHandler(dependencies);
  const catalogApi = createCatalogApiHandler({
    sessions: dependencies.sessions,
    catalog: dependencies.catalog,
    cookieName: dependencies.config.cookieName,
  });
  const mediaApi = createMediaApiHandler({
    sessions: dependencies.sessions,
    catalog: dependencies.catalog,
    cookieName: dependencies.config.cookieName,
    publicOrigin: dependencies.config.publicOrigin,
    transport: dependencies.media.transport,
    locator: dependencies.media.locator,
    adapter: dependencies.media.adapter,
  });
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (await sessionApi(request, response)) return;
      if (await catalogApi(request, response)) return;
      if (await mediaApi(request, response)) return;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.statusCode = 404;
        response.end();
        return;
      }
      const requestUrl = new URL(request.url ?? '/', 'http://hulk.invalid');
      const staticFile = staticFiles.get(requestUrl.pathname);
      if (!staticFile || requestUrl.search || requestUrl.hash) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const body = await readFile(fileURLToPath(new URL(staticFile.relativePath, webRoot)));
      staticSecurityHeaders(response);
      response.statusCode = 200;
      response.setHeader('Content-Type', staticFile.contentType);
      if (staticFile.relativePath === 'index.html') response.setHeader('Cache-Control', 'no-cache');
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      if (!response.headersSent) {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.statusCode = 500;
      }
      response.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }));
    }
  };
}
