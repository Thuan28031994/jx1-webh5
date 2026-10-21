#!/usr/bin/env node
/**
 * Patch 01 binary media sync: read-only audit by default; --apply stages
 * ONLY previously untracked, allowlisted media, records SHA256 manifest,
 * commits and fast-forward pushes to thuan/main. Never removes/overwrites.
 *
 * Run from this repo on the original Windows PC:
 *   node tools/sync-patch01-media.mjs
 *   node tools/sync-patch01-media.mjs --apply
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const manifest = 'docs/PATCH01-MEDIA-MANIFEST.json';
const allowedRoots = new Set(['img', 'fx', 'snd', 'music', 'ui', 'fonts']);
const allowedExt = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif',
  '.mp3', '.ogg', '.wav', '.m4a', '.mp4', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.ico']);
const maxPagesAssetBytes = 25 * 1024 * 1024;
function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}
function die(message) { console.error('STOP: ' + message); process.exit(1); }
function mediaPath(p) {
  const normalized = p.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts[0] !== 'game' || parts.length < 3 || !allowedRoots.has(parts[1]) ||
      !allowedExt.has(extname(normalized).toLowerCase()) ||
      parts.includes('..') || normalized.includes('\0')) return false;
  return true;
}
function sha(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
if (!existsSync(join(root, '.git'))) die('Git working tree not found beside this script.');
if (git(['rev-parse', '--show-toplevel']).toLowerCase().replace(/\\/g, '/') !==
    root.toLowerCase().replace(/\\/g, '/')) die('Unexpected repository root.');
const branch = git(['branch', '--show-current']);
const remote = git(['remote', 'get-url', 'thuan']);
if (!/^(https:\/\/github\.com\/Thuan28031994\/jx1-webh5(?:\.git)?|git@github\.com:Thuan28031994\/jx1-webh5(?:\.git)?)$/i.test(remote)) {
  die('Remote thuan is not the expected Thuan28031994/jx1-webh5: ' + remote);
}
if (branch !== 'main') die('Checkout main and fast-forward from thuan/main first. Current: ' + branch);
if (!existsSync(join(root, 'game'))) die('Missing local game/ directory.');
const all = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'game/']);
const untracked = all.split('\0').filter(Boolean);
const candidates = untracked.filter(mediaPath).sort();
const ignored = untracked.filter(p => !mediaPath(p));
let total = 0;
const files = [];
for (const p of candidates) {
  const abs = resolve(root, p);
  if (!abs.startsWith(root + sep)) die('Unsafe candidate path: ' + p);
  const st = lstatSync(abs);
  if (!st.isFile() || st.isSymbolicLink()) die('Non-regular media: ' + p);
  if (st.size > maxPagesAssetBytes) die('Asset exceeds Cloudflare Pages 25MiB limit: ' + p);
  total += st.size;
  files.push({ path: p.replace(/\\/g, '/'), bytes: st.size, sha256: sha(abs) });
}
console.log('Source: ' + root);
console.log('Remote: ' + remote);
console.log('Branch: ' + branch);
console.log('NEW eligible media: ' + files.length);
console.log('NEW eligible bytes: ' + (total / 1024 / 1024).toFixed(2) + ' MiB');
console.log('Skipped OTHER untracked game files: ' + ignored.length);
const byRoot = {};
for (const f of files) { const k = f.path.split('/')[1]; byRoot[k] = (byRoot[k] || 0) + 1; }
console.log('By directory: ' + JSON.stringify(byRoot));
if (ignored.length) console.log('Skipped examples: ' + ignored.slice(0, 12).join(', '));
if (!apply) {
  console.log('READ ONLY. Review the numbers, then rerun with --apply.');
  process.exit(0);
}
if (!files.length) die('No new eligible media. Nothing was staged or pushed.');
if (git(['diff', '--cached', '--name-only'])) die('Index already has staged changes. Commit/stash those separately first (do not stash -u).');
let remoteHead;
try { remoteHead = git(['rev-parse', 'thuan/main']); }
catch { die('Run git fetch thuan first.'); }
if (git(['rev-parse', 'HEAD']) !== remoteHead) die('main is not exactly thuan/main. Run git fetch thuan && git merge --ff-only thuan/main first.');
if (existsSync(join(root, manifest)) || git(['ls-files', '--error-unmatch', manifest], { stdio: ['ignore','pipe','ignore'] })) {
  die('Manifest already exists. Stop rather than overwrite an existing baseline.');
}
const payload = {
  schema: 1,
  description: 'Original Windows Patch 01 new media; CI verifies all paths and SHA256 before Pages deployment.',
  fileCount: files.length,
  files,
};
writeFileSync(join(root, manifest), JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
try {
  // Small argv batches avoid Windows process command-line limits.
  for (let i = 0; i < candidates.length; i += 30)
    git(['add', '--', ...candidates.slice(i, i + 30)]);
  git(['add', '--', manifest]);
  const staged = git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
  if (staged.length !== files.length + 1 ||
      staged.some(p => p !== manifest && !mediaPath(p)) ||
      !staged.includes(manifest)) die('Unexpected staged file. No commit or push performed.');
  console.log('Validated staged files: ' + staged.length);
  console.log('Committing local Patch 01 media + integrity manifest ...');
  console.log(git(['commit', '-m', 'Import Patch 01 media and SHA256 baseline for automatic Cloudflare Pages builds']));
  console.log('Pushing fast-forward (no --force) ...');
  console.log(git(['push', 'thuan', 'HEAD:main']));
  console.log('PUSH OK. GitHub main has the media and manifest.');
} catch (e) {
  console.error('Upload interrupted. Local files are untouched. Inspect git status; do NOT use git clean/reset --hard.');
  console.error(String(e.stderr || e.message || e));
  process.exit(1);
}
