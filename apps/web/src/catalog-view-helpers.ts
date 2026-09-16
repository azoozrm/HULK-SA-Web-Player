import { browserSafeImageUrl, CATALOG_COPY } from './catalog-model.js';
import type { CatalogFamilyId, DetailMetadata } from './catalog-model.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ICONS = Object.freeze({
  live: ['M4 7.5h16v11H4Z', 'M10.5 11 15 13l-4.5 2Z'],
  movies: ['M4 7h16v13H4Z', 'M4 7l2-3h14l-2 3'],
  series: ['M5 6h14v14H5Z', 'M9 10h6M9 14h6M9 18h4'],
  image: ['M4 5.5h16v13H4Z', 'm7 8-2 2-2-2.5-3 4'],
  back: ['M15 6l-6 6 6 6', 'M9 12h10'],
});
type ViewIcon = keyof typeof ICONS;

export function viewIcon(name: ViewIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.classList.add('ui-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const pathData of ICONS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
  }
  return svg;
}

export function viewButton(label: string, className: string): HTMLButtonElement {
  const value = document.createElement('button');
  value.type = 'button';
  value.className = className;
  value.textContent = label;
  return value;
}

export function statusPanel(
  message: string,
  kind: 'loading' | 'empty' | 'error' | 'unsupported',
  retry?: () => void,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = `catalog-status catalog-status-${kind}`;
  panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  panel.setAttribute('aria-live', 'polite');
  if (kind === 'loading') panel.setAttribute('aria-busy', 'true');
  const mark = document.createElement('span');
  mark.className = 'catalog-status-icon';
  mark.append(viewIcon('image'));
  const copy = document.createElement('p');
  copy.textContent = message;
  panel.append(mark, copy);
  if (retry) {
    const action = viewButton(CATALOG_COPY.retry, 'catalog-secondary-action');
    action.addEventListener('click', retry);
    panel.append(action);
  }
  return panel;
}

export function artwork(
  url: string | null,
  alt: string,
  family: CatalogFamilyId,
  className = '',
): HTMLElement {
  const frame = document.createElement('div');
  frame.className = `catalog-artwork catalog-artwork-${family} ${className}`.trim();
  const fallback = (): void => {
    frame.replaceChildren(viewIcon(family));
    frame.classList.add('is-placeholder');
    frame.setAttribute('role', 'img');
    frame.setAttribute('aria-label', CATALOG_COPY.imageUnavailable);
  };
  const safe = browserSafeImageUrl(url, window.location.origin);
  if (!safe) {
    fallback();
    return frame;
  }
  const image = document.createElement('img');
  image.src = safe;
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', fallback, { once: true });
  frame.append(image);
  return frame;
}

export function loadMoreControl(total: number, visible: number, action: () => void): HTMLElement | null {
  if (visible >= total) return null;
  const wrap = document.createElement('div');
  wrap.className = 'catalog-load-more';
  const control = viewButton(CATALOG_COPY.loadMore, 'catalog-secondary-action');
  control.addEventListener('click', action);
  wrap.append(control);
  return wrap;
}

export function detailMetadata(rows: readonly DetailMetadata[]): HTMLElement | null {
  if (rows.length === 0) return null;
  const list = document.createElement('dl');
  list.className = 'catalog-detail-metadata';
  for (const row of rows) {
    const entry = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    value.textContent = row.value;
    entry.append(term, value);
    list.append(entry);
  }
  return list;
}

export function backControl(action: () => void): HTMLButtonElement {
  const control = viewButton(CATALOG_COPY.back, 'catalog-back-action');
  control.prepend(viewIcon('back'));
  control.addEventListener('click', action);
  return control;
}

export function detailBody(
  family: 'movies' | 'series',
  titleText: string,
  posterUrl: string | null,
  rows: readonly DetailMetadata[],
  plot: string | null,
): HTMLElement {
  const detail = document.createElement('article');
  detail.className = 'catalog-detail';
  detail.append(artwork(posterUrl, titleText, family, 'catalog-detail-artwork'));
  const body = document.createElement('div');
  body.className = 'catalog-detail-body';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'catalog-detail-eyebrow';
  eyebrow.textContent = CATALOG_COPY.details;
  const title = document.createElement('h2');
  title.textContent = titleText;
  body.append(eyebrow, title);
  const meta = detailMetadata(rows);
  if (meta) body.append(meta);
  if (plot) {
    const copy = document.createElement('p');
    copy.className = 'catalog-detail-plot';
    copy.textContent = plot;
    body.append(copy);
  }
  detail.append(body);
  return detail;
}
