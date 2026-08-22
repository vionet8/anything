#!/usr/bin/env node
/**
 * Build the single-file artifact from src/main.js.
 *
 * artifact-build/entry.js used to be a hand-maintained copy of src/main.js
 * differing in eight small ways, which meant every gameplay change had to be
 * written twice and stayed correct only as long as nobody forgot. It is
 * generated here instead: the eight differences are spelled out as explicit
 * source rewrites, and the build fails loudly if any of them stops matching
 * rather than quietly emitting a half-patched file.
 *
 * Usage:  node tools/build_artifact.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = dirname(dirname(fileURLToPath(import.meta.url)));
const p = (...parts) => join(PROJECT, ...parts);

// Each entry is [description, find, replace]. `find` is a plain string so the
// whole thing stays readable as "this line becomes that line".
const REWRITES = [
  [
    'render into the template\'s canvas rather than appending one',
    "const renderer = new THREE.WebGLRenderer({ antialias: true });",
    "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });",
  ],
  [
    'grab that canvas up front',
    "const scene = new THREE.Scene();",
    "const canvas = document.getElementById('scene');\nconst scene = new THREE.Scene();",
  ],
  [
    'drop the appendChild the dev page needs',
    "document.body.appendChild(renderer.domElement);\n",
    '',
  ],
  [
    'the artifact HUD uses different element ids',
    "const stateLabel = document.getElementById('anim-state');",
    "const stateLabel = document.getElementById('state-label');\nconst loadingEl = document.getElementById('loading');",
  ],
  [
    'and shows the bare state name, not a "state: " prefix',
    "stateLabel.textContent = 'state: ' + name;",
    "stateLabel.textContent = name;",
  ],
  [
    'the model is inlined as base64 instead of fetched',
    "const loader = new GLTFLoader();",
    `function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const loader = new GLTFLoader();`,
  ],
  [
    'so it is parsed, not loaded from a URL',
    "loader.load(\n  'assets/girl.vrm',",
    "const modelBuffer = base64ToArrayBuffer(window.__MODEL_BASE64__);\n\nloader.parse(\n  modelBuffer,\n  '',",
  ],
  [
    // entry.js is generated into artifact-build/, one directory over from the
    // source it is generated from, so main.js's sibling imports have to be
    // re-pointed at src/.
    'the generated entry sits beside the bundle, not beside its source',
    "from './game.js'",
    "from '../src/game.js'",
  ],
  [
    'clear the loading overlay on success',
    "    window.__char.ready = true;\n",
    "    window.__char.ready = true;\n    if (loadingEl) loadingEl.style.display = 'none';\n",
  ],
  [
    // loader.parse takes (data, path, onLoad, onError) — one argument fewer
    // than loader.load, so the progress slot the dev page passes has to go or
    // the error handler lands in it and never fires.
    'drop the progress-callback slot loader.parse does not have',
    "  },\n  undefined,\n  (err) => {",
    "  },\n  (err) => {",
  ],
  [
    'and report failure in it',
    "    console.error('Failed to load VRM character', err);",
    "    console.error('Failed to load VRM character', err);\n    if (loadingEl) loadingEl.textContent = 'モデルの読み込みに失敗しました';",
  ],
];

function generateEntry() {
  let source = readFileSync(p('src', 'main.js'), 'utf8');
  for (const [description, find, replace] of REWRITES) {
    if (!source.includes(find)) {
      throw new Error(
        `artifact rewrite no longer matches src/main.js: ${description}\n` +
        `  looked for: ${JSON.stringify(find.slice(0, 80))}`
      );
    }
    source = source.replace(find, replace);
  }
  writeFileSync(p('artifact-build', 'entry.js'), source);
}

function bundle() {
  execFileSync('npx', [
    '--no-install', 'esbuild',
    p('artifact-build', 'entry.js'),
    '--bundle',
    '--format=iife',
    '--legal-comments=eof',
    `--outfile=${p('artifact-build', 'bundle.js')}`,
  ], { cwd: PROJECT, stdio: 'inherit' });
}

function assemble() {
  const model = readFileSync(p('assets', 'girl.vrm')).toString('base64');
  writeFileSync(p('artifact-build', 'model.b64'), model);

  const template = readFileSync(p('artifact-build', 'template.html'), 'utf8');
  const bundleJs = readFileSync(p('artifact-build', 'bundle.js'), 'utf8');

  for (const placeholder of ['__MODEL_BASE64_PLACEHOLDER__', '__BUNDLE_JS_PLACEHOLDER__']) {
    if (!template.includes(placeholder)) throw new Error(`template.html lost ${placeholder}`);
  }

  // Substituted via a function so a "$&" or "$1" happening to appear in the
  // bundle or the base64 is not treated as a replacement pattern.
  const html = template
    .replace('__MODEL_BASE64_PLACEHOLDER__', () => model)
    .replace('__BUNDLE_JS_PLACEHOLDER__', () => bundleJs);

  writeFileSync(p('artifact-build', 'artifact.html'), html);
  return html.length;
}

generateEntry();
bundle();
const size = assemble();
console.log(`artifact.html: ${(size / 1048576).toFixed(2)}MB`);
if (size > 16 * 1048576) {
  console.error('OVER the 16MB artifact limit');
  process.exit(1);
}
