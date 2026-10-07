'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSettings() {
  const sandbox = { console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'src/shared/settings.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.CMPSettings;
}

test('normalize fills in defaults for missing keys', () => {
  const S = loadSettings();
  const out = S.normalize({ database: 'masters' });
  assert.strictEqual(out.database, 'masters');
  assert.strictEqual(out.showPanel, S.DEFAULTS.showPanel);
  assert.deepStrictEqual(out.speeds, S.DEFAULTS.speeds);
});

test('normalize rejects unknown values and wrong types', () => {
  const S = loadSettings();
  const out = S.normalize({
    database: 'nonsense',
    speeds: ['blitz', 'hyperbullet'],
    ratings: [1600, 4242, '2000'],
    showPanel: 'yes',
    badgeCount: 99
  });
  assert.strictEqual(out.database, 'lichess');
  assert.deepStrictEqual(out.speeds, ['blitz']);
  assert.deepStrictEqual(out.ratings, [1600, 2000]);
  assert.strictEqual(out.showPanel, true); // the default, not the string
  assert.strictEqual(out.badgeCount, 10);  // clamped
});

test('normalize never leaves the filters empty', () => {
  const S = loadSettings();
  const out = S.normalize({ speeds: [], ratings: [] });
  assert.deepStrictEqual(out.speeds, S.DEFAULTS.speeds);
  assert.deepStrictEqual(out.ratings, S.DEFAULTS.ratings);
});

test('normalize does not share arrays with the defaults', () => {
  const S = loadSettings();
  const out = S.normalize({});
  out.speeds.push('bullet');
  // Spread to compare contents: the module runs in its own vm realm, so its
  // arrays do not share a prototype with the ones built here.
  assert.deepStrictEqual([...S.DEFAULTS.speeds], ['blitz', 'rapid', 'classical']);
});

test('ratings are sorted so the cache key is stable', () => {
  const S = loadSettings();
  assert.deepStrictEqual(S.normalize({ ratings: [2000, 1600] }).ratings, [1600, 2000]);
});
