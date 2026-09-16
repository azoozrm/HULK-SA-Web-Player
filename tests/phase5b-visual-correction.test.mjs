import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatDisplayDate } from '../dist/apps/web/src/catalog-model.js';

test('Phase 5B release dates are rendered as readable Gregorian display dates without changing unknown Provider values', () => {
  assert.equal(formatDisplayDate('2025-01-01T00:00:00.000Z'), '1 يناير 2025');
  assert.equal(formatDisplayDate('2026-07-23'), '23 يوليو 2026');
  assert.equal(formatDisplayDate('2026-02-30'), '2026-02-30');
  assert.equal(formatDisplayDate('coming soon'), 'coming soon');
  assert.equal(formatDisplayDate(null), null);
});

test('Phase 5B rendered correction keeps family identity, fallback visuals and subscription shell treatment explicit', async () => {
  const [polish, listing] = await Promise.all([
    readFile(new URL('../apps/web/catalog-polish.css', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/src/catalog-view-listing.ts', import.meta.url), 'utf8'),
  ]);

  for (const family of ['live', 'movies', 'series']) {
    assert.match(polish, new RegExp(`catalog-home-card-${family}`, 'u'));
    assert.match(polish, new RegExp(`catalog-artwork-${family}\\.is-placeholder`, 'u'));
  }
  assert.match(polish, /content:\s*'معلومات الاشتراك'/u);
  assert.match(polish, /grid-template-areas:[\s\S]*'topbar topbar'[\s\S]*'content sidebar'/u);
  assert.match(polish, /shell-mobile-topbar[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/u);
  assert.match(polish, /catalog-detail-artwork[\s\S]*max-block-size:\s*14rem/u);
  assert.match(polish, /catalog-poster-card \.catalog-artwork[\s\S]*aspect-ratio:\s*4 \/ 5/u);
  assert.match(listing, /control\.prepend\(viewIcon\(family\)\)/u);
  assert.match(listing, /card\.classList\.add\(`catalog-home-card-\$\{destination\.id\}`\)/u);
});

test('Phase 5B visual correction stylesheet is versioned, copied and served without relaxing CSP', async () => {
  const [appPath, appHandler, index, copyStatic] = await Promise.all([
    readFile(new URL('../apps/server/src/http/app-path.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/server/src/http/app-handler.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../tools/copy-static.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(index, /catalog-polish\.css/u);
  assert.match(appPath, /catalog-polish\.css/u);
  assert.match(appHandler, /catalog-polish\.css/u);
  assert.match(copyStatic, /catalog-polish\.css/u);
  assert.match(appHandler, /img-src 'self'/u);
  assert.doesNotMatch(appHandler, /img-src[^;]*https:/u);
});
