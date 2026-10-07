'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUci() {
  const sandbox = { console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'src/shared/uci.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.CMPUci;
}

const INFO = 'info depth 14 seldepth 20 multipv 2 score cp -32 nodes 928194 nps 732014 ' +
  'hashfull 412 tbhits 0 time 1268 pv e7e6 c2c3 d7d5 e4d5';

test('parses a multipv info line', () => {
  const info = loadUci().parseInfo(INFO);
  assert.strictEqual(info.depth, 14);
  assert.strictEqual(info.multipv, 2);
  assert.strictEqual(info.cp, -32);
  assert.strictEqual(info.mate, null);
  assert.strictEqual(info.nodes, 928194);
  assert.deepStrictEqual([...info.pv], ['e7e6', 'c2c3', 'd7d5', 'e4d5']);
});

test('parses a mate score', () => {
  const info = loadUci().parseInfo('info depth 9 multipv 1 score mate 3 nodes 100 pv d1h5 g6h5 h1h5');
  assert.strictEqual(info.mate, 3);
  assert.strictEqual(info.cp, null);
});

test('ignores info lines that carry no usable result', () => {
  const uci = loadUci();
  assert.strictEqual(uci.parseInfo('info depth 1 currmove e2e4 currmovenumber 1'), null);
  assert.strictEqual(uci.parseInfo('info string NNUE evaluation using nn-xxx.nnue'), null);
  assert.strictEqual(uci.parseInfo('info depth 12 nodes 500 nps 1000'), null); // no pv, no score
  assert.strictEqual(uci.parseInfo('bestmove e2e4'), null);
  assert.strictEqual(uci.parseInfo(''), null);
});

test('parses bestmove, including "none"', () => {
  const uci = loadUci();
  assert.strictEqual(uci.parseBestMove('bestmove e2e4 ponder e7e5'), 'e2e4');
  assert.strictEqual(uci.parseBestMove('bestmove (none)'), null);
  assert.strictEqual(uci.parseBestMove('info depth 3'), null);
});

test('a mate ranks above any centipawn score, and a quicker mate above a slower one', () => {
  const uci = loadUci();
  assert.ok(uci.scoreValue({ mate: 1, cp: null }) > uci.scoreValue({ mate: 5, cp: null }));
  assert.ok(uci.scoreValue({ mate: 5, cp: null }) > uci.scoreValue({ cp: 9000, mate: null }));
  assert.ok(uci.scoreValue({ cp: -9000, mate: null }) > uci.scoreValue({ mate: -5, cp: null }));
  // Being mated in 5 beats being mated in 1 — you survive longer.
  assert.ok(uci.scoreValue({ mate: -5, cp: null }) > uci.scoreValue({ mate: -1, cp: null }));
});

test('the collector ranks moves and measures how much each one loses', () => {
  const uci = loadUci();
  const collector = new uci.Collector(4);
  collector.add(uci.parseInfo('info depth 12 multipv 1 score cp 62 nodes 10 pv c2c3 g8f6'));
  collector.add(uci.parseInfo('info depth 12 multipv 2 score cp 52 nodes 10 pv d2d3 g8f6'));
  collector.add(uci.parseInfo('info depth 12 multipv 3 score cp -140 nodes 10 pv h2h4 g8f6'));

  const result = collector.result();
  assert.strictEqual(result.depth, 12);
  assert.deepStrictEqual([...result.moves.map((m) => m.uci)], ['c2c3', 'd2d3', 'h2h4']);
  assert.deepStrictEqual([...result.moves.map((m) => m.loss)], [0, 10, 202]);
  assert.deepStrictEqual([...result.moves.map((m) => m.best)], [true, false, false]);
});

test('deeper results replace shallower ones for the same line', () => {
  const uci = loadUci();
  const collector = new uci.Collector(2);
  collector.add(uci.parseInfo('info depth 8 multipv 1 score cp 10 nodes 5 pv e2e4'));
  collector.add(uci.parseInfo('info depth 14 multipv 1 score cp 45 nodes 90 pv d2d4'));
  assert.strictEqual(collector.result().moves[0].uci, 'd2d4');
  assert.strictEqual(collector.result().depth, 14);

  // A late line from an older, shallower search must not win.
  collector.add(uci.parseInfo('info depth 9 multipv 1 score cp -200 nodes 6 pv a2a3'));
  assert.strictEqual(collector.result().moves[0].uci, 'd2d4');
});

test('the collector keeps at most the requested number of lines', () => {
  const uci = loadUci();
  const collector = new uci.Collector(2);
  for (let i = 1; i <= 5; i++) {
    collector.add(uci.parseInfo(`info depth 10 multipv ${i} score cp ${60 - i * 10} nodes 10 pv a2a${i % 4 + 3}`));
  }
  assert.strictEqual(collector.result().moves.length, 2);
});

test('mate lines sort ahead and report loss against the fastest mate', () => {
  const uci = loadUci();
  const collector = new uci.Collector(3);
  collector.add(uci.parseInfo('info depth 10 multipv 1 score cp 900 nodes 10 pv a1a2'));
  collector.add(uci.parseInfo('info depth 10 multipv 2 score mate 2 nodes 10 pv d1h5 e8e7'));
  const moves = collector.result().moves;
  assert.strictEqual(moves[0].uci, 'd1h5');
  assert.strictEqual(moves[0].mate, 2);
  assert.ok(moves[0].best);
  assert.ok(moves[1].loss > 0);
});
