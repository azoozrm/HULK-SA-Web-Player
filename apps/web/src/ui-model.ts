export type LoginComposition = 'centered' | 'split';

export type ShellDestinationId = 'home' | 'live' | 'movies' | 'series';

export type ShellDestination = Readonly<{
  id: ShellDestinationId;
  label: string;
}>;

export const SHELL_DESTINATIONS: readonly ShellDestination[] = Object.freeze([
  Object.freeze({ id: 'home', label: 'الرئيسية' }),
  Object.freeze({ id: 'live', label: 'البث المباشر' }),
  Object.freeze({ id: 'movies', label: 'الأفلام' }),
  Object.freeze({ id: 'series', label: 'المسلسلات' }),
]);

export function resolveAppPath(basePath: string, path: string): string {
  if (!path.startsWith('/')) throw new Error('HULK application path must be absolute.');
  if (basePath === '') return path;
  if (!basePath.startsWith('/') || basePath.endsWith('/')) {
    throw new Error('HULK application base path is invalid.');
  }
  return `${basePath}${path}`;
}

export function resolveLoginComposition(widthPx: number, heightPx: number): LoginComposition {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return 'centered';
  }

  const aspectRatio = widthPx / heightPx;
  const expandedLandscape = widthPx >= 840 && heightPx >= 480 && widthPx > heightPx;
  const roomyMediumLandscape =
    widthPx >= 720 && widthPx < 840 && heightPx >= 480 && aspectRatio >= 1.45;

  return expandedLandscape || roomyMediumLandscape ? 'split' : 'centered';
}
