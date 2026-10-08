'use strict';

// Every way an analysis can go silent. None of them may leave the panel
// saying "Đang tính…" forever, which is what a user hit in a bot game.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeContentWindow, boardHtml, loadServiceWorker } = require('./helpers');

const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the offscreen engine host with a stubbed chrome and a fake worker. */
function loadEngineHost() {
  const sent = [];
  const listeners = [];
  const posted = [];
  let workerHandle = null;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Object,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (message, callback) => {
          sent.push(message);
          if (callback) callback();
        },
        onMessage: { addListener: (fn) => listeners.push(fn) }
      }
    },
    Worker: function (url) {
      this.url = url;
      this.postMessage = (command) => posted.push(command);
      workerHandle = this;
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['src/shared/uci.js', 'src/offscreen/engine.js']) {
    const full = path.join(__dirname, '..', file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
  }

  return {
    sent,
    posted,
    deliver: (message, respond) =>
      listeners.forEach((fn) => fn(message, {}, respond || (() => {}))),
    worker: () => workerHandle,
    say: (line) => workerHandle.onmessage({ data: line })
  };
}

test('a worker that dies at boot fails the request instead of swallowing it', () => {
  const host = loadEngineHost();
  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 1, tabId: 7, fen: ITALIAN, depth: 14, lines: 4 });

  host.worker().onerror({ message: 'wasm compile failed' });

  const failure = host.sent.find((m) => m.status === 'error');
  assert.ok(failure, 'the request must be reported as failed');
  assert.strictEqual(failure.tabId, 7);
  assert.strictEqual(failure.fen, ITALIAN);
  assert.match(failure.error, /wasm compile failed/);
});

test('a later request is refused at once once the engine is known dead', () => {
  const host = loadEngineHost();
  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 1, tabId: 7, fen: ITALIAN, depth: 14, lines: 4 });
  host.worker().onerror({ message: 'boom' });
  const before = host.sent.length;

  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 2, tabId: 7, fen: ITALIAN, depth: 14, lines: 4 });

  const after = host.sent.slice(before).filter((m) => m.status === 'error');
  assert.strictEqual(after.length, 1, 'should not wait for a readiness that will not come');
  assert.strictEqual(after[0].id, 2);
});

test('a queued request is failed too, not left behind', () => {
  const host = loadEngineHost();
  host.say('uciok');
  host.say('readyok');
  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 1, tabId: 7, fen: ITALIAN, depth: 14, lines: 4 });
  // A second request while the first runs is queued behind a "stop".
  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 2, tabId: 7, fen: ITALIAN, depth: 14, lines: 4 });

  host.worker().onerror({ message: 'crashed mid-search' });

  const failedIds = host.sent.filter((m) => m.status === 'error').map((m) => m.id);
  assert.deepStrictEqual([...failedIds].sort(), [1, 2]);
});

test('the engine answers normally once it is ready', () => {
  const host = loadEngineHost();
  host.deliver({ target: 'offscreen', type: 'engine-analyze', id: 9, tabId: 3, fen: ITALIAN, depth: 14, lines: 2 });
  assert.ok(!host.sent.some((m) => m.status === 'error'), 'nothing has failed yet');

  host.say('uciok');
  host.say('readyok');
  assert.ok(host.posted.includes('position fen ' + ITALIAN), host.posted.join(' | '));

  host.say('info depth 14 multipv 1 score cp 40 nodes 100 pv g1f3 b8c6');
  host.say('bestmove g1f3');
  const done = host.sent.find((m) => m.status === 'done');
  assert.ok(done);
  assert.strictEqual(done.tabId, 3, 'the tab travels with the result');
  assert.strictEqual(done.moves[0].uci, 'g1f3');
});

test('a result still reaches its tab after the worker forgot the request', async () => {
  // What a torn-down service worker looks like: its bookkeeping is empty, and
  // only the tab echoed back on the result can say where the answer belongs.
  const { sandbox } = loadServiceWorker(async () => ({
    ok: true, status: 200, headers: { get: () => null }, json: async () => ({})
  }));
  sandbox.routeEngineResult({
    id: 999, tabId: 42, fen: ITALIAN, status: 'done', depth: 14, moves: []
  });
  assert.strictEqual(sandbox.__sentToTabs.length, 1);
  assert.strictEqual(sandbox.__sentToTabs[0].tabId, 42);
});

