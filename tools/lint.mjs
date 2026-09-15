import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUtf8, walkFiles } from './lib/files.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = await walkFiles(root);
const lintable = files.filter(
  (file) => /\.(?:ts|mjs)$/u.test(file) && !file.startsWith('tests/'),
);
const failures = [];

for (const file of lintable) {
  const source = await readUtf8(resolve(root, file));
  if (source.split(/\r?\n/u).some((line) => /[ \t]+$/u.test(line))) {
    failures.push(`${file}: trailing whitespace`);
  }
  if (/(?:\bas\s+any\b|:\s*any\b)/u.test(source)) {
    failures.push(`${file}: explicit any`);
  }
}

if (failures.length) {
  throw new Error(`Lint violations:\n${failures.join('\n')}`);
}

process.stdout.write(`Lint PASS (${lintable.length} source files checked)\n`);
