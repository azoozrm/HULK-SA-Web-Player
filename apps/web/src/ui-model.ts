export type LoginComposition = 'centered' | 'split';

export type ShellDestinationId = 'home' | 'live' | 'movies' | 'series';

export type ShellDestination = Readonly<{
  id: ShellDestinationId;
  label: string;
}>;

type ViewportMeasurements = Readonly<{
  width: number;
  height: number;
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

function isUsableViewportMeasurement(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function currentVisualViewportMeasurements(): ViewportMeasurements | null {
  if (typeof window === 'undefined' || !window.visualViewport) return null;
  return Object.freeze({
    width: window.visualViewport.width,
    height: window.visualViewport.height,
  });
}

function resolveVisibleViewportMeasurements(
  layoutWidthPx: number,
  layoutHeightPx: number,
  visualViewport: ViewportMeasurements | null,
): ViewportMeasurements {
  if (
    visualViewport &&
    isUsableViewportMeasurement(visualViewport.width) &&
    isUsableViewportMeasurement(visualViewport.height)
  ) {
    return visualViewport;
  }

  return Object.freeze({ width: layoutWidthPx, height: layoutHeightPx });
}

export function resolveLoginComposition(
  layoutWidthPx: number,
  layoutHeightPx: number,
  visualViewport: ViewportMeasurements | null = currentVisualViewportMeasurements(),
): LoginComposition {
  const { width: widthPx, height: heightPx } = resolveVisibleViewportMeasurements(
    layoutWidthPx,
    layoutHeightPx,
    visualViewport,
  );

  if (!isUsableViewportMeasurement(widthPx) || !isUsableViewportMeasurement(heightPx)) {
    return 'centered';
  }

  const aspectRatio = widthPx / heightPx;
  const expandedLandscape = widthPx >= 840 && heightPx >= 480 && widthPx > heightPx;
  const roomyMediumLandscape =
    widthPx >= 720 && widthPx < 840 && heightPx >= 480 && aspectRatio >= 1.45;

  return expandedLandscape || roomyMediumLandscape ? 'split' : 'centered';
}
