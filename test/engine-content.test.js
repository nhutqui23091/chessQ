'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeContentWindow, boardHtml } = require('./helpers');

// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 — white to move.
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boot(t, url, bodyHtml) {
  const context = makeContentWindow(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
    null,
    { url: url, settings: { mode: 'engine' } }
  );
  t.after(() => context.window.close());
  return context;
}

test('asks the engine for the position on the analysis board', async (t) => {
  const { sent } = boot(t, 'https://www.chess.com/analysis', boardHtml(ITALIAN));
  await wait(450);
  const analyze = sent.filter((m) => m.type === 'analyze');
  assert.strictEqual(analyze.length, 1);
  assert.strictEqual(analyze[0].fen.split(' ')[0], ITALIAN.split(' ')[0]);
  assert.strictEqual(analyze[0].depth, 14);
  assert.strictEqual(analyze[0].lines, 4);
  // The opening explorer is not queried in engine mode.
  assert.strictEqual(sent.filter((m) => m.type === 'explorer').length, 0);
});

test('analyses live while practising against a bot', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/play/computer',
    boardHtml(ITALIAN) + '<button data-cy="resign-button">Resign</button>');
  await wait(450);
  const analyze = sent.filter((m) => m.type === 'analyze');
  assert.strictEqual(analyze.length, 1);
  assert.strictEqual(analyze[0].fen.split(' ')[0], ITALIAN.split(' ')[0]);
  // It is searching, not refusing.
  assert.strictEqual(window.document.querySelector('.cmp-status').textContent, 'Đang tính…');
});

test('never asks the engine while a game against a person is running', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/play/online', boardHtml(ITALIAN));
  await wait(450);
  assert.strictEqual(sent.filter((m) => m.type === 'analyze').length, 0);
  assert.match(window.document.querySelector('.cmp-status').textContent, /Ván đang diễn ra/);
});

test('analyses that same game the moment it is over', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/play/online',
    boardHtml(ITALIAN) + '<div class="game-over-modal-content">Bạn thắng</div>');
  await wait(450);
  assert.strictEqual(sent.filter((m) => m.type === 'analyze').length, 1);
  assert.strictEqual(window.document.querySelector('.cmp-status').textContent, 'Đang tính…');
});

test('refuses even on /analysis while a game is still running', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/analysis',
    boardHtml(ITALIAN) + '<button data-cy="resign-button">Resign</button>');
  await wait(450);
  assert.strictEqual(sent.filter((m) => m.type === 'analyze').length, 0);
  assert.match(window.document.querySelector('.cmp-status').textContent, /Ván đang diễn ra/);
});

test('renders streamed engine results and converts them to SAN', async (t) => {
  const { window, sent, deliver } = boot(t, 'https://www.chess.com/analysis', boardHtml(ITALIAN));
  await wait(450);
  const fen = sent.find((m) => m.type === 'analyze').fen;

  deliver({
    type: 'analysis',
    fen: fen,
    status: 'done',
    depth: 14,
    moves: [
      { uci: 'c2c3', cp: 62, mate: null, loss: 0, best: true, pv: ['c2c3', 'g8f6', 'd2d4'] },
      { uci: 'b1c3', cp: 47, mate: null, loss: 15, best: false, pv: ['b1c3', 'g8f6'] }
    ]
  });

  const rows = window.document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head)');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].querySelector('.cmp-c-san').textContent, 'c3');
  assert.strictEqual(rows[1].querySelector('.cmp-c-san').textContent, 'Nc3');
  // The principal variation is shown in SAN too.
  assert.match(rows[0].querySelector('.cmp-c-pv').textContent, /c3 Nf6 d4/);
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 2);
});

test('ignores engine results for a position already left behind', async (t) => {
  const { window, deliver } = boot(t, 'https://www.chess.com/analysis', boardHtml(ITALIAN));
  await wait(450);
  deliver({
    type: 'analysis',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status: 'done',
    depth: 14,
    moves: [{ uci: 'e2e4', cp: 30, mate: null, loss: 0, best: true, pv: ['e2e4'] }]
  });
  assert.strictEqual(window.document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head)').length, 0);
});

test('switching to explorer mode stops the engine and queries the API', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/analysis', boardHtml(ITALIAN));
  await wait(450);
  assert.strictEqual(sent.filter((m) => m.type === 'analyze').length, 1);

  const explorerButton = window.document.querySelector('.cmp-mode[data-mode="explorer"]');
  explorerButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(450);

  assert.strictEqual(sent.filter((m) => m.type === 'analyze-stop').length, 1);
  assert.strictEqual(sent.filter((m) => m.type === 'explorer').length, 1);
});

test('a deeper setting re-runs the analysis', async (t) => {
  const { window, sent } = boot(t, 'https://www.chess.com/analysis', boardHtml(ITALIAN));
  await wait(450);
  const slider = window.document.querySelector('.cmp-settings input[type="range"]');
  slider.value = '20';
  slider.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(450);

  const analyze = sent.filter((m) => m.type === 'analyze');
  assert.strictEqual(analyze.length, 2);
  assert.strictEqual(analyze[1].depth, 20);
});

test('the engine switches itself on when the game ends, with no move played', async (t) => {
  // A game ending moves no piece, so nothing about the position changes. The
  // engine has to notice the page changed instead.
  const { window, sent } = boot(t, 'https://www.chess.com/play/online',
    boardHtml(ITALIAN) + '<button data-cy="resign-button">Đầu hàng</button>');
  await wait(450);
  assert.strictEqual(sent.filter((m) => m.type === 'analyze').length, 0);
  assert.match(window.document.querySelector('.cmp-status').textContent, /Ván đang diễn ra/);

  // The game ends: controls go, a result appears.
  window.document.querySelector('[data-cy="resign-button"]').remove();
  const over = window.document.createElement('div');
  over.className = 'game-over-modal-content';
  over.textContent = 'Trắng thắng';
  window.document.body.appendChild(over);
  await wait(1200);

  const analyze = sent.filter((m) => m.type === 'analyze');
  assert.strictEqual(analyze.length, 1, 'should analyse the finished game');
  assert.strictEqual(analyze[0].fen.split(' ')[0], ITALIAN.split(' ')[0]);
});
