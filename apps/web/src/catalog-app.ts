import type {
  LiveChannel,
  MovieSummary,
  ProviderCapabilities,
  SeriesSummary,
} from '../../../packages/contracts/src/index.js';
import { CatalogClient, CatalogClientError } from './catalog-client.js';
import {
  CATALOG_COPY,
  initialCatalogRenderCount,
  initialSeriesSeasonKey,
  isCatalogFamilySupported,
  nextCatalogRenderCount,
  RequestOwner,
} from './catalog-model.js';
import { renderCatalog } from './catalog-view.js';
import type {
  CatalogActions,
  CatalogRenderState,
  FamilyViewState,
  MovieDetailViewState,
  SeriesDetailViewState,
} from './catalog-view.js';
import type { ShellDestinationId } from './ui-model.js';

const queriedRoot = document.querySelector<HTMLElement>('#app');
if (!queriedRoot) throw new Error('HULK catalog root is missing.');
const root: HTMLElement = queriedRoot;
const basePath = document.querySelector<HTMLMetaElement>('meta[name="hulk-app-base-path"]')?.content ?? '';
const client = new CatalogClient(fetch, basePath);
const capabilitiesOwner = new RequestOwner();
const listingOwner = new RequestOwner();
const detailsOwner = new RequestOwner();

const emptyFamily = <T>(): FamilyViewState<T> => Object.freeze({
  status: 'idle',
  categoriesLoaded: false,
  categories: Object.freeze([]),
  selectedCategoryId: null,
  items: Object.freeze([]),
  visibleCount: 0,
  error: null,
});

let capabilities: CatalogRenderState['capabilities'] = Object.freeze({ status: 'idle' });
let capabilitiesPromise: Promise<ProviderCapabilities | null> | null = null;
let live = emptyFamily<LiveChannel>();
let movies = emptyFamily<MovieSummary>();
let series = emptyFamily<SeriesSummary>();
let movieDetail: MovieDetailViewState = Object.freeze({ status: 'idle', item: null, details: null, error: null });
let seriesDetail: SeriesDetailViewState = Object.freeze({ status: 'idle', item: null, details: null, selectedSeasonKey: null, error: null });
let destination: ShellDestinationId = 'home';
let shellPresent = false;
let syncing = false;

function errorCopy(error: CatalogClientError): string {
  if (error.kind === 'session-unavailable') return CATALOG_COPY.sessionUnavailable;
  if (error.kind === 'network') return CATALOG_COPY.networkError;
  return CATALOG_COPY.error;
}

function resetData(): void {
  capabilitiesOwner.invalidate();
  listingOwner.invalidate();
  detailsOwner.invalidate();
  capabilitiesPromise = null;
  capabilities = Object.freeze({ status: 'idle' });
  live = emptyFamily<LiveChannel>();
  movies = emptyFamily<MovieSummary>();
  series = emptyFamily<SeriesSummary>();
  movieDetail = Object.freeze({ status: 'idle', item: null, details: null, error: null });
  seriesDetail = Object.freeze({ status: 'idle', item: null, details: null, selectedSeasonKey: null, error: null });
}

function leaveExpiredSession(): void {
  resetData();
  root.replaceChildren();
  window.location.reload();
}

function activeDestination(): ShellDestinationId | null {
  const current = root.querySelector<HTMLElement>('[data-nav-destination][aria-current="page"]');
  const value = current?.dataset.navDestination;
  return value === 'home' || value === 'live' || value === 'movies' || value === 'series' ? value : null;
}

function shellBusy(): boolean {
  return root.querySelector<HTMLButtonElement>('.shell-logout:disabled') !== null;
}

function targetStage(): HTMLElement | null {
  const content = root.querySelector<HTMLElement>('#shell-content');
  if (!content) return null;
  const previous = content.querySelector<HTMLElement>('.shell-stage-card, .catalog-stage');
  if (previous?.classList.contains('catalog-stage')) return previous;
  const stage = document.createElement('section');
  stage.className = 'catalog-stage';
  if (previous) previous.replaceWith(stage);
  else content.append(stage);
  return stage;
}

function state(): CatalogRenderState {
  return Object.freeze({ destination, capabilities, live, movies, series, movieDetail, seriesDetail });
}

function render(): void {
  const stage = targetStage();
  if (!stage || shellBusy()) return;
  renderCatalog(stage, state(), actions);
}

async function ensureCapabilities(force = false): Promise<ProviderCapabilities | null> {
  if (!shellPresent || shellBusy()) return null;
  if (!force && capabilities.status === 'ready') return capabilities.value;
  if (!force && capabilities.status === 'loading' && capabilitiesPromise) return capabilitiesPromise;
  const owned = capabilitiesOwner.begin();
  capabilities = Object.freeze({ status: 'loading' });
  render();
  const promise = client.capabilities(owned.signal).then((value) => {
    if (!capabilitiesOwner.owns(owned.id) || !shellPresent) return null;
    capabilities = Object.freeze({ status: 'ready', value });
    render();
    return value;
  }).catch((error: unknown) => {
    if (!capabilitiesOwner.owns(owned.id)) return null;
    if (error instanceof CatalogClientError) {
      if (error.kind === 'aborted') return null;
      if (error.kind === 'session-expired') {
        leaveExpiredSession();
        return null;
      }
      capabilities = Object.freeze({ status: 'error', message: errorCopy(error) });
    } else capabilities = Object.freeze({ status: 'error', message: CATALOG_COPY.error });
    render();
    return null;
  }).finally(() => {
    if (capabilitiesPromise === promise) capabilitiesPromise = null;
  });
  capabilitiesPromise = promise;
  return promise;
}

