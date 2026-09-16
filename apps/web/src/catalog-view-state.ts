import type {
  CatalogCategory,
  LiveChannel,
  MovieDetails,
  MovieSummary,
  ProviderCapabilities,
  SeriesDetails,
  SeriesSummary,
} from '../../../packages/contracts/src/index.js';
import type { CatalogFamilyId } from './catalog-model.js';
import type { ShellDestinationId } from './ui-model.js';

export type FamilyViewState<T> = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  categoriesLoaded: boolean;
  categories: readonly CatalogCategory[];
  selectedCategoryId: string | null;
  items: readonly T[];
  visibleCount: number;
  error: string | null;
}>;

export type MovieDetailViewState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  item: MovieSummary | null;
  details: MovieDetails | null;
  error: string | null;
}>;

export type SeriesDetailViewState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  item: SeriesSummary | null;
  details: SeriesDetails | null;
  selectedSeasonKey: string | null;
  error: string | null;
}>;

export type CatalogRenderState = Readonly<{
  destination: ShellDestinationId;
  capabilities:
    | Readonly<{ status: 'idle' }>
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; value: ProviderCapabilities }>
    | Readonly<{ status: 'error'; message: string }>;
  live: FamilyViewState<LiveChannel>;
  movies: FamilyViewState<MovieSummary>;
  series: FamilyViewState<SeriesSummary>;
  movieDetail: MovieDetailViewState;
  seriesDetail: SeriesDetailViewState;
}>;

export type CatalogActions = Readonly<{
  navigate(destination: ShellDestinationId): void;
  retryCapabilities(): void;
  selectCategory(family: CatalogFamilyId, categoryId: string | null): void;
  loadMore(family: CatalogFamilyId): void;
  openMovie(item: MovieSummary): void;
  closeMovie(): void;
  retryMovie(item: MovieSummary): void;
  openSeries(item: SeriesSummary): void;
  closeSeries(): void;
  retrySeries(item: SeriesSummary): void;
  selectSeason(seasonKey: string): void;
}>;
