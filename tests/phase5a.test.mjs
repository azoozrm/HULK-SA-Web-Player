import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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

test('Phase 5A browser-owned URLs remain base-path safe', () => {
  assert.equal(resolveAppPath('', '/api/session'), '/api/session');
  assert.equal(resolveAppPath('/player', '/api/session'), '/player/api/session');
  assert.equal(resolveAppPath('/player', '/assets/hulk-sa-badge.svg'), '/player/assets/hulk-sa-badge.svg');
  assert.throws(() => resolveAppPath('/player', 'api/session'));
  assert.throws(() => resolveAppPath('player', '/api/session'));
  assert.throws(() => resolveAppPath('/player/', '/api/session'));
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
  assert.match(combined, /aria-pressed/u);
});

test('Phase 5A visual source carries HULK tokens, safe areas, focus and reduced-motion behavior', async () => {
  const styles = await readFile(new URL('../apps/web/styles.css', import.meta.url), 'utf8');
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
});

test('Phase 5A login and shell keep keyboard and D-pad style navigation explicit', async () => {
  const source = await readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8');
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
    assert.match(source, new RegExp(key, 'u'));
  }
  assert.match(source, /aria-current/u);
  assert.match(source, /aria-label', 'التنقل الرئيسي'/u);
  assert.match(source, /reportValidity/u);
});

test('Phase 5A brand assets are local SVGs copied and served by the Web runtime', async () => {
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
  assert.match(appHandler, /image\/svg\+xml; charset=utf-8/u);
  assert.match(appHandler, /\/src\/ui-model\.js/u);
});