function familyError<T>(current: FamilyViewState<T>, message: string): FamilyViewState<T> {
  return Object.freeze({ ...current, status: 'error', items: Object.freeze([]), visibleCount: 0, error: message });
}

async function loadLive(categoryId: string | null): Promise<void> {
  const owned = listingOwner.begin();
  const previous = live;
  live = Object.freeze({ ...previous, status: 'loading', selectedCategoryId: categoryId, items: Object.freeze([]), visibleCount: 0, error: null });
  render();
  try {
    const [categoryResult, itemResult] = await Promise.all([
      previous.categoriesLoaded ? Promise.resolve({ items: previous.categories }) : client.liveCategories(owned.signal),
      client.liveChannels(categoryId, owned.signal),
    ]);
    if (!listingOwner.owns(owned.id) || destination !== 'live') return;
    live = Object.freeze({ status: 'ready', categoriesLoaded: true, categories: categoryResult.items, selectedCategoryId: categoryId, items: itemResult.items, visibleCount: initialCatalogRenderCount(itemResult.items.length), error: null });
    render();
  } catch (error) {
    if (!listingOwner.owns(owned.id)) return;
    if (error instanceof CatalogClientError && error.kind === 'session-expired') return leaveExpiredSession();
    if (error instanceof CatalogClientError && error.kind === 'aborted') return;
    live = familyError(live, error instanceof CatalogClientError ? errorCopy(error) : CATALOG_COPY.error);
    render();
  }
}

async function loadMovies(categoryId: string | null): Promise<void> {
  const owned = listingOwner.begin();
  detailsOwner.invalidate();
  movieDetail = Object.freeze({ status: 'idle', item: null, details: null, error: null });
  const previous = movies;
  movies = Object.freeze({ ...previous, status: 'loading', selectedCategoryId: categoryId, items: Object.freeze([]), visibleCount: 0, error: null });
  render();
  try {
    const [categoryResult, itemResult] = await Promise.all([
      previous.categoriesLoaded ? Promise.resolve({ items: previous.categories }) : client.movieCategories(owned.signal),
      client.movies(categoryId, owned.signal),
    ]);
    if (!listingOwner.owns(owned.id) || destination !== 'movies') return;
    movies = Object.freeze({ status: 'ready', categoriesLoaded: true, categories: categoryResult.items, selectedCategoryId: categoryId, items: itemResult.items, visibleCount: initialCatalogRenderCount(itemResult.items.length), error: null });
    render();
  } catch (error) {
    if (!listingOwner.owns(owned.id)) return;
    if (error instanceof CatalogClientError && error.kind === 'session-expired') return leaveExpiredSession();
    if (error instanceof CatalogClientError && error.kind === 'aborted') return;
    movies = familyError(movies, error instanceof CatalogClientError ? errorCopy(error) : CATALOG_COPY.error);
    render();
  }
}

async function loadSeries(categoryId: string | null): Promise<void> {
  const owned = listingOwner.begin();
  detailsOwner.invalidate();
  seriesDetail = Object.freeze({ status: 'idle', item: null, details: null, selectedSeasonKey: null, error: null });
  const previous = series;
  series = Object.freeze({ ...previous, status: 'loading', selectedCategoryId: categoryId, items: Object.freeze([]), visibleCount: 0, error: null });
  render();
  try {
    const [categoryResult, itemResult] = await Promise.all([
      previous.categoriesLoaded ? Promise.resolve({ items: previous.categories }) : client.seriesCategories(owned.signal),
      client.series(categoryId, owned.signal),
    ]);
    if (!listingOwner.owns(owned.id) || destination !== 'series') return;
    series = Object.freeze({ status: 'ready', categoriesLoaded: true, categories: categoryResult.items, selectedCategoryId: categoryId, items: itemResult.items, visibleCount: initialCatalogRenderCount(itemResult.items.length), error: null });
    render();
  } catch (error) {
    if (!listingOwner.owns(owned.id)) return;
    if (error instanceof CatalogClientError && error.kind === 'session-expired') return leaveExpiredSession();
    if (error instanceof CatalogClientError && error.kind === 'aborted') return;
    series = familyError(series, error instanceof CatalogClientError ? errorCopy(error) : CATALOG_COPY.error);
    render();
  }
}

