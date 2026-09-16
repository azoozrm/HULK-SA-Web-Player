import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  renderAppBasePathTemplate,
  renderVersionedStaticAssetUrls,
  resolveVersionedStaticAssetPath,
} from '../dist/apps/server/src/http/app-path.js';
import {
  resolveAppPath,
  resolveLoginComposition,
  SHELL_DESTINATIONS,
} from '../dist/apps/web/src/ui-model.js';

test('Phase 5A adaptive login policy stays centered on phones and splits only on roomy landscape viewports', () => {
  assert.equal(resolveLoginComposition(390, 844), 'centered');
  assert.equal(resolveLoginComposition(844, 390), 'centered');
  assert.equal(resolveLoginComposition(740, 600), 'centered');
  assert.equal(resolveLoginComposition(760, 500), 'split');
  assert.equal(resolveLoginComposition(900, 430), 'centered');
  assert.equal(resolveLoginComposition(1280, 720), 'split');
  assert.equal(resolveLoginComposition(1920, 1080), 'split');
});

test('Phase 5A adaptive login policy prefers a valid Visual Viewport and falls back safely', () => {
  assert.equal(
    resolveLoginComposition(1280, 720, { width: 1280, height: 390 }),
    'centered',
    'software keyboard height reduction must leave split composition',
  );
  assert.equal(resolveLoginComposition(1280, 720, null), 'split');
  assert.equal(resolveLoginComposition(1280, 720, { width: 0, height: 390 }), 'split');
  assert.equal(resolveLoginComposition(1280, 720, { width: 1280, height: Number.NaN }), 'split');
  assert.equal(resolveLoginComposition(1280, 720, { width: Number.POSITIVE_INFINITY, height: 390 }), 'split');
});

test('Phase 5A browser-owned URLs remain base-path safe', () => {
  assert.equal(resolveAppPath('', '/api/session'), '/api/session');
  assert.equal(resolveAppPath('/player', '/api/session'), '/player/api/session');
  assert.equal(resolveAppPath('/player', '/assets/hulk-sa-badge.svg'), '/player/assets/hulk-sa-badge.svg');
  assert.throws(() => resolveAppPath('/player', 'api/session'));
  assert.throws(() => resolveAppPath('player', '/api/session'));
  assert.throws(() => resolveAppPath('/player/', '/api/session'));
});

test('Phase 5A static entry assets use one fresh revision for CSS, modules and font-relative delivery', async () => {
  const revision = 'abcdefghijklmnop';
  const template = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8');
  const mounted = renderAppBasePathTemplate(template, '/player');
  const rendered = renderVersionedStaticAssetUrls(mounted, '/player', revision);
  assert.match(rendered, /href="\/player\/_static\/abcdefghijklmnop\/styles\.css"/u);
  assert.match(rendered, /href="\/player\/_static\/abcdefghijklmnop\/login-polish\.css"/u);
  assert.match(rendered, /src="\/player\/_static\/abcdefghijklmnop\/src\/main\.js"/u);
  assert.doesNotMatch(rendered, /href="\/player\/styles\.css"/u);
  assert.doesNotMatch(rendered, /href="\/player\/login-polish\.css"/u);
  assert.doesNotMatch(rendered, /src="\/player\/src\/main\.js"/u);
  assert.equal(
    resolveVersionedStaticAssetPath('/_static/abcdefghijklmnop/src/ui-model.js'),
    '/src/ui-model.js',
  );
  assert.equal(
    resolveVersionedStaticAssetPath(
      '/_static/abcdefghijklmnop/assets/fonts/IBMPlexSansArabic-Regular.woff2',
    ),
    '/assets/fonts/IBMPlexSansArabic-Regular.woff2',
  );
  assert.equal(resolveVersionedStaticAssetPath('/styles.css'), '/styles.css');
  assert.throws(() => renderVersionedStaticAssetUrls(mounted, '/player', 'bad'));

  const appHandler = await readFile(
    new URL('../apps/server/src/http/app-handler.ts', import.meta.url),
    'utf8',
  );
  assert.match(appHandler, /randomBytes\(12\)\.toString\('base64url'\)/u);
  assert.match(appHandler, /response\.setHeader\('Cache-Control', 'no-cache'\)/u);
});

