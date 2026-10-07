'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeWindow, boardHtml, moveListHtml } = require('./helpers');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function read(html) {
  const window = makeWindow(`<!doctype html><html><body>${html}</body></html>`);
  return { window, position: window.CMPPosition.readPosition() };
}

test('reads the starting position', () => {
  const { position } = read(boardHtml(START));
  assert.ok(position);
  assert.strictEqual(position.fen.split(' ')[0], START.split(' ')[0]);
  assert.strictEqual(position.turn, 'w');
});

test('replays the move list for an exact FEN', () => {
  const after = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
  const { position } = read(boardHtml(after) + moveListHtml(['e4', 'c5', 'Nf3'], 3));
  assert.strictEqual(position.source, 'move-list');
  assert.strictEqual(position.fen, after);
  assert.strictEqual(position.ply, 3);
});

test('honours the selected move when the user scrolls back', () => {
  // Board shows the position after 1.e4 while the list holds three moves.
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const { position } = read(boardHtml(afterE4) + moveListHtml(['e4', 'c5', 'Nf3'], 1));
  assert.strictEqual(position.source, 'move-list');
  assert.strictEqual(position.turn, 'b');
  assert.strictEqual(position.fen.split(' ')[0], afterE4.split(' ')[0]);
});

test('falls back to the board scan when the move list does not match', () => {
  // A puzzle: pieces on the board, but the move list belongs to another game.
  const puzzle = '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1';
  const { position } = read(boardHtml(puzzle) + moveListHtml(['e4', 'e5'], 2));
  assert.strictEqual(position.source, 'board-scan');
  assert.strictEqual(position.fen, '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1');
});

test('infers side to move from the last-move highlight', () => {
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const { position } = read(boardHtml(afterE4, { highlights: ['e2', 'e4'] }));
  assert.strictEqual(position.source, 'board-scan');
  assert.strictEqual(position.turn, 'b');
});

test('ignores hand-marked squares when inferring side to move', () => {
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const { position } = read(boardHtml(afterE4, { highlights: ['e2', 'e4', 'a1'] }));
  assert.strictEqual(position.turn, 'w'); // no reliable signal -> default
});

test('sets the en passant square only when a pawn can capture', () => {
  const capturable = 'rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
  const withEp = read(boardHtml(capturable, { highlights: ['d2', 'd4'] })).position;
  assert.strictEqual(withEp.fen.split(' ')[3], 'd3');

  const lonely = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
  const noEp = read(boardHtml(lonely, { highlights: ['d2', 'd4'] })).position;
  assert.strictEqual(noEp.fen.split(' ')[3], '-');
});

test('derives castling rights from king and rook placement', () => {
  const moved = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1RK1 w kq - 0 1';
  const { position } = read(boardHtml(moved));
  assert.strictEqual(position.fen.split(' ')[2], 'kq');

  const bare = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  assert.strictEqual(read(boardHtml(bare)).position.fen.split(' ')[2], 'Q');
});

test('detects a flipped board', () => {
  assert.strictEqual(read(boardHtml(START, { flipped: true })).position.flipped, true);
  assert.strictEqual(read(boardHtml(START)).position.flipped, false);
});

test('skips pieces that are being dragged', () => {
  const html = boardHtml(START).replace('<div class="piece wp square-52"></div>',
    '<div class="piece wp square-52 dragging"></div>');
  const { position } = read(html);
  assert.strictEqual(position.fen.split(' ')[0], 'rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR');
});

test('returns null when there is no board', () => {
  assert.strictEqual(read('<div>no chess here</div>').position, null);
});

test('reads figurine move lists', () => {
  const after = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
  const list = '<wc-simple-move-list class="move-list">' +
    '<div class="node selected" data-ply="1">' +
    '<span class="icon-font-chess knight-white"></span>f3</div>' +
    '</wc-simple-move-list>';
  const { position } = read(boardHtml(after) + list);
  assert.strictEqual(position.source, 'move-list');
  assert.strictEqual(position.fen, after);
});

test('cleanSan strips annotations and normalises castling', () => {
  const { window } = read(boardHtml(START));
  const cleanSan = window.CMPPosition.cleanSan;
  assert.strictEqual(cleanSan('Nf3!?'), 'Nf3');
  assert.strictEqual(cleanSan('0-0-0'), 'O-O-O');
  assert.strictEqual(cleanSan(' exd5+ '), 'exd5');
  assert.strictEqual(cleanSan('12.e4'), 'e4');
  assert.strictEqual(cleanSan('♘f3'), 'Nf3');
});

// --- resilience to Chess.com renaming things ---------------------------------

test('finds the board from the pieces when no known selector matches', () => {
  // Same pieces, a container this extension has never heard of.
  const html = boardHtml(START)
    .replace('<wc-chess-board class="board" data-size="480">', '<div class="brand-new-board" data-size="480">')
    .replace('</wc-chess-board>', '</div>');
  const { position } = read(html);
  assert.ok(position, 'should still read the position');
  assert.strictEqual(position.fen.split(' ')[0], START.split(' ')[0]);
  assert.strictEqual(position.board.className, 'brand-new-board');
});

test('reads pieces that live inside a shadow root', () => {
  const window = makeWindow('<!doctype html><html><body><div id="host"></div></body></html>');
  const host = window.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = boardHtml(START);
  // The board element inside the shadow root needs a size like any other.
  const position = window.CMPPosition.readPosition();
  assert.ok(position, 'should see through the shadow root');
  assert.strictEqual(position.fen.split(' ')[0], START.split(' ')[0]);
});

test('diagnose reports what it can see', () => {
  const { window } = read(boardHtml(START));
  const info = window.CMPPosition.diagnose();
  assert.strictEqual(info.pieces, 32);
  assert.ok(info.board);
  assert.ok(Array.isArray(info.selectors));

  const empty = makeWindow('<!doctype html><html><body><div>nothing</div></body></html>');
  const none = empty.CMPPosition.diagnose();
  assert.strictEqual(none.board, null);
  assert.strictEqual(none.pieces, 0);
});