async function openMovie(item: MovieSummary): Promise<void> {
  const owned = detailsOwner.begin();
  movieDetail = Object.freeze({ status: 'loading', item, details: null, error: null });
  render();
  try {
    const details = await client.movieDetails(item.id, owned.signal);
    if (!detailsOwner.owns(owned.id) || destination !== 'movies') return;
    movieDetail = Object.freeze({ status: 'ready', item, details, error: null });
    render();
  } catch (error) {
    if (!detailsOwner.owns(owned.id)) return;
    if (error instanceof CatalogClientError && error.kind === 'session-expired') return leaveExpiredSession();
    if (error instanceof CatalogClientError && error.kind === 'aborted') return;
    movieDetail = Object.freeze({ status: 'error', item, details: null, error: error instanceof CatalogClientError ? errorCopy(error) : CATALOG_COPY.error });
    render();
  }
}

async function openSeries(item: SeriesSummary): Promise<void> {
  const owned = detailsOwner.begin();
  seriesDetail = Object.freeze({ status: 'loading', item, details: null, selectedSeasonKey: null, error: null });
  render();
  try {
    const details = await client.seriesDetails(item.id, owned.signal);
    if (!detailsOwner.owns(owned.id) || destination !== 'series') return;
    seriesDetail = Object.freeze({ status: 'ready', item, details, selectedSeasonKey: initialSeriesSeasonKey(details), error: null });
    render();
  } catch (error) {
    if (!detailsOwner.owns(owned.id)) return;
    if (error instanceof CatalogClientError && error.kind === 'session-expired') return leaveExpiredSession();
    if (error instanceof CatalogClientError && error.kind === 'aborted') return;
    seriesDetail = Object.freeze({ status: 'error', item, details: null, selectedSeasonKey: null, error: error instanceof CatalogClientError ? errorCopy(error) : CATALOG_COPY.error });
    render();
  }
}

async function ensureDestination(): Promise<void> {
  const available = await ensureCapabilities();
  if (!available || !shellPresent || shellBusy()) return;
  if (destination === 'home' || !isCatalogFamilySupported(available, destination)) return render();
  if (destination === 'live' && live.status === 'idle') await loadLive(live.selectedCategoryId);
  else if (destination === 'movies' && movies.status === 'idle') await loadMovies(movies.selectedCategoryId);
  else if (destination === 'series' && series.status === 'idle') await loadSeries(series.selectedCategoryId);
}

function navigate(next: ShellDestinationId): void {
  const place = window.matchMedia('(min-width: 56rem)').matches ? 'sidebar' : 'bottom';
  const control = root.querySelector<HTMLButtonElement>(
    `[data-nav-place="${place}"][data-nav-destination="${next}"]`,
  );
  control?.click();
}

const actions: CatalogActions = Object.freeze({
  navigate,
  retryCapabilities() { void ensureCapabilities(true); },
  selectCategory(family, categoryId) {
    if (family === 'live') void loadLive(categoryId);
    else if (family === 'movies') void loadMovies(categoryId);
    else void loadSeries(categoryId);
  },
  loadMore(family) {
    if (family === 'live') live = Object.freeze({ ...live, visibleCount: nextCatalogRenderCount(live.visibleCount, live.items.length) });
    else if (family === 'movies') movies = Object.freeze({ ...movies, visibleCount: nextCatalogRenderCount(movies.visibleCount, movies.items.length) });
    else series = Object.freeze({ ...series, visibleCount: nextCatalogRenderCount(series.visibleCount, series.items.length) });
    render();
  },
  openMovie(item) { void openMovie(item); },
  closeMovie() { detailsOwner.invalidate(); movieDetail = Object.freeze({ status: 'idle', item: null, details: null, error: null }); render(); },
  retryMovie(item) { void openMovie(item); },
  openSeries(item) { void openSeries(item); },
  closeSeries() { detailsOwner.invalidate(); seriesDetail = Object.freeze({ status: 'idle', item: null, details: null, selectedSeasonKey: null, error: null }); render(); },
  retrySeries(item) { void openSeries(item); },
  selectSeason(seasonKey) { seriesDetail = Object.freeze({ ...seriesDetail, selectedSeasonKey: seasonKey }); render(); },
});

function sync(): void {
  if (syncing) return;
  syncing = true;
  queueMicrotask(() => {
    syncing = false;
    const shell = root.querySelector('.authenticated-shell');
    if (!shell) {
      if (shellPresent) resetData();
      shellPresent = false;
      destination = 'home';
      return;
    }
    shellPresent = true;
    if (shellBusy()) {
      resetData();
      return;
    }
    const next = activeDestination();
    if (!next) return;
    if (next !== destination) {
      listingOwner.invalidate();
      detailsOwner.invalidate();
      destination = next;
      if (live.status === 'loading') live = Object.freeze({ ...live, status: 'idle' });
      if (movies.status === 'loading') movies = Object.freeze({ ...movies, status: 'idle' });
      if (series.status === 'loading') series = Object.freeze({ ...series, status: 'idle' });
    }
    render();
    void ensureDestination();
  });
}

new MutationObserver(sync).observe(root, { childList: true });
sync();
