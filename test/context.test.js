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
  assert.deepStrictEqual({ ...status }, { allowed: true, reason: 'ok' });
});

test('Game Review of a finished game counts as analysis', () => {
  const window = loadContext();
  const status = window.CMPContext.engineStatus({
    pathname: '/analysis/game/live/1234567890', document: window.document
  });
  assert.strictEqual(status.allowed, true);
});

test('the engine never runs on a live game page', () => {
  const window = loadContext();
  for (const pathname of ['/play/online', '/game/live/123', '/play/computer', '/game/daily/55', '/']) {
    const status = window.CMPContext.engineStatus({ pathname, document: window.document });
    assert.strictEqual(status.allowed, false, pathname);
    assert.strictEqual(status.reason, 'not-analysis');
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
