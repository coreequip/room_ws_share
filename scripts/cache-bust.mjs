#!/usr/bin/env node
// Appends `?v=<6-hex-digit content hash>` to every local asset reference
// (index.html links/scripts, manifest.json icon, CSS url()s, JS imports) so
// browsers only re-fetch a file once its content actually changed. Run via
// the pre-commit hook in githooks/pre-commit — no npm dependencies.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import posix from 'node:path/posix';

const ROOT = posix.normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const VERSION_RE = /\?v=[0-9a-f]{6}/g;

function hash6(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 6);
}

function listFiles(dir, ext) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => `${dir}/${f}`);
}

function resolveRef(containingRelPath, refPath) {
  if (refPath.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(containingRelPath), refPath));
  }
  return refPath;
}

function extractRefsJS(text) {
  const refs = [];
  const re = /(from\s+['"])(\.\.?\/[^'")]+\.js)(['"])/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    refs.push({ start, end: start + m[2].length, path: m[2] });
  }
  return refs;
}

function extractRefsCSS(text) {
  const refs = [];
  const re = /url\((['"]?)(?!data:)([^'")]+\.(?:woff2|woff|ttf|otf|svg))\1\)/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + 'url('.length + m[1].length;
    refs.push({ start, end: start + m[2].length, path: m[2] });
  }
  return refs;
}

function extractRefsHTML(text) {
  const refs = [];
  const re = /(href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const path = m[2];
    if (/^https?:|^\/\//.test(path)) continue;
    if (!/^(css|js)\//.test(path) && path !== 'icon.svg' && path !== 'manifest.json') continue;
    const start = m.index + m[1].length + 2;
    refs.push({ start, end: start + path.length, path });
  }
  return refs;
}

function extractRefsManifest(text) {
  const refs = [];
  const re = /("src"\s*:\s*")([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    refs.push({ start, end: start + m[2].length, path: m[2] });
  }
  return refs;
}

const managedFiles = [
  'index.html',
  'manifest.json',
  ...listFiles('css', '.css'),
  ...listFiles('js', '.js'),
];

const nodes = new Map();

for (const relPath of managedFiles) {
  const raw = readFileSync(join(ROOT, relPath), 'utf8');
  const clean = raw.replace(VERSION_RE, '');
  let refs;
  if (relPath.endsWith('.js')) refs = extractRefsJS(clean);
  else if (relPath.endsWith('.css')) refs = extractRefsCSS(clean);
  else if (relPath === 'index.html') refs = extractRefsHTML(clean);
  else refs = extractRefsManifest(clean);
  for (const ref of refs) ref.resolved = resolveRef(relPath, ref.path);
  nodes.set(relPath, { text: clean, refs, hash: null });
}

// Leaf assets referenced by managed files but not versioned themselves
// (icon.svg, font files) — read once, hashed, never rewritten.
const referenced = new Set();
for (const node of nodes.values()) for (const ref of node.refs) referenced.add(ref.resolved);
for (const target of referenced) {
  if (!nodes.has(target)) {
    nodes.set(target, { text: readFileSync(join(ROOT, target)), refs: [], hash: null });
  }
}

let progress = true;
while (progress) {
  progress = false;
  for (const node of nodes.values()) {
    if (node.hash !== null) continue;
    if (!node.refs.every((ref) => nodes.get(ref.resolved)?.hash != null)) continue;

    let out = node.text;
    for (const ref of [...node.refs].sort((a, b) => b.start - a.start)) {
      const depHash = nodes.get(ref.resolved).hash;
      out = out.slice(0, ref.end) + '?v=' + depHash + out.slice(ref.end);
    }
    node.text = out;
    node.hash = hash6(Buffer.isBuffer(out) ? out : Buffer.from(out, 'utf8'));
    progress = true;
  }
}

for (const [relPath, node] of nodes) {
  if (node.hash === null) {
    throw new Error(`cache-bust: unresolved dependency for ${relPath} (circular import?)`);
  }
}

for (const relPath of managedFiles) {
  writeFileSync(join(ROOT, relPath), nodes.get(relPath).text, 'utf8');
}

console.log(`cache-bust: refreshed version hashes for ${managedFiles.length} files`);