test('Phase 5A shell exposes only the authorized navigation foundation', () => {
  assert.deepEqual(
    SHELL_DESTINATIONS.map(({ id, label }) => ({ id, label })),
    [
      { id: 'home', label: 'الرئيسية' },
      { id: 'live', label: 'البث المباشر' },
      { id: 'movies', label: 'الأفلام' },
      { id: 'series', label: 'المسلسلات' },
    ],
  );
});

test('Phase 5A browser source does not add Provider credential persistence or client logging', async () => {
  const sources = await Promise.all([
    readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/src/session-client.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/src/ui-model.ts', import.meta.url), 'utf8'),
  ]);
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/iu);
  assert.doesNotMatch(combined, /\bconsole\.(?:log|info|warn|error|debug)\b/u);
  assert.match(combined, /credentials:\s*'same-origin'/u);
  assert.match(combined, /password\.type = showPassword \? 'text' : 'password'/u);
  assert.match(combined, /if \(submitting\) return;/u);
  assert.match(combined, /input\.type = 'checkbox'/u);
  assert.match(combined, /\.input\.checked/u);
});

test('Phase 5A visual source carries HULK tokens, safe areas, focus and reduced-motion behavior', async () => {
  const [styles, polish] = await Promise.all([
    readFile(new URL('../apps/web/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/login-polish.css', import.meta.url), 'utf8'),
  ]);
  for (const token of [
    '#e6c352',
    '#fff0a8',
    '#9a7a23',
    '#030402',
    '#111108',
    '#1b1a0e',
    '#fff9eb',
    '#b8b3a4',
    '#ff746c',
  ]) {
    assert.match(styles, new RegExp(token, 'u'));
  }
  assert.match(styles, /env\(safe-area-inset-top\)/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/u);
  assert.match(styles, /data-composition="split"/u);
  assert.match(styles, /@media \(min-width:\s*56rem\)/u);
  assert.match(polish, /@font-face/u);
  assert.match(polish, /linear-gradient\(135deg, #e8c95e 0%, #c89c32 52%, #9b7221 100%\)/u);
});

test('Phase 5A login and shell keep keyboard, D-pad and viewport resize navigation explicit', async () => {
  const [mainSource, uiModelSource] = await Promise.all([
    readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/src/ui-model.ts', import.meta.url), 'utf8'),
  ]);
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
    assert.match(mainSource, new RegExp(key, 'u'));
  }
  assert.match(mainSource, /aria-current/u);
  assert.match(mainSource, /aria-label', 'التنقل الرئيسي'/u);
  assert.match(mainSource, /reportValidity/u);
  assert.match(mainSource, /window\.addEventListener\('resize', syncLoginComposition/u);
  assert.match(mainSource, /window\.visualViewport\?\.addEventListener\('resize', syncLoginComposition/u);
  assert.match(uiModelSource, /window\.visualViewport\.width/u);
  assert.match(uiModelSource, /window\.visualViewport\.height/u);
});

test('Phase 5A brand and IBM Plex assets are copied and served by the Web runtime', async () => {
  const [badge, lockup, copyStatic, appHandler] = await Promise.all([
    readFile(new URL('../apps/web/assets/hulk-sa-badge.svg', import.meta.url), 'utf8'),
    readFile(new URL('../apps/web/assets/hulk-sa-lockup.svg', import.meta.url), 'utf8'),
    readFile(new URL('../tools/copy-static.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/server/src/http/app-handler.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(badge, /viewBox="0 0 1254 1254"/u);
  assert.match(lockup, /viewBox="0 0 1672 941"/u);
  assert.doesNotMatch(badge, /<script\b/iu);
  assert.doesNotMatch(lockup, /<script\b/iu);
  for (const name of ['hulk-sa-badge.svg', 'hulk-sa-lockup.svg']) {
    assert.match(copyStatic, new RegExp(name.replace('.', '\\.'), 'u'));
    assert.match(appHandler, new RegExp(name.replace('.', '\\.'), 'u'));
  }
  for (const name of ['IBMPlexSansArabic-Regular.woff2', 'IBMPlexSansArabic-Bold.woff2']) {
    assert.match(copyStatic, new RegExp(name.replace('.', '\\.'), 'u'));
    assert.match(appHandler, new RegExp(name.replace('.', '\\.'), 'u'));
  }
  assert.match(appHandler, /image\/svg\+xml; charset=utf-8/u);
  assert.match(appHandler, /font\/woff2/u);
  assert.match(appHandler, /\/src\/ui-model\.js/u);
});
