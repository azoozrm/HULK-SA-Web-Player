import {
  CATALOG_COPY,
  episodeDisplayName,
  formatDuration,
  movieDetailsMetadata,
  resolveSeriesSeason,
  seasonDisplayName,
  seriesDetailsMetadata,
} from './catalog-model.js';
import { artwork, backControl, detailBody, statusPanel, viewButton } from './catalog-view-helpers.js';
import type { CatalogActions, MovieDetailViewState, SeriesDetailViewState } from './catalog-view-state.js';

export function renderMovieDetail(
  state: MovieDetailViewState,
  actions: CatalogActions,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'catalog-page-body';
  if (!state.item) return wrap;
  wrap.append(backControl(actions.closeMovie));
  if (state.status === 'loading') {
    wrap.append(statusPanel(CATALOG_COPY.loading, 'loading'));
  } else if (state.status === 'error') {
    const item = state.item;
    wrap.append(statusPanel(
      state.error ?? CATALOG_COPY.error,
      'error',
      () => actions.retryMovie(item),
    ));
  } else if (state.status === 'ready' && state.details) {
    const title = state.details.name ?? state.item.name;
    wrap.append(detailBody(
      'movies',
      title,
      state.details.posterUrl ?? state.item.posterUrl,
      movieDetailsMetadata(state.details),
      state.details.plot,
    ));
  }
  return wrap;
}

export function renderSeriesDetail(
  state: SeriesDetailViewState,
  actions: CatalogActions,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'catalog-page-body';
  if (!state.item) return wrap;
  wrap.append(backControl(actions.closeSeries));
  if (state.status === 'loading') {
    wrap.append(statusPanel(CATALOG_COPY.loading, 'loading'));
    return wrap;
  }
  if (state.status === 'error') {
    const item = state.item;
    wrap.append(statusPanel(
      state.error ?? CATALOG_COPY.error,
      'error',
      () => actions.retrySeries(item),
    ));
    return wrap;
  }
  if (state.status !== 'ready' || !state.details) return wrap;

  const details = state.details;
  const title = details.name ?? state.item.name;
  wrap.append(detailBody(
    'series',
    title,
    details.posterUrl ?? state.item.posterUrl,
    seriesDetailsMetadata(details),
    details.plot,
  ));
  if (details.seasons.length === 0) {
    wrap.append(statusPanel(CATALOG_COPY.empty, 'empty'));
    return wrap;
  }

  const region = document.createElement('section');
  region.className = 'series-season-region';
  const heading = document.createElement('h3');
  heading.textContent = CATALOG_COPY.seasons;
  const selector = document.createElement('div');
  selector.className = 'series-season-selector';
  for (const season of details.seasons) {
    const control = viewButton(seasonDisplayName(season), 'catalog-category-button');
    if (season.seasonKey === state.selectedSeasonKey) {
      control.classList.add('is-active');
      control.setAttribute('aria-current', 'true');
    }
    control.addEventListener('click', () => actions.selectSeason(season.seasonKey));
    selector.append(control);
  }
  region.append(heading, selector);

  const episodesHeading = document.createElement('h3');
  episodesHeading.textContent = CATALOG_COPY.episodes;
  region.append(episodesHeading);
  const season = resolveSeriesSeason(details, state.selectedSeasonKey);
  if (!season || season.episodes.length === 0) {
    region.append(statusPanel(CATALOG_COPY.empty, 'empty'));
  } else {
    const list = document.createElement('div');
    list.className = 'series-episode-list';
    for (const episode of season.episodes) {
      const card = document.createElement('article');
      card.className = 'series-episode-card';
      card.append(artwork(
        episode.imageUrl,
        episodeDisplayName(episode),
        'series',
        'series-episode-artwork',
      ));
      const copy = document.createElement('div');
      const episodeTitle = document.createElement('h4');
      episodeTitle.textContent = episodeDisplayName(episode);
      copy.append(episodeTitle);
      const duration = formatDuration(episode.durationSeconds);
      if (duration) {
        const meta = document.createElement('p');
        meta.textContent = duration;
        copy.append(meta);
      }
      card.append(copy);
      list.append(card);
    }
    region.append(list);
  }
  wrap.append(region);
  return wrap;
}
