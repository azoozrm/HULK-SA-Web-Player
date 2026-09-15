import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUtf8, walkFiles } from './lib/files.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const writeMode = process.argv.includes('--write');
const explicitNames = new Set([
  '.editorconfig',
  '.env.example',
  '.gitignore',
  '.node-version',
]);
const textExtensionPattern = /\.(?:css|html|json|md|mjs|ts|ya?ml)$/u;
const files = (await walkFiles(root)).filter(
  (file) =>
    file !== 'package-lock.json' &&
    (explicitNames.has(file) || textExtensionPattern.test(file)),
);
const changed = [];

function normalize(source) {
  const normalizedLines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const cleaned = normalizedLines.map((line) => line.replace(/[ \t]+$/u, '')).join('\n');
  return `${cleaned.replace(/\n+$/u, '')}\n`;
}

for (const file of files) {
  const absolute = resolve(root, file);
  const source = await readUtf8(absolute);
  const formatted = normalize(source);
  if (formatted === source) continue;

  changed.push(file);
  if (writeMode) await writeFile(absolute, formatted, 'utf8');
}

if (changed.length && !writeMode) {
  throw new Error(`Formatting violations:\n${changed.join('\n')}`);
}

process.stdout.write(
  writeMode
    ? `Format PASS (${files.length} files normalized, ${changed.length} changed)\n`
    : `Format check PASS (${files.length} files checked)\n`,
);
