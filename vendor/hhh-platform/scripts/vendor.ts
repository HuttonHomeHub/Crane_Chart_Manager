// Vendors a released hhh-platform bundle into an app, or checks the vendored copy.
// Ships inside every release bundle, so an app runs it from its own vendored copy:
//
//   node vendor/hhh-platform/scripts/vendor.ts 0.2.0   # download, verify, install v0.2.0
//   node vendor/hhh-platform/scripts/vendor.ts --check # CI: vendored files match the manifest
//
// Downloads come from the public GitHub release, so no token is needed. The bundle's
// SHA-256 must match the published checksum, and every file must match the manifest,
// before the old copy is replaced.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE,
  diffManifest,
  hashTree,
  isClean,
  sha256,
  type Manifest,
  type ManifestDiff,
} from './lib/manifest.ts';

export const REPO = 'HuttonHomeHub/hhh-platform';
const VERSION_RE = /^\d+\.\d+\.\d+$/;

type FetchLike = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export function releaseUrls(version: string): { tarball: string; checksum: string } {
  const base = `https://github.com/${REPO}/releases/download/v${version}/hhh-platform-${version}.tgz`;
  return { tarball: base, checksum: `${base}.sha256` };
}

export async function verifyVendor(dir: string): Promise<{ version: string; diff: ManifestDiff }> {
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as Manifest;
  return { version: manifest.version, diff: diffManifest(manifest.files, await hashTree(dir)) };
}

async function download(fetchImpl: FetchLike, url: string): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function installRelease(
  version: string,
  vendorDir: string,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (!VERSION_RE.test(version)) throw new Error(`version must be X.Y.Z, got ${version}`);
  const urls = releaseUrls(version);
  const tgz = await download(fetchImpl, urls.tarball);
  const expected = (await download(fetchImpl, urls.checksum))
    .toString('utf8')
    .trim()
    .split(/\s+/)[0];
  if (sha256(tgz) !== expected) throw new Error('bundle checksum does not match the release');

  // Unpack next to the destination so the final swap is a same-filesystem rename.
  // On an app's first install, vendor/ doesn't exist yet.
  await mkdir(dirname(vendorDir), { recursive: true });
  const work = await mkdtemp(`${vendorDir}.incoming-`);
  try {
    const archive = join(work, 'bundle.tgz');
    await writeFile(archive, tgz);
    const tar = spawnSync('tar', ['-xzf', archive, '-C', work], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error?.message}`);
    const unpacked = join(work, 'hhh-platform');
    const check = await verifyVendor(unpacked);
    if (check.version !== version)
      throw new Error(`bundle is ${check.version}, expected ${version}`);
    if (!isClean(check.diff)) throw new Error('bundle files do not match its manifest');
    await rm(vendorDir, { recursive: true, force: true });
    await rename(unpacked, vendorDir);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function describeDiff(diff: ManifestDiff): string[] {
  return [
    ...diff.changed.map((f) => `changed: ${f}`),
    ...diff.missing.map((f) => `missing: ${f}`),
    ...diff.extra.map((f) => `extra:   ${f}`),
  ];
}

export async function main(
  args: string[],
  vendorDir = resolve(process.cwd(), 'vendor', 'hhh-platform'),
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const [arg] = args;
  if (arg === '--check') {
    const { version, diff } = await verifyVendor(vendorDir);
    if (isClean(diff)) {
      console.warn(`vendor/hhh-platform matches release ${version}`);
      return 0;
    }
    console.error(
      `vendor/hhh-platform differs from release ${version} (edit the platform, not the copy):`
    );
    for (const line of describeDiff(diff)) console.error(`  ${line}`);
    return 1;
  }
  if (arg && VERSION_RE.test(arg)) {
    await installRelease(arg, vendorDir, fetchImpl);
    console.warn(`vendored hhh-platform ${arg} into ${vendorDir}`);
    return 0;
  }
  console.error('usage: vendor.ts <X.Y.Z> | --check');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
