const APP_BASE_PATH_TEMPLATE = '__HULK_APP_BASE_PATH__';

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
