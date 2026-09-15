import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webOutput = resolve(root, 'dist/apps/web');

await mkdir(webOutput, { recursive: true });
await copyFile(resolve(root, 'apps/web/index.html'), resolve(webOutput, 'index.html'));
await copyFile(resolve(root, 'apps/web/styles.css'), resolve(webOutput, 'styles.css'));
