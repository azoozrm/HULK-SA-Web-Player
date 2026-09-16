import { CATALOG_COPY, isCatalogFamilySupported } from './catalog-model.js';
import { renderMovieDetail, renderSeriesDetail } from './catalog-view-details.js';
import { statusPanel } from './catalog-view-helpers.js';
import { renderHome, renderLive, renderPosters } from './catalog-view-listing.js';
import type { CatalogActions, CatalogRenderState } from './catalog-view-state.js';

export function renderCatalog(
  target: HTMLElement,
  state: CatalogRenderState,
  actions: CatalogActions,
): void {
  target.className = 'catalog-stage';
  target.replaceChildren();
  if (state.capabilities.status === 'idle' || state.capabilities.status === 'loading') {
    target.append(statusPanel(CATALOG_COPY.homeLoading, 'loading'));
    return;
  }
  if (state.capabilities.status === 'error') {
    target.append(statusPanel(
      state.capabilities.message,
      'error',
      actions.retryCapabilities,
    ));
    return;
  }
  if (state.destination === 'home') {
    target.append(renderHome(state.capabilities, actions));
    return;
  }
  if (!isCatalogFamilySupported(state.capabilities.value, state.destination)) {
    target.append(statusPanel(CATALOG_COPY.unsupported, 'unsupported'));
    return;
  }
  if (state.destination === 'live') {
    target.append(renderLive(state.live, actions));
  } else if (state.destination === 'movies') {
    target.append(
      state.movieDetail.status === 'idle'
        ? renderPosters('movies', state.movies, actions, actions.openMovie)
        : renderMovieDetail(state.movieDetail, actions),
    );
  } else {
    target.append(
      state.seriesDetail.status === 'idle'
        ? renderPosters('series', state.series, actions, actions.openSeries)
        : renderSeriesDetail(state.seriesDetail, actions),
    );
  }
}

export type {
  CatalogActions,
  CatalogRenderState,
  FamilyViewState,
  MovieDetailViewState,
  SeriesDetailViewState,
} from './catalog-view-state.js';
