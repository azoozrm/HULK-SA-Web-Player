import type { LiveChannel, MovieSummary, SeriesSummary } from '../../../packages/contracts/src/index.js';
import { allCategoryLabel, CATALOG_COPY, isCatalogFamilySupported } from './catalog-model.js';
import type { CatalogFamilyId } from './catalog-model.js';
import { artwork, loadMoreControl, statusPanel, viewButton, viewIcon } from './catalog-view-helpers.js';
import type { CatalogActions, CatalogRenderState, FamilyViewState } from './catalog-view-state.js';
import { SHELL_DESTINATIONS } from './ui-model.js';

function categories<T>(
  family: CatalogFamilyId,
  state: FamilyViewState<T>,
  action: (id: string | null) => void,
): HTMLElement {
  const region = document.createElement('section');
  region.className = 'catalog-category-region';
  region.setAttribute('aria-label', CATALOG_COPY.categories);
  const strip = document.createElement('div');
  strip.className = 'catalog-category-strip';
  const entries = [{ id: null, name: allCategoryLabel(family) }, ...state.categories];
  for (const entry of entries) {
    const control = viewButton(entry.name, 'catalog-category-button');
    if (entry.id === state.selectedCategoryId) {
      control.classList.add('is-active');
      control.setAttribute('aria-current', 'true');
    }
    control.disabled = state.status === 'loading';
    control.addEventListener('click', () => action(entry.id));
    strip.append(control);
  }
  region.append(strip);
  return region;
}

function listingShell<T>(
  family: CatalogFamilyId,
  state: FamilyViewState<T>,
  actions: CatalogActions,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'catalog-page-body';
  if (state.categoriesLoaded) {
    wrap.append(categories(family, state, (id) => actions.selectCategory(family, id)));
  }
  return wrap;
}

function cardMeta(body: HTMLElement, year: number | null, rating: number | null): void {
  if (year === null && rating === null) return;
  const meta = document.createElement('div');
  meta.className = 'catalog-card-meta';
  for (const value of [year, rating]) {
    if (value === null) continue;
    const chip = document.createElement('span');
    chip.textContent = String(value);
    meta.append(chip);
  }
  body.append(meta);
}

export function renderLive(state: FamilyViewState<LiveChannel>, actions: CatalogActions): HTMLElement {
  const wrap = listingShell('live', state, actions);
  if (state.status === 'loading') {
    wrap.append(statusPanel(CATALOG_COPY.loading, 'loading'));
    return wrap;
  }
  if (state.status === 'error') {
    wrap.append(statusPanel(
      state.error ?? CATALOG_COPY.error,
      'error',
      () => actions.selectCategory('live', state.selectedCategoryId),
    ));
    return wrap;
  }
  if (state.status !== 'ready') return wrap;
  if (state.items.length === 0) {
    wrap.append(statusPanel(CATALOG_COPY.empty, 'empty'));
    return wrap;
  }
  const grid = document.createElement('div');
  grid.className = 'catalog-grid catalog-grid-live';
  for (const item of state.items.slice(0, state.visibleCount)) {
    const card = document.createElement('article');
    card.className = 'catalog-card catalog-live-card';
    card.append(artwork(item.imageUrl, item.name, 'live'));
    const body = document.createElement('div');
    body.className = 'catalog-card-body';
    const title = document.createElement('h2');
    title.textContent = item.name;
    body.append(title);
    card.append(body);
    grid.append(card);
  }
  wrap.append(grid);
  const more = loadMoreControl(state.items.length, state.visibleCount, () => actions.loadMore('live'));
  if (more) wrap.append(more);
  return wrap;
}

function posterCard(
  item: MovieSummary | SeriesSummary,
  family: 'movies' | 'series',
  open: () => void,
): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'catalog-card catalog-poster-card';
  card.append(artwork(item.posterUrl, item.name, family));
  const body = document.createElement('div');
  body.className = 'catalog-card-body';
  const title = document.createElement('h2');
  title.textContent = item.name;
  body.append(title);
  cardMeta(body, item.year, item.rating);
  card.append(body);
  card.addEventListener('click', open);
  return card;
}

export function renderPosters<T extends MovieSummary | SeriesSummary>(
  family: 'movies' | 'series',
  state: FamilyViewState<T>,
  actions: CatalogActions,
  open: (item: T) => void,
): HTMLElement {
  const wrap = listingShell(family, state, actions);
  if (state.status === 'loading') {
    wrap.append(statusPanel(CATALOG_COPY.loading, 'loading'));
    return wrap;
  }
  if (state.status === 'error') {
    wrap.append(statusPanel(
      state.error ?? CATALOG_COPY.error,
      'error',
      () => actions.selectCategory(family, state.selectedCategoryId),
    ));
    return wrap;
  }
  if (state.status !== 'ready') return wrap;
  if (state.items.length === 0) {
    wrap.append(statusPanel(CATALOG_COPY.empty, 'empty'));
    return wrap;
  }
  const grid = document.createElement('div');
  grid.className = 'catalog-grid catalog-grid-posters';
  for (const item of state.items.slice(0, state.visibleCount)) {
    grid.append(posterCard(item, family, () => open(item)));
  }
  wrap.append(grid);
  const more = loadMoreControl(state.items.length, state.visibleCount, () => actions.loadMore(family));
  if (more) wrap.append(more);
  return wrap;
}

export function renderHome(
  capabilities: Extract<CatalogRenderState['capabilities'], { status: 'ready' }>,
  actions: CatalogActions,
): HTMLElement {
  const body = document.createElement('div');
  body.className = 'catalog-home';
  const intro = document.createElement('p');
  intro.className = 'catalog-home-intro';
  intro.textContent = CATALOG_COPY.homeIntro;
  body.append(intro);
  const grid = document.createElement('div');
  grid.className = 'catalog-home-grid';
  for (const destination of SHELL_DESTINATIONS) {
    if (destination.id === 'home') continue;
    const supported = isCatalogFamilySupported(capabilities.value, destination.id);
    const card = viewButton('', 'catalog-home-card');
    card.disabled = !supported;
    const mark = document.createElement('span');
    mark.className = 'catalog-home-icon';
    mark.append(viewIcon(destination.id));
    const copy = document.createElement('span');
    copy.className = 'catalog-home-copy';
    const title = document.createElement('strong');
    title.textContent = destination.label.replace(/[أإآ]/gu, 'ا');
    const status = document.createElement('small');
    status.textContent = supported ? CATALOG_COPY.available : CATALOG_COPY.unavailable;
    copy.append(title, status);
    card.append(mark, copy);
    card.addEventListener('click', () => actions.navigate(destination.id));
    grid.append(card);
  }
  body.append(grid);
  return body;
}
