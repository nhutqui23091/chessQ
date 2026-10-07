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

// --- engine routing ------------------------------------------------------

test('an analysis request creates the offscreen document once', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 7);
  await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 7);
  assert.strictEqual(sandbox.__offscreen.length, 1);
  assert.strictEqual(sandbox.__offscreen[0].reasons[0], 'WORKERS');
});

test('an analysis request is forwarded to the engine with its settings', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  await sandbox.startAnalysis({ fen: FEN, depth: 18, lines: 3 }, 7);
  const sent = sandbox.__sentToOffscreen[sandbox.__sentToOffscreen.length - 1];
  assert.strictEqual(sent.target, 'offscreen');
  assert.strictEqual(sent.type, 'engine-analyze');
  assert.strictEqual(sent.fen, FEN);
  assert.strictEqual(sent.depth, 18);
  assert.strictEqual(sent.lines, 3);
});

test('results are routed back to the tab that asked', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const started = await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 42);
  sandbox.routeEngineResult({
    id: started.id, fen: FEN, status: 'done', depth: 14, moves: [{ uci: 'e2e4' }]
  });
  assert.strictEqual(sandbox.__sentToTabs.length, 1);
  assert.strictEqual(sandbox.__sentToTabs[0].tabId, 42);
  assert.strictEqual(sandbox.__sentToTabs[0].message.type, 'analysis');
  assert.strictEqual(sandbox.__sentToTabs[0].message.status, 'done');
});

test('results for a superseded position are dropped', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const first = await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 42);
  await sandbox.startAnalysis({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', depth: 14, lines: 4 }, 42);
  sandbox.routeEngineResult({ id: first.id, fen: FEN, status: 'done', moves: [] });
  assert.strictEqual(sandbox.__sentToTabs.length, 0);
});

test('progress results keep streaming, final results close the request', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const started = await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 42);
  sandbox.routeEngineResult({ id: started.id, fen: FEN, status: 'progress', moves: [] });
  sandbox.routeEngineResult({ id: started.id, fen: FEN, status: 'progress', moves: [] });
  sandbox.routeEngineResult({ id: started.id, fen: FEN, status: 'done', moves: [] });
  sandbox.routeEngineResult({ id: started.id, fen: FEN, status: 'done', moves: [] });
  assert.strictEqual(sandbox.__sentToTabs.length, 3);
});

test('each tab gets its own analysis slot', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  const a = await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 1);
  const b = await sandbox.startAnalysis({ fen: FEN, depth: 14, lines: 4 }, 2);
  sandbox.routeEngineResult({ id: a.id, fen: FEN, status: 'done', moves: [] });
  sandbox.routeEngineResult({ id: b.id, fen: FEN, status: 'done', moves: [] });
  assert.deepStrictEqual(sandbox.__sentToTabs.map((entry) => entry.tabId), [1, 2]);
});

test('waits for the engine to answer before sending work', async (t) => {
  const { sandbox } = loadServiceWorker(async () => jsonResponse(SAMPLE));
  let resolved = false;
  const pending = sandbox.ensureOffscreen().then(() => { resolved = true; });

  // The document is created first, so the ping lands a few microtasks later.
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(sandbox.__sentToOffscreen.some((m) => m.type === 'engine-ping'),
    'a ping should have been sent');
  assert.strictEqual(resolved, false, 'must not proceed before the engine answers');

  sandbox.markEngineReady();
  await pending;
  assert.strictEqual(resolved, true);
});

// --- when the explorer refuses -------------------------------------------

function errorResponse(status, body, type) {
  return {
    ok: false,
    status: status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => (type === 'json' ? JSON.parse(body) : {})
  };
}

test('the reason the server gave is kept, not just the status', async (t) => {
  const { sandbox } = loadServiceWorker(async () =>
    errorResponse(401, '{"error":"token required"}'));
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /401/);
  assert.match(result.error, /token required/);
});

test('an HTML error page is reduced to its text', async (t) => {
  const { sandbox } = loadServiceWorker(async () =>
    errorResponse(403, '<html><body><h1>Forbidden</h1><p>blocked by proxy</p></body></html>'));
  const result = await sandbox.lookup(FEN, settings());
  assert.match(result.error, /Forbidden blocked by proxy/);
  assert.ok(!/</.test(result.error), result.error);
});

test('a refused query is retried without its filters', async (t) => {
  let seen = 0;
  const { sandbox, calls } = loadServiceWorker(async (url) => {
    seen += 1;
    // The filtered query is refused; the bare one is served.
    return url.includes('ratings=')
      ? errorResponse(401, 'nope')
      : jsonResponse(SAMPLE);
  });
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, true, 'should fall back rather than fail');
  assert.strictEqual(result.degraded, true);
  assert.match(result.reason, /401/);
  assert.strictEqual(calls.length, 2);
  assert.ok(!calls[1].includes('ratings='), calls[1]);
  assert.ok(calls[1].includes('fen='));
});

test('both failing is reported with both reasons', async (t) => {
  const { sandbox } = loadServiceWorker(async () => errorResponse(401, 'nope'));
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /401/);
  assert.match(result.alsoFailed, /401/);
});

test('a server error is not retried bare — it is not the query at fault', async (t) => {
  const { sandbox, calls } = loadServiceWorker(async () => errorResponse(500, 'boom'));
  const result = await sandbox.lookup(FEN, settings());
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /500/);
  assert.strictEqual(calls.length, 1, 'one attempt, no bare retry');
  assert.ok(!result.alsoFailed);
});

test('the masters database gets the same second chance', async (t) => {
  const { sandbox, calls } = loadServiceWorker(async (url) =>
    url.includes('moves=') ? errorResponse(401, 'nope') : jsonResponse(SAMPLE));
  const result = await sandbox.lookup(FEN, settings({ database: 'masters' }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.degraded, true);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1].includes('/masters?fen='), calls[1]);
});