test('the panel gives up on a silent engine instead of calculating forever', async (t) => {
  const context = makeContentWindow(
    `<!doctype html><html><body>${boardHtml(ITALIAN)}</body></html>`,
    null,
    { url: 'https://www.chess.com/play/computer', settings: { mode: 'engine' } }
  );
  t.after(() => context.window.close());
  await wait(450);

  // The request went out and nothing ever came back.
  assert.strictEqual(context.sent.filter((m) => m.type === 'analyze').length, 1);
  assert.strictEqual(context.window.document.querySelector('.cmp-status').textContent, 'Đang tính…');

  // Rather than wait out the real 30s twice, drive the failure directly.
  context.deliver({
    type: 'analysis', fen: context.sent[0].fen, status: 'error',
    error: 'máy phân tích không phản hồi'
  });
  const text = context.window.document.querySelector('.cmp-status').textContent;
  assert.match(text, /không phản hồi/);
  assert.ok(!/Đang tính/.test(text));
});

test('a vanished offscreen document is noticed and rebuilt', async (t) => {
  const { sandbox } = loadServiceWorker(async () => ({
    ok: true, status: 200, headers: { get: () => null }, json: async () => ({})
  }));

  const first = sandbox.startAnalysis({ fen: ITALIAN, depth: 14, lines: 4 }, 1);
  sandbox.markEngineReady();
  await first;
  assert.strictEqual(sandbox.__offscreen.length, 1);

  // Chrome took the document away.
  sandbox.__offscreen.length = 0;

  const second = sandbox.startAnalysis({ fen: ITALIAN, depth: 14, lines: 4 }, 1);
  await new Promise((r) => setTimeout(r, 20));
  sandbox.markEngineReady();
  await second;
  assert.strictEqual(sandbox.__offscreen.length, 1, 'should have made a new one');
});

// --- requests arriving while the engine is still booting ---------------------
// Chess.com redraws its board several times right after load, so this is the
// ordinary case. Mishandling it is what left the panel on "Đang tính…".

const FEN_A = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const FEN_B = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

function analyze(host, id, fen) {
  host.deliver({
    target: 'offscreen', type: 'engine-analyze',
    id: id, tabId: 5, fen: fen, depth: 14, lines: 4
  });
}

test('three requests during boot produce one search, for the newest position', () => {
  const host = loadEngineHost();
  analyze(host, 1, ITALIAN);
  analyze(host, 2, FEN_A);
  analyze(host, 3, FEN_B);

  // Nothing may be sent to Stockfish before it says it is ready.
  assert.ok(!host.posted.some((c) => c.startsWith('go')), host.posted.join(' | '));

  host.say('uciok');
  host.say('readyok');

  const searches = host.posted.filter((c) => c.startsWith('position fen '));
  assert.strictEqual(searches.length, 1, host.posted.join(' | '));
  assert.strictEqual(searches[0], 'position fen ' + FEN_B);
  assert.strictEqual(host.posted.filter((c) => c.startsWith('go ')).length, 1);
});

test('the superseded requests are failed, not left waiting', () => {
  const host = loadEngineHost();
  analyze(host, 1, ITALIAN);
  analyze(host, 2, FEN_A);
  analyze(host, 3, FEN_B);

  const abandoned = host.sent.filter((m) => m.status === 'error').map((m) => m.id);
  assert.deepStrictEqual([...abandoned], [1, 2], 'each must be told, or its tab waits forever');
});

test('the result goes to the request that actually ran', () => {
  const host = loadEngineHost();
  analyze(host, 1, ITALIAN);
  analyze(host, 2, FEN_B);
  host.say('uciok');
  host.say('readyok');
  host.say('info depth 14 multipv 1 score cp 20 nodes 50 pv g1f3 b8c6');
  host.say('bestmove g1f3');

  const done = host.sent.find((m) => m.status === 'done');
  assert.strictEqual(done.id, 2);
  assert.strictEqual(done.fen, FEN_B, 'never another position than the one searched');
});

