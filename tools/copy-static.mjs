import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webOutput = resolve(root, 'dist/apps/web');
const assetOutput = resolve(webOutput, 'assets');
const fontOutput = resolve(assetOutput, 'fonts');
const plexFontSource = resolve(
  root,
  'node_modules/@ibm/plex-sans-arabic/fonts/complete/woff2',
);

await mkdir(assetOutput, { recursive: true });
await mkdir(fontOutput, { recursive: true });
await copyFile(resolve(root, 'apps/web/index.html'), resolve(webOutput, 'index.html'));
await copyFile(resolve(root, 'apps/web/styles.css'), resolve(webOutput, 'styles.css'));
await copyFile(resolve(root, 'apps/web/login-polish.css'), resolve(webOutput, 'login-polish.css'));
await copyFile(
  resolve(root, 'apps/web/assets/hulk-sa-badge.svg'),
  resolve(assetOutput, 'hulk-sa-badge.svg'),
);
await copyFile(
  resolve(root, 'apps/web/assets/hulk-sa-lockup.svg'),
  resolve(assetOutput, 'hulk-sa-lockup.svg'),
);
for (const fontName of [
  'IBMPlexSansArabic-Regular.woff2',
  'IBMPlexSansArabic-Bold.woff2',
]) {
  await copyFile(resolve(plexFontSource, fontName), resolve(fontOutput, fontName));
}
await copyFile(
  resolve(plexFontSource, 'license.txt'),
  resolve(fontOutput, 'IBM-Plex-Sans-Arabic-LICENSE.txt'),
);
