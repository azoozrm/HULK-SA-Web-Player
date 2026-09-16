import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { CatalogReader } from '../provider/xtream-catalog.js';
import { createCatalogApiHandler } from './catalog-api.js';
import {
  appExternalPath,
  renderAppBasePathTemplate,
  renderVersionedStaticAssetUrls,
  resolveVersionedStaticAssetPath,
  stripAppBasePath,
} from './app-path.js';
import {
  createMediaApiHandler,
  type MediaApiRuntimeDependencies,
} from './media-api.js';
import type { SessionApiDependencies } from './session-api.js';
import { createSessionApiHandler } from './session-api.js';

const webRoot = new URL('../../../web/', import.meta.url);
const staticAssetRevision = randomBytes(12).toString('base64url');
const staticFiles = new Map<string, Readonly<{ relativePath: string; contentType: string }>>([
  ['/', { relativePath: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/index.html', { relativePath: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/styles.css', { relativePath: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  [
    '/login-polish.css',
    { relativePath: 'login-polish.css', contentType: 'text/css; charset=utf-8' },
  ],
  ['/src/main.js', { relativePath: 'src/main.js', contentType: 'text/javascript; charset=utf-8' }],
  [
    '/src/session-client.js',
    { relativePath: 'src/session-client.js', contentType: 'text/javascript; charset=utf-8' },
  ],
  [
    '/src/ui-model.js',
    { relativePath: 'src/ui-model.js', contentType: 'text/javascript; charset=utf-8' },
  ],
  [
    '/assets/hulk-sa-badge.svg',
    { relativePath: 'assets/hulk-sa-badge.svg', contentType: 'image/svg+xml; charset=utf-8' },
  ],
  [
    '/assets/hulk-sa-lockup.svg',
    { relativePath: 'assets/hulk-sa-lockup.svg', contentType: 'image/svg+xml; charset=utf-8' },
  ],
  [
    '/assets/fonts/IBMPlexSansArabic-Regular.woff2',
    { relativePath: 'assets/fonts/IBMPlexSansArabic-Regular.woff2', contentType: 'font/woff2' },
  ],
  [
    '/assets/fonts/IBMPlexSansArabic-Bold.woff2',
    { relativePath: 'assets/fonts/IBMPlexSansArabic-Bold.woff2', contentType: 'font/woff2' },
  ],
]);

export type AppHandlerDependencies = SessionApiDependencies & Readonly<{
  catalog: CatalogReader;
  media: MediaApiRuntimeDependencies;
  config: SessionApiDependencies['config'] & Readonly<{ appBasePath: string }>;
}>;

function staticSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
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
    appBasePath: dependencies.config.appBasePath,
    transport: dependencies.media.transport,
    locator: dependencies.media.locator,
    adapter: dependencies.media.adapter,
  });
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const originalUrl = request.url;
    request.url = stripAppBasePath(originalUrl, dependencies.config.appBasePath);
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
      const staticPath = resolveVersionedStaticAssetPath(requestUrl.pathname);
      const staticFile = staticFiles.get(staticPath);
      if (!staticFile || requestUrl.search || requestUrl.hash) {
        response.statusCode = 404;
        response.end();
        return;
      }
      let body = await readFile(fileURLToPath(new URL(staticFile.relativePath, webRoot)));
      if (staticFile.relativePath === 'index.html') {
        const renderedBasePath = renderAppBasePathTemplate(
          body.toString('utf8'),
          dependencies.config.appBasePath,
        );
        body = Buffer.from(
          renderVersionedStaticAssetUrls(
            renderedBasePath,
            dependencies.config.appBasePath,
            staticAssetRevision,
          ),
          'utf8',
        );
      }
      staticSecurityHeaders(response);
      response.statusCode = 200;
      response.setHeader('Content-Type', staticFile.contentType);
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      if (!response.headersSent) {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.statusCode = 500;
      }
      response.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }));
    } finally {
      request.url = originalUrl;
    }
  };
}

export { appExternalPath };