test('a new position mid-search stops the old one and starts the new', () => {
  const host = loadEngineHost();
  host.say('uciok');
  host.say('readyok');
  analyze(host, 1, ITALIAN);
  assert.strictEqual(host.posted.filter((c) => c.startsWith('go ')).length, 1);

  analyze(host, 2, FEN_B);
  assert.ok(host.posted.includes('stop'), 'must stop before starting another');
  assert.strictEqual(host.posted.filter((c) => c.startsWith('go ')).length, 1,
    'and must not fire a second go while the first search runs');

  host.say('bestmove g1f3'); // the stopped search answers
  assert.ok(host.posted.includes('position fen ' + FEN_B), host.posted.join(' | '));
  assert.strictEqual(host.posted.filter((c) => c.startsWith('go ')).length, 2);
});

test('every search still ends in a result for its own tab', () => {
  const host = loadEngineHost();
  host.say('uciok');
  host.say('readyok');
  analyze(host, 1, ITALIAN);
  analyze(host, 2, FEN_B);
  host.say('bestmove g1f3');
  host.say('info depth 14 multipv 1 score cp 15 nodes 80 pv b1c3 b8c6');
  host.say('bestmove b1c3');

  const done = host.sent.filter((m) => m.status === 'done');
  assert.strictEqual(done.length, 2);
  assert.deepStrictEqual([...done.map((m) => m.id)], [1, 2]);
  done.forEach((m) => assert.strictEqual(m.tabId, 5));
});

// --- what the panel says when a search goes quiet ----------------------------

test('a stall names the step it is stuck on', async (t) => {
  const context = makeContentWindow(
    `<!doctype html><html><body>${boardHtml(ITALIAN)}</body></html>`,
    null,
    { url: 'https://www.chess.com/play/computer', settings: { mode: 'engine' } }
  );
  t.after(() => context.window.close());
  await wait(450);

  const describe = context.window.CMPStall.describe;
  assert.match(describe(null), /không hỏi được/);
  assert.match(describe({ document: false }), /offscreen document/);
  assert.match(describe({ document: true, replied: false }), /không trả lời/);
  assert.match(describe({ document: true, replied: true, bootError: 'wasm failed' }), /wasm failed/);
  assert.match(describe({ document: true, replied: true, worker: false }), /Web Worker/);
  assert.match(
    describe({ document: true, replied: true, worker: true, uciok: false, lastLine: 'abort()' }),
    /chưa nạp xong.*abort\(\)/);
  assert.match(
    describe({ document: true, replied: true, worker: true, uciok: true, ready: false }),
    /readyok/);
  assert.match(
    describe({ document: true, replied: true, worker: true, uciok: true, ready: true, searching: 'x' }),
    /không gửi kết quả về/);
  assert.match(
    describe({ document: true, replied: true, worker: true, uciok: true, ready: true }),
    /không nhận được yêu cầu/);
});

test('the offscreen host reports where it has got to', () => {
  const host = loadEngineHost();
  let status = null;
  // The host boots Stockfish as soon as it loads, so the first request does
  // not also pay for compiling the WASM.
  host.deliver({ target: 'offscreen', type: 'engine-status' }, (report) => { status = report; });
  assert.strictEqual(status.worker, true, 'warmed up at load');
  assert.strictEqual(status.ready, false, 'but not ready yet');

  analyze(host, 1, ITALIAN);
  host.deliver({ target: 'offscreen', type: 'engine-status' }, (report) => { status = report; });
  assert.strictEqual(status.uciok, false);
  assert.strictEqual(status.queued, ITALIAN, 'waiting on the engine, not lost');

  host.say('uciok');
  host.say('readyok');
  host.deliver({ target: 'offscreen', type: 'engine-status' }, (report) => { status = report; });
  assert.strictEqual(status.ready, true);
  assert.strictEqual(status.searching, ITALIAN);
  assert.match(status.lastLine, /readyok/);
});
