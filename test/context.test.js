'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function loadContext(html) {
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only' });
  const code = fs.readFileSync(path.join(__dirname, '..', 'src/content/context.js'), 'utf8');
  dom.window.eval(code);
  return dom.window;
}

const RESIGN = '<button data-cy="resign-button">Resign</button>';

test('the engine runs on the analysis board', () => {
  const window = loadContext();
  const status = window.CMPContext.engineStatus({
    pathname: '/analysis', document: window.document
  });
  assert.deepStrictEqual({ ...status }, { allowed: true, reason: 'ok', context: 'analysis' });
});

test('the engine runs live while practising against a bot', () => {
  const window = loadContext();
  for (const pathname of ['/play/computer', '/play/computer/komodo-level-5']) {
    const status = window.CMPContext.engineStatus({ pathname, document: window.document });
    assert.strictEqual(status.allowed, true, pathname);
    assert.strictEqual(status.context, 'computer');
  }
});

test('a bot game keeps the engine on despite its resign button', () => {
  // The whole point is live help during the game, and /play/computer always has
  // the controls of a game in progress.
  const window = loadContext(`<!doctype html><html><body>${RESIGN}</body></html>`);
  const status = window.CMPContext.engineStatus({
    pathname: '/play/computer', document: window.document
  });
  assert.strictEqual(status.allowed, true);
});

test('Game Review of a finished game counts as analysis', () => {
  const window = loadContext();
  const status = window.CMPContext.engineStatus({
    pathname: '/analysis/game/live/1234567890', document: window.document
  });
  assert.strictEqual(status.allowed, true);
});

test('the engine never runs while a game against a person is being played', () => {
  const window = loadContext();
  for (const pathname of ['/play/online', '/game/live/123', '/game/daily/55', '/live']) {
    const status = window.CMPContext.engineStatus({ pathname, document: window.document });
    assert.strictEqual(status.allowed, false, pathname);
    assert.strictEqual(status.reason, 'game-in-progress', pathname);
  }
  // And a page with no game at all is simply out of scope.
  const off = window.CMPContext.engineStatus({ pathname: '/', document: window.document });
  assert.strictEqual(off.reason, 'not-allowed');
});

test('a path that merely starts with an allowed one is not enough', () => {
  const window = loadContext();
  for (const pathname of ['/analysis-board-tips', '/play/computerized', '/play/online/computer']) {
    assert.strictEqual(
      window.CMPContext.engineStatus({ pathname, document: window.document }).allowed,
      false, pathname
    );
  }
});

test('a page with the controls of a running game is refused even under /analysis', () => {
  const window = loadContext(`<!doctype html><html><body>${RESIGN}</body></html>`);
  const status = window.CMPContext.engineStatus({
    pathname: '/analysis', document: window.document
  });
  assert.strictEqual(status.allowed, false);
  assert.strictEqual(status.reason, 'game-in-progress');
});

test('every live-control selector is recognised', () => {
  for (const selector of loadContext().CMPContext.LIVE_CONTROL_SELECTORS) {
    // Build an element that matches the selector, then check the detector sees it.
    const html = selector.startsWith('[')
      ? `<button ${selector.slice(1, -1).replace(/\s*\*?=\s*/, '=').replace(/ i$/, '')}>x</button>`
      : selector.startsWith('button')
        ? '<button aria-label="Resign game">x</button>'
        : `<div class="${selector.replace(/^[.\[]|[\]]$/g, '').replace('class*=', '').replace(/"/g, '')}">x</div>`;
    const window = loadContext(`<!doctype html><html><body>${html}</body></html>`);
    assert.strictEqual(window.CMPContext.hasLiveGameControls(window.document), true, selector);
  }
});

// --- a game that has ended -----------------------------------------------
// No opponent is left to deceive once the game is over, so the engine turns
// itself on there — including on a game that was played against a person.

const RESULT = '<div class="moves"><span>e4</span><span>e5</span><span>1-0</span></div>';

test('a finished game is analysed, wherever it was played', () => {
  for (const marker of [
    '<div class="game-over-modal-content">Bạn thắng</div>',
    '<button aria-label="Rematch">Đấu lại</button>',
    '<div class="game-result">1-0</div>'
  ]) {
    const window = loadContext(`<!doctype html><html><body>${marker}</body></html>`);
    const status = window.CMPContext.engineStatus({
      pathname: '/game/live/123456', document: window.document
    });
    assert.strictEqual(status.allowed, true, marker);
    assert.strictEqual(status.context, 'finished');
  }
});

test('the result written in the move list is enough on its own', () => {
  // Class names get renamed; "1-0" does not.
  const window = loadContext(`<!doctype html><html><body>${RESULT}</body></html>`);
  window.CMPPosition = {
    moveListElement: () => window.document.querySelector('.moves')
  };
  const status = window.CMPContext.engineStatus({
    pathname: '/play/online', document: window.document
  });
  assert.strictEqual(status.allowed, true);
  assert.strictEqual(status.context, 'finished');
});

test('a game still being played is refused, result or not', () => {
  const window = loadContext(
    `<!doctype html><html><body>${RESULT}${RESIGN}</body></html>`);
  window.CMPPosition = {
    moveListElement: () => window.document.querySelector('.moves')
  };
  const status = window.CMPContext.engineStatus({
    pathname: '/play/online', document: window.document
  });
  assert.strictEqual(status.allowed, false);
  assert.strictEqual(status.reason, 'game-in-progress');
  assert.strictEqual(status.context, 'human');
});

test('a missing resign button is never by itself taken as game over', () => {
  // If Chess.com renames the resign button, "no resign button" must not come
  // to mean "finished" in the middle of someone's game.
  const window = loadContext('<!doctype html><html><body><div>board</div></body></html>');
  const status = window.CMPContext.engineStatus({
    pathname: '/play/online', document: window.document
  });
  assert.strictEqual(status.allowed, false);
  assert.strictEqual(status.reason, 'game-in-progress');
});

test('a page with no board at all is still out of scope', () => {
  const window = loadContext('<!doctype html><html><body><div>forum</div></body></html>');
  const status = window.CMPContext.engineStatus({
    pathname: '/members/nhutqui1', document: window.document
  });
  assert.strictEqual(status.allowed, false);
  assert.strictEqual(status.reason, 'not-allowed');
});
