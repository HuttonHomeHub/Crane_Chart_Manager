// File manifests for release bundles: the SHA-256 of every file, so an app's vendored
// copy can be checked against exactly what was released (no hand edits, nothing missing).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const MANIFEST_FILE = 'manifest.json';

export interface Manifest {
  version: string;
  files: Record<string, string>;
}

export interface ManifestDiff {
  changed: string[];
  missing: string[];
  extra: string[];
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Every file under `dir`, as sorted POSIX paths relative to it. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

/** SHA-256 of every file under `dir`, except the manifest itself. */
export async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await listFiles(dir)) {
    if (file === MANIFEST_FILE) continue;
    out[file] = sha256(await readFile(join(dir, file)));
  }
  return out;
}

export function diffManifest(
  expected: Record<string, string>,
  actual: Record<string, string>
): ManifestDiff {
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [file, hash] of Object.entries(expected)) {
    if (!(file in actual)) missing.push(file);
    else if (actual[file] !== hash) changed.push(file);
  }
  const extra = Object.keys(actual).filter((file) => !(file in expected));
  return { changed, missing, extra };
}

export function isClean(diff: ManifestDiff): boolean {
  return diff.changed.length === 0 && diff.missing.length === 0 && diff.extra.length === 0;
}
