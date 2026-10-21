#!/usr/bin/env node
// CI gate: full Patch 01 SHA256 baseline, not just a few example filenames.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'docs/PATCH01-MEDIA-MANIFEST.json');
const artifact = resolve(root, process.argv[2] || 'patch02-test-out');
function fail(reason) { console.error('::error::' + reason); process.exit(1); }
if (!existsSync(file)) fail('Missing media manifest. Run tools/sync-patch01-media.mjs on original Windows PC.');
let manifest;
try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('Invalid media manifest.'); }
if (manifest.schema !== 1 || !Array.isArray(manifest.files) ||
    manifest.files.length !== manifest.fileCount || manifest.files.length < 1000) {
  fail('Incomplete Patch 01 media manifest: expected a full media baseline.');
}
const roots = new Set(['img', 'fx', 'snd', 'music', 'ui', 'fonts']);
const extensions = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.mp3',
  '.ogg', '.wav', '.m4a', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf', '.ico']);
const seen = new Set();
let verifiedBytes = 0;
for (const item of manifest.files) {
  const path = item.path;
  if (typeof path !== 'string' || !path.startsWith('game/') ||
      !roots.has(path.split('/')[1]) ||
      !extensions.has(extname(path).toLowerCase()) ||
      path.split('/').includes('..') || seen.has(path)) fail('Invalid/duplicate manifest path.');
  seen.add(path);
  const name = resolve(artifact, path.slice('game/'.length));
  if (!name.startsWith(artifact + sep) || !existsSync(name)) fail('Missing media: ' + path);
  const st = lstatSync(name);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== item.bytes) fail('Media invalid/size mismatch: ' + path);
  const hash = createHash('sha256').update(readFileSync(name)).digest('hex');
  if (hash !== item.sha256) fail('Media SHA256 mismatch: ' + path);
  verifiedBytes += st.size;
}
console.log('Patch 01 media integrity OK:', seen.size, 'files,', verifiedBytes, 'bytes');
