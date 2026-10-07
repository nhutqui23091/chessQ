'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeContentWindow, boardHtml, moveListHtml } = require('./helpers');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const DATA = {
  total: 1000,
  played: 1000,
  white: 500,
  draws: 300,
  black: 200,
  opening: { eco: 'B00', name: 'King\'s Pawn' },
  moves: [
    { uci: 'e2e4', san: 'e4', white: 300, draws: 100, black: 100, total: 600, share: 60 },
    { uci: 'd2d4', san: 'd4', white: 200, draws: 200, black: 0, total: 400, share: 40 }
  ]
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boot(t, bodyHtml) {
  const context = makeContentWindow(
    `<!doctype html><html><body>${bodyHtml}</body></html>`, DATA
  );
  t.after(() => context.window.close());
  return context;
}

test('looks up the position on the board and renders it', async (t) => {
  const { window, sent } = boot(t, boardHtml(START_FEN));
  await wait(450);

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, 'explorer');
  assert.strictEqual(sent[0].fen, START_FEN);
  assert.strictEqual(sent[0].settings.database, 'lichess');

  const rows = window.document.querySelectorAll('.cmp-row:not(.cmp-row-head)');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].querySelector('.cmp-c-san').textContent, 'e4');
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 2);
});

test('asks again only when the position actually changes', async (t) => {
  const { window, sent } = boot(t, boardHtml(START_FEN));
  await wait(450);
  assert.strictEqual(sent.length, 1);

  // A re-render that leaves the position alone must not trigger a lookup.
  const board = window.document.querySelector('wc-chess-board');
  board.appendChild(window.document.createElement('div'));
  await wait(450);
  assert.strictEqual(sent.length, 1);

  // Playing 1.e4 must.
  board.innerHTML = boardHtml('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    .replace(/^<wc-chess-board[^>]*>|<\/wc-chess-board>$/g, '');
  await wait(450);
  assert.strictEqual(sent.length, 2);
  assert.match(sent[1].fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3/);
});

test('follows the move list when the user scrolls back', async (t) => {
  // No white pawn can take on c6, so the ep square is omitted — same
  // normalisation Lichess applies when it keys positions.
  const after = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const { sent } = boot(t, boardHtml(after) + moveListHtml(['e4', 'c5'], 2));
  await wait(450);
  assert.strictEqual(sent[0].fen, after);
});

test('toggling from the toolbar hides and restores the panel', async (t) => {
  const { window, messageListeners, stored } = boot(t, boardHtml(START_FEN));
  await wait(450);
  const panel = window.document.querySelector('.cmp-panel');
  assert.ok(!panel.classList.contains('cmp-hidden'));

  const toggle = () => messageListeners.forEach((fn) => fn({ type: 'toggle-panel' }, {}, () => {}));
  toggle();
  assert.ok(panel.classList.contains('cmp-hidden'));
  assert.strictEqual(stored.showPanel, false);

  toggle();
  assert.ok(!panel.classList.contains('cmp-hidden'));
  assert.strictEqual(stored.showPanel, true);
});

test('stays out of the way on pages that have no board', async (t) => {
  const context = makeContentWindow(
    '<!doctype html><html><body><div>chess.com home page</div></body></html>',
    DATA, { url: 'https://www.chess.com/' }
  );
  t.after(() => context.window.close());
  await wait(450);
  assert.strictEqual(context.sent.length, 0);
  assert.ok(context.window.document.querySelector('.cmp-panel').classList.contains('cmp-boardless'));
  assert.strictEqual(context.window.document.querySelector('.cmp-diagnosis').style.display, 'none');
});

test('reports what it saw when a game page has no readable board', async (t) => {
  // A game page whose board markup the extension cannot read: the panel has to
  // stay visible and say so, otherwise the user sees nothing at all.
  const { window, sent } = boot(t, '<div class="board-wrapper">new markup</div>');
  await wait(450);
  assert.strictEqual(sent.length, 0);
  const panel = window.document.querySelector('.cmp-panel');
  assert.ok(!panel.classList.contains('cmp-boardless'), 'panel must stay visible');
  const diagnosis = window.document.querySelector('.cmp-diagnosis');
  assert.strictEqual(diagnosis.style.display, '');
  assert.match(diagnosis.textContent, /Không đọc được bàn cờ/);
  assert.match(diagnosis.textContent, /quân cờ tìm thấy: 0/);
  assert.match(diagnosis.textContent, /\/play\/online/);
  assert.ok(window.document.querySelector('.cmp-diag-copy'));
});

test('changing a filter re-queries the same position', async (t) => {
  const { window, sent } = boot(t, boardHtml(START_FEN));
  await wait(450);
  assert.strictEqual(sent.length, 1);

  const select = window.document.querySelector('.cmp-db');
  select.value = 'masters';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(450);

  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[1].settings.database, 'masters');
  assert.strictEqual(sent[1].fen, START_FEN);
});

test('the toolbar toggle shows the panel even where there is no board', async (t) => {
  const context = makeContentWindow(
    '<!doctype html><html><body><div>chess.com home page</div></body></html>',
    DATA, { url: 'https://www.chess.com/' }
  );
  t.after(() => context.window.close());
  await wait(450);
  const panel = context.window.document.querySelector('.cmp-panel');
  assert.ok(panel.classList.contains('cmp-boardless'));

  // Clicking the extension icon must do something visible, not nothing.
  context.messageListeners.forEach((fn) => fn({ type: 'toggle-panel' }, {}, () => {}));
  assert.ok(!panel.classList.contains('cmp-boardless'));
  assert.match(context.window.document.querySelector('.cmp-status').textContent, /Mở một ván cờ/);
});
