const APP_BASE_PATH_TEMPLATE = '__HULK_APP_BASE_PATH__';
const STATIC_ASSET_REVISION_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const STATIC_ASSET_REQUEST_PATTERN = /^\/_static\/[A-Za-z0-9_-]{16}(\/.+)$/u;

export function appExternalPath(basePath: string, path: string): string {
  if (!path.startsWith('/')) throw new Error('Application path must be absolute.');
  return basePath ? `${basePath}${path}` : path;
}

export function stripAppBasePath(requestUrl: string | undefined, basePath: string): string {
  const parsed = new URL(requestUrl ?? '/', 'http://hulk.invalid');
  if (basePath) {
    if (parsed.pathname === basePath) parsed.pathname = '/';
    else if (parsed.pathname.startsWith(`${basePath}/`)) {
      parsed.pathname = parsed.pathname.slice(basePath.length);
    }
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function renderAppBasePathTemplate(source: string, basePath: string): string {
  return source.replaceAll(APP_BASE_PATH_TEMPLATE, basePath);
}

export function renderVersionedStaticAssetUrls(
  source: string,
  basePath: string,
  revision: string,
): string {
  if (!STATIC_ASSET_REVISION_PATTERN.test(revision)) {
    throw new Error('Static asset revision is invalid.');
  }
  const staticBasePath = appExternalPath(basePath, `/_static/${revision}`);
  return source
    .replaceAll(`${basePath}/styles.css`, `${staticBasePath}/styles.css`)
    .replaceAll(`${basePath}/login-polish.css`, `${staticBasePath}/login-polish.css`)
    .replaceAll(`${basePath}/catalog.css`, `${staticBasePath}/catalog.css`)
    .replaceAll(`${basePath}/catalog-polish.css`, `${staticBasePath}/catalog-polish.css`)
    .replaceAll(`${basePath}/src/main.js`, `${staticBasePath}/src/main.js`)
    .replaceAll(`${basePath}/src/catalog-app.js`, `${staticBasePath}/src/catalog-app.js`);
}

export function resolveVersionedStaticAssetPath(pathname: string): string {
  const match = STATIC_ASSET_REQUEST_PATTERN.exec(pathname);
  return match?.[1] ?? pathname;
}
