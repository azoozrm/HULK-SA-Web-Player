import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'coverage']);

export async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;

    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(root, absolute)));
      continue;
    }

    if (entry.isFile()) output.push(relative(root, absolute));
  }

  return output.sort();
}

export async function readUtf8(path) {
  return readFile(path, 'utf8');
}

export async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
