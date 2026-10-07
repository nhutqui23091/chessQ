'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

test('every file referenced by the manifest exists', () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...entry.css])
  ];
  for (const file of referenced) {
    assert.ok(exists(file), `missing ${file}`);
  }
});

test('manifest version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.version, pkg.version);
});

test('declares only the permissions it uses', () => {
  assert.deepStrictEqual(manifest.permissions, ['storage', 'offscreen']);
  assert.deepStrictEqual(manifest.host_permissions, ['https://explorer.lichess.ovh/*']);
  assert.strictEqual(manifest.manifest_version, 3);
  // Stockfish is WASM, which extension pages may only run with this directive.
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
});

test('content scripts load the chess bundle before the scripts that use it', () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf('src/vendor/chess.bundle.js') < js.indexOf('src/content/position.js'));
  assert.ok(js.indexOf('src/shared/settings.js') < js.indexOf('src/content/content.js'));
  assert.ok(js.indexOf('src/content/ui.js') < js.indexOf('src/content/content.js'));
  assert.ok(js.indexOf('src/content/context.js') < js.indexOf('src/content/content.js'));
});

test('the offscreen engine page and its files are present', () => {
  for (const file of [
    'src/offscreen/engine.html',
    'src/offscreen/engine.js',
    'src/shared/uci.js',
    'src/vendor/stockfish/stockfish.wasm.js',
    'src/vendor/stockfish/stockfish.wasm',
    'src/vendor/stockfish/LICENSE-stockfish.txt'
  ]) {
    assert.ok(exists(file), `missing ${file}`);
  }
  // The offscreen page must load the parser before the driver that uses it.
  const html = fs.readFileSync(path.join(ROOT, 'src/offscreen/engine.html'), 'utf8');
  assert.ok(html.indexOf('uci.js') < html.indexOf('engine.js'));
});

test('shipping Stockfish means the project is GPL', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.license, /GPL-3.0/);
});

test('options page scripts resolve relative to the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  const sources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^https?:/.test(value));
  for (const source of sources) {
    assert.ok(exists(path.join('src/options', source)), `missing ${source}`);
  }
});
