'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadServiceWorker } = require('./helpers');

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SAMPLE = {
  white: 600,
  draws: 200,
  black: 200,
  opening: { eco: 'B20', name: 'Sicilian Defense' },
  moves: [
    { uci: 'e2e4', san: 'e4', white: 300, draws: 100, black: 100, averageRating: 1750 },
    { uci: 'd2d4', san: 'd4', white: 150, draws: 50, black: 50 }
  ]
};

function jsonResponse(body, status) {
  return {
    ok: (status || 200) < 400,
    status: status || 200,
    headers: { get: () => null },
    json: async () => body
  };
}

function settings(patch) {
  return Object.assign({ database: 'lichess', speeds: ['blitz'], ratings: [1600, 1800] }, patch);
}

test('builds a Lichess-players query with the chosen filters', () => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const url = new URL(sandbox.buildUrl(FEN, settings()));
  assert.strictEqual(url.origin + url.pathname, 'https://explorer.lichess.ovh/lichess');
  assert.strictEqual(url.searchParams.get('fen'), FEN);
  assert.strictEqual(url.searchParams.get('speeds'), 'blitz');
  assert.strictEqual(url.searchParams.get('ratings'), '1600,1800');
  assert.strictEqual(url.searchParams.get('variant'), 'standard');
});

test('omits speed and rating filters for the masters database', () => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const url = new URL(sandbox.buildUrl(FEN, settings({ database: 'masters' })));
  assert.strictEqual(url.origin + url.pathname, 'https://explorer.lichess.ovh/masters');
  assert.strictEqual(url.searchParams.get('speeds'), null);
  assert.strictEqual(url.searchParams.get('ratings'), null);
});

test('computes each move share against the games actually played', () => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const shaped = sandbox.shape(SAMPLE);
  assert.strictEqual(shaped.total, 1000);
  assert.strictEqual(shaped.played, 750);
  assert.strictEqual(shaped.moves[0].total, 500);
  assert.ok(Math.abs(shaped.moves[0].share - 66.666) < 0.01);
  assert.ok(Math.abs(shaped.moves[1].share - 33.333) < 0.01);
  assert.strictEqual(shaped.opening.name, 'Sicilian Defense');
});

test('handles a position with no games', () => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse({}));
  const shaped = sandbox.shape({ white: 0, draws: 0, black: 0, moves: [] });
  assert.strictEqual(shaped.total, 0);
  assert.deepStrictEqual(shaped.moves, []);
  assert.strictEqual(shaped.opening, null);
});

test('serves repeat lookups from the cache', async () => {
  const { sandbox, calls } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const first = await sandbox.lookup(FEN, settings());
  const second = await sandbox.lookup(FEN, settings());
  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(calls.length, 1);
});

test('different filters are cached separately', async () => {
  const { sandbox, calls } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  await sandbox.lookup(FEN, settings());
  await sandbox.lookup(FEN, settings({ ratings: [2000] }));
  assert.strictEqual(calls.length, 2);
});

test('de-duplicates concurrent lookups for the same position', async () => {
  const { sandbox, calls } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const [a, b] = await Promise.all([
    sandbox.lookup(FEN, settings()),
    sandbox.lookup(FEN, settings())
  ]);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(calls.length, 1);
});

test('reports an error instead of throwing when the API fails', async () => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse({}, 500));
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /500/);
});

test('retries once after a rate-limit response', async () => {
  let seen = 0;
  const { sandbox, calls } = loadServiceWorker(async () => {
    seen += 1;
    if (seen === 1) {
      return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) };
    }
    return jsonResponse(SAMPLE);
  });
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 2);
});
