'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeUiWindow, boardHtml } = require('./helpers');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const DATA = {
  total: 1000,
  played: 1000,
  white: 500,
  draws: 300,
  black: 200,
  opening: { eco: 'B00', name: 'King\'s Pawn' },
  moves: [
    { uci: 'e2e4', san: 'e4', white: 300, draws: 100, black: 100, total: 500, share: 50 },
    { uci: 'd2d4', san: 'd4', white: 180, draws: 120, black: 100, total: 400, share: 40 },
    { uci: 'g1f3', san: 'Nf3', white: 50, draws: 30, black: 20, total: 100, share: 10 },
    { uci: 'a2a3', san: 'a3', white: 1, draws: 0, black: 0, total: 1, share: 0.1 }
  ]
};

// The UI runs a requestAnimationFrame loop so it can follow the board, so each
// test has to tear its window down or the runner never exits.
function setup(t, settingsPatch, flipped) {
  const window = makeUiWindow(`<!doctype html><html><body>${boardHtml(START, { flipped })}</body></html>`);
  const changes = [];
  const ui = new window.CMPUI({ onSettingsChange: (patch) => changes.push(patch) });
  const settings = window.CMPSettings.normalize(
    Object.assign({}, window.CMPSettings.DEFAULTS, settingsPatch || {})
  );
  ui.setSettings(settings);
  ui.setState({
    status: 'ready',
    data: DATA,
    position: { board: window.document.querySelector('wc-chess-board'), flipped: !!flipped, turn: 'w' }
  });
  t.after(() => {
    ui.destroy();
    window.close();
  });
  return { window, ui, changes };
}

test('renders one row per move above the threshold', (t) => {
  const { window } = setup(t);
  const rows = window.document.querySelectorAll('.cmp-row:not(.cmp-row-head)');
  // a3 (0.1%) is below the 0.4% default threshold.
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].querySelector('.cmp-c-san').textContent, 'e4');
  assert.strictEqual(rows[0].querySelector('.cmp-share-text').textContent, '50%');
});

test('shows the opening name and side to move', (t) => {
  const { window } = setup(t);
  const meta = window.document.querySelector('.cmp-meta').textContent;
  assert.match(meta, /B00 King's Pawn/);
  assert.match(meta, /Trắng đi/);
});

test('draws a badge per move on the board', (t) => {
  const { window } = setup(t, { badgeCount: 2 });
  const badges = window.document.querySelectorAll('.cmp-badge');
  assert.strictEqual(badges.length, 2);
  // e4 => file e (col 4), rank 4 (row 4 from the top on an unflipped board)
  assert.strictEqual(badges[0].style.left, 'calc(var(--cmp-square, 48px) * 4)');
  assert.strictEqual(badges[0].style.top, 'calc(var(--cmp-square, 48px) * 4)');
  assert.strictEqual(badges[0].textContent, '50%');
});

test('mirrors badge placement on a flipped board', (t) => {
  const { window } = setup(t, { badgeCount: 1 }, true);
  const badge = window.document.querySelector('.cmp-badge');
  assert.strictEqual(badge.style.left, 'calc(var(--cmp-square, 48px) * 3)');
  assert.strictEqual(badge.style.top, 'calc(var(--cmp-square, 48px) * 3)');
});

test('badges can be turned off', (t) => {
  const { window } = setup(t, { showBoardBadges: false });
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 0);
});

test('hovering a row highlights its badge and draws an arrow', (t) => {
  const { window, ui } = setup(t);
  ui.setHovered('e2e4');
  const badge = window.document.querySelector('.cmp-badge[data-uci="e2e4"]');
  assert.ok(badge.classList.contains('cmp-badge-hover'));
  assert.strictEqual(window.document.querySelectorAll('.cmp-arrows line').length, 1);
  ui.setHovered(null);
  assert.strictEqual(window.document.querySelectorAll('.cmp-arrows line').length, 0);
});

test('explains an empty result instead of showing a blank panel', (t) => {
  const { window, ui } = setup(t);
  ui.setState({ status: 'ready', data: Object.assign({}, DATA, { moves: [], total: 0 }), position: null });
  assert.match(window.document.querySelector('.cmp-status').textContent, /Không có dữ liệu/);
  assert.strictEqual(window.document.querySelectorAll('.cmp-badge').length, 0);
});

test('surfaces API errors', (t) => {
  const { window, ui } = setup(t);
  ui.setState({ status: 'error', data: null, position: null, error: 'Explorer HTTP 503' });
  assert.match(window.document.querySelector('.cmp-status').textContent, /503/);
});

test('the close button asks for the panel to be hidden', (t) => {
  const { window, changes } = setup(t);
  const buttons = window.document.querySelectorAll('.cmp-head .cmp-icon-btn');
  buttons[buttons.length - 1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(changes[changes.length - 1], { showPanel: false });
});

test('switching the database reports the change', (t) => {
  const { window, changes } = setup(t);
  const select = window.document.querySelector('.cmp-db');
  select.value = 'masters';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(changes[changes.length - 1], { database: 'masters' });
});

test('masters mode hides the speed and rating filters', (t) => {
  const { window } = setup(t, { database: 'masters' });
  const speeds = window.document.querySelector('.cmp-settings .cmp-chips').closest('.cmp-field');
  assert.strictEqual(speeds.style.display, 'none');
});

test('the panel is hidden when the extension is switched off', (t) => {
  const { window } = setup(t, { enabled: false });
  assert.ok(window.document.querySelector('.cmp-panel').classList.contains('cmp-hidden'));
});

// --- what a refusal from the explorer looks like -----------------------------

test('a 401 is explained, not just numbered', (t) => {
  const { window, ui } = setup(t);
  ui.setState({
    status: 'error', data: null, position: null,
    error: 'HTTP 401 — token required'
  });
  const text = window.document.querySelector('.cmp-status').textContent;
  assert.match(text, /Lichess từ chối/);
  assert.match(text, /401/);
  assert.match(text, /token required/, 'the server reason reaches the user');
  assert.match(text, /kiện tướng|VPN/, 'and something to try');
});

test('rate limiting and network loss read differently', (t) => {
  const { window, ui } = setup(t);
  ui.setState({ status: 'error', data: null, position: null, error: 'HTTP 429' });
  assert.match(window.document.querySelector('.cmp-status').textContent, /giới hạn tốc độ/);

  ui.setState({ status: 'error', data: null, position: null, error: 'Failed to fetch' });
  assert.match(window.document.querySelector('.cmp-status').textContent, /Không kết nối được/);
});

test('dropped filters are admitted rather than hidden', (t) => {
  const { window, ui } = setup(t);
  ui.setState({
    status: 'ready', data: DATA,
    position: { board: window.document.querySelector('wc-chess-board'), flipped: false, turn: 'w' },
    degraded: 'HTTP 401'
  });
  assert.match(window.document.querySelector('.cmp-meta').textContent, /không áp dụng được bộ lọc/);
  // The statistics are still shown.
  assert.strictEqual(window.document.querySelectorAll('.cmp-row:not(.cmp-row-head)').length, 3);
});
