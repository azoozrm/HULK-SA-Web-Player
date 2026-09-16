import type {
  MovieDetails,
  ProviderCapabilities,
  SeriesDetails,
  SeriesEpisode,
  SeriesSeason,
} from '../../../packages/contracts/src/index.js';
import type { ShellDestinationId } from './ui-model.js';

export type CatalogFamilyId = Exclude<ShellDestinationId, 'home'>;

export const CATALOG_COPY = Object.freeze({
  loading: 'جاري تحميل المحتوى',
  empty: 'لا يوجد محتوى متاح',
  error: 'تعذر تحميل المحتوى',
  retry: 'اعاده المحاوله',
  allLive: 'كل القنوات',
  allMovies: 'كل الافلام',
  allSeries: 'كل المسلسلات',
  unsupported: 'هذا القسم غير مدعوم من المزود',
  details: 'التفاصيل',
  back: 'رجوع',
  homeIntro: 'اختر القسم لعرض محتوى اشتراكك',
  available: 'متاح',
  unavailable: 'غير متاح',
  categories: 'التصنيفات',
  loadMore: 'عرض المزيد',
  year: 'السنه',
  rating: 'التقييم',
  duration: 'المده',
  genre: 'النوع',
  cast: 'طاقم التمثيل',
  director: 'المخرج',
  release: 'تاريخ الاصدار',
  plot: 'الوصف',
  seasons: 'المواسم',
  episodes: 'الحلقات',
  season: 'الموسم',
  episode: 'الحلقه',
  sessionUnavailable: 'تعذر الوصول الى الجلسه حاليا',
  networkError: 'تعذر الاتصال بالخدمه',
  homeLoading: 'جاري التحقق من الاقسام المتاحه',
  imageUnavailable: 'صوره غير متاحه',
});

export const CATALOG_RENDER_BATCH_SIZE = 60;

export function initialCatalogRenderCount(total: number): number {
  if (!Number.isInteger(total) || total < 0) throw new Error('Catalog item count is invalid.');
  return Math.min(total, CATALOG_RENDER_BATCH_SIZE);
}

export function nextCatalogRenderCount(current: number, total: number): number {
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(total) || total < 0) {
    throw new Error('Catalog render window is invalid.');
  }
  return Math.min(total, Math.max(current, 0) + CATALOG_RENDER_BATCH_SIZE);
}

export function isCatalogFamilySupported(
  capabilities: ProviderCapabilities,
  family: CatalogFamilyId,
): boolean {
  return capabilities[family];
}

export function allCategoryLabel(family: CatalogFamilyId): string {
  switch (family) {
    case 'live':
      return CATALOG_COPY.allLive;
    case 'movies':
      return CATALOG_COPY.allMovies;
    case 'series':
      return CATALOG_COPY.allSeries;
  }
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}`;
  return `${minutes} د`;
}

export type DetailMetadata = Readonly<{
  label: string;
  value: string;
}>;

function pushMetadata(
  rows: DetailMetadata[],
  label: string,
  value: string | number | null,
): void {
  if (value === null || value === '') return;
  rows.push(Object.freeze({ label, value: String(value) }));
}

export function movieDetailsMetadata(details: MovieDetails): readonly DetailMetadata[] {
  const rows: DetailMetadata[] = [];
  pushMetadata(rows, CATALOG_COPY.year, details.year);
  pushMetadata(rows, CATALOG_COPY.rating, details.rating);
  pushMetadata(rows, CATALOG_COPY.duration, formatDuration(details.durationSeconds));
  pushMetadata(rows, CATALOG_COPY.genre, details.genre);
  pushMetadata(rows, CATALOG_COPY.cast, details.cast);
  pushMetadata(rows, CATALOG_COPY.director, details.director);
  pushMetadata(rows, CATALOG_COPY.release, details.releasedAt);
  return Object.freeze(rows);
}

export function seriesDetailsMetadata(details: SeriesDetails): readonly DetailMetadata[] {
  const rows: DetailMetadata[] = [];
  pushMetadata(rows, CATALOG_COPY.year, details.year);
  pushMetadata(rows, CATALOG_COPY.rating, details.rating);
  pushMetadata(rows, CATALOG_COPY.genre, details.genre);
  pushMetadata(rows, CATALOG_COPY.cast, details.cast);
  pushMetadata(rows, CATALOG_COPY.director, details.director);
  pushMetadata(rows, CATALOG_COPY.release, details.releasedAt);
  return Object.freeze(rows);
}

export function initialSeriesSeasonKey(details: SeriesDetails): string | null {
  return details.seasons[0]?.seasonKey ?? null;
}

export function resolveSeriesSeason(
  details: SeriesDetails,
  seasonKey: string | null,
): SeriesSeason | null {
  if (seasonKey === null) return null;
  return details.seasons.find((season) => season.seasonKey === seasonKey) ?? null;
}

export function seasonDisplayName(season: SeriesSeason): string {
  if (season.name) return season.name;
  if (season.seasonNumber !== null) return `${CATALOG_COPY.season} ${season.seasonNumber}`;
  return `${CATALOG_COPY.season} ${season.seasonKey}`;
}

export function episodeDisplayName(episode: SeriesEpisode): string {
  if (episode.name) return episode.name;
  if (episode.episodeNumber !== null) return `${CATALOG_COPY.episode} ${episode.episodeNumber}`;
  return CATALOG_COPY.episode;
}

export function browserSafeImageUrl(value: string | null, pageOrigin: string): string | null {
  if (!value) return null;
  let image: URL;
  let origin: URL;
  try {
    image = new URL(value);
    origin = new URL(pageOrigin);
  } catch {
    return null;
  }
  if (image.protocol !== 'https:' || image.username || image.password) return null;
  if (image.origin !== origin.origin) return null;
  return image.toString();
}

export type OwnedRequest = Readonly<{
  id: number;
  signal: AbortSignal;
}>;

export class RequestOwner {
  #sequence = 0;
  #controller: AbortController | null = null;

  begin(): OwnedRequest {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#sequence += 1;
    return Object.freeze({ id: this.#sequence, signal: this.#controller.signal });
  }

  owns(id: number): boolean {
    return this.#controller !== null && this.#sequence === id && !this.#controller.signal.aborted;
  }

  invalidate(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#sequence += 1;
  }
}
