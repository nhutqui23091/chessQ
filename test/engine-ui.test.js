'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeUiWindow, boardHtml } = require('./helpers');

const FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

const ENGINE = {
  status: 'ready',
  depth: 14,
  nodes: 1320495,
  moves: [
    { uci: 'c2c3', san: 'c3', cp: 62, mate: null, loss: 0, best: true, pvSan: ['c3', 'Nf6', 'd4'] },
    { uci: 'd2d3', san: 'd3', cp: 52, mate: null, loss: 10, best: false, pvSan: ['d3', 'Nf6'] },
    { uci: 'b1d2', san: 'Nbd2', cp: 47, mate: null, loss: 15, best: false, pvSan: ['Nbd2', 'Nf6'] },
    { uci: 'h2h4', san: 'h4', cp: -140, mate: null, loss: 202, best: false, pvSan: ['h4', 'Nf6'] }
  ]
};

function setup(t, engine, settingsPatch) {
  const window = makeUiWindow(`<!doctype html><html><body>${boardHtml(FEN)}</body></html>`);
  const changes = [];
  const ui = new window.CMPUI({ onSettingsChange: (patch) => changes.push(patch) });
  ui.setSettings(window.CMPSettings.normalize(
    Object.assign({ mode: 'engine' }, settingsPatch || {})
  ));
  ui.setState({
    status: 'idle',
    data: null,
    position: { board: window.document.querySelector('wc-chess-board'), flipped: false, turn: 'w' },
    engine: engine
  });
  t.after(() => { ui.destroy(); window.close(); });
  return { window, ui, changes };
}

test('lists the engine moves best first with their scores', (t) => {
  const { window } = setup(t, ENGINE);
  const rows = window.document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head)');
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].querySelector('.cmp-c-san').textContent, 'c3');
  assert.strictEqual(rows[2].querySelector('.cmp-c-san').textContent, 'Nbd2');
  assert.strictEqual(rows[0].querySelector('.cmp-eval').textContent, '+0.6');
  assert.strictEqual(rows[3].querySelector('.cmp-eval').textContent, '-1.4');
  assert.match(rows[0].querySelector('.cmp-c-pv').textContent, /c3 Nf6 d4/);
});

test('colours each move by how far behind the best one it is', (t) => {
  const { window } = setup(t, ENGINE);
  const chips = window.document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head) .cmp-eval');
  assert.ok(chips[0].classList.contains('cmp-eval-best'));   // loss 0
  assert.ok(chips[1].classList.contains('cmp-eval-good'));   // loss 10
  assert.ok(chips[2].classList.contains('cmp-eval-good'));   // loss 15
  assert.ok(chips[3].classList.contains('cmp-eval-blunder')); // loss 202
});

test('puts a score badge on each candidate square', (t) => {
  const { window } = setup(t, ENGINE);
  const badges = window.document.querySelectorAll('.cmp-badge');
  assert.strictEqual(badges.length, 4);
  // c2c3 -> c3 is file c (col 2), rank 3 (row 5 from the top)
  assert.strictEqual(badges[0].style.left, 'calc(var(--cmp-square, 48px) * 2)');
  assert.strictEqual(badges[0].style.top, 'calc(var(--cmp-square, 48px) * 5)');
  assert.strictEqual(badges[0].textContent, '+0.6');
  assert.ok(badges[0].classList.contains('cmp-eval-best'));
});

test('spreads badges out when two moves share a destination', (t) => {
  const engine = Object.assign({}, ENGINE, {
    moves: [
      { uci: 'b1d2', san: 'Nbd2', cp: 30, mate: null, loss: 0, best: true, pvSan: ['Nbd2'] },
      { uci: 'f3d2', san: 'Nfd2', cp: 5, mate: null, loss: 25, best: false, pvSan: ['Nfd2'] }
    ]
  });
  const { window } = setup(t, engine);
  const badges = window.document.querySelectorAll('.cmp-badge');
  assert.strictEqual(badges.length, 2);
  // Same square, so both move off the centre line, in opposite directions...
  assert.match(badges[0].style.transform, /translateY\(-26%\)/);
  assert.match(badges[1].style.transform, /translateY\(26%\)/);
  // ...and each names its own move, since the square alone no longer tells them apart.
  assert.strictEqual(badges[0].textContent, 'Nbd2 +0.3');
  assert.strictEqual(badges[1].textContent, 'Nfd2 +0.1');
  assert.ok(badges[0].classList.contains('cmp-badge-stacked'));
});

test('a badge on an uncontested square shows the score alone', (t) => {
  const { window } = setup(t, ENGINE);
  const badges = window.document.querySelectorAll('.cmp-badge');
  badges.forEach((badge) => {
    assert.strictEqual(badge.style.transform, '');
    assert.ok(!badge.classList.contains('cmp-badge-stacked'));
  });
});

test('shows mate scores instead of centipawns', (t) => {
  const engine = Object.assign({}, ENGINE, {
    moves: [
      { uci: 'd1h5', san: 'Qh5#', cp: null, mate: 1, loss: 0, best: true, pvSan: ['Qh5#'] },
      { uci: 'e1g1', san: 'O-O', cp: 120, mate: null, loss: 99000, best: false, pvSan: ['O-O'] }
    ]
  });
  const { window } = setup(t, engine);
  const chips = window.document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head) .cmp-eval');
  assert.strictEqual(chips[0].textContent, 'M1');
  assert.strictEqual(chips[1].textContent, '+1.2');
});

test('explains that the engine is off outside the analysis board', (t) => {
  const { window } = setup(t, { status: 'blocked', reason: 'not-analysis', moves: [], depth: 0 });
  assert.match(window.document.querySelector('.cmp-status').textContent, /bàn phân tích/);
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 0);
  assert.strictEqual(window.document.querySelectorAll('.cmp-row-eng').length, 0);
});

test('says plainly why it refuses during a game in progress', (t) => {
  const { window } = setup(t, { status: 'blocked', reason: 'game-in-progress', moves: [], depth: 0 });
  const text = window.document.querySelector('.cmp-status').textContent;
  assert.match(text, /ván diễn ra/);
  assert.match(text, /gian lận/);
});

test('shows partial results while the engine is still searching', (t) => {
  const { window } = setup(t, Object.assign({}, ENGINE, { status: 'thinking', depth: 9 }));
  assert.match(window.document.querySelector('.cmp-meta').textContent, /độ sâu 9/);
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 4);
});

test('the mode switch reports the chosen mode', (t) => {
  const { window, changes } = setup(t, ENGINE);
  const buttons = window.document.querySelectorAll('.cmp-mode');
  assert.ok(buttons[1].classList.contains('cmp-mode-on'));
  buttons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(changes[changes.length - 1], { mode: 'explorer' });
});

test('engine mode hides the opening-explorer filters', (t) => {
  const { window } = setup(t, ENGINE);
  assert.ok(window.document.querySelector('.cmp-panel').classList.contains('cmp-engine-mode'));
  const depth = window.document.querySelector('.cmp-settings input[type="range"]');
  assert.strictEqual(depth.value, '14');
});

test('the depth slider reports a new depth', (t) => {
  const { window, changes } = setup(t, ENGINE);
  const depth = window.document.querySelector('.cmp-settings input[type="range"]');
  depth.value = '18';
  depth.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(changes[changes.length - 1], { engineDepth: 18 });
});
