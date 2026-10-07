/* Shared test helpers: load the content scripts into a jsdom window. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function loadInto(window, relativePaths) {
  for (const rel of relativePaths) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    window.eval(code);
  }
}

/** A jsdom window with chess.bundle.js + position.js loaded. */
function makeWindow(html) {
  // 'outside-only' gives us a working window.eval without running page scripts.
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only' });
  const { window } = dom;
  // getBoundingClientRect is stubbed out in jsdom; give boards a real size so
  // the visibility check in findBoard() passes.
  window.Element.prototype.getBoundingClientRect = function () {
    const size = this.dataset && this.dataset.size ? Number(this.dataset.size) : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size };
  };
  loadInto(window, ['src/vendor/chess.bundle.js', 'src/content/position.js']);
  return window;
}

const PIECE_CODES = {
  K: 'wk', Q: 'wq', R: 'wr', B: 'wb', N: 'wn', P: 'wp',
  k: 'bk', q: 'bq', r: 'br', b: 'bb', n: 'bn', p: 'bp'
};

/** Renders a FEN placement as chess.com-style piece divs inside a board. */
function boardHtml(fen, options) {
  const opts = options || {};
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  const pieces = [];
  rows.forEach((row, index) => {
    const rank = 8 - index;
    let file = 1;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      pieces.push(`<div class="piece ${PIECE_CODES[ch]} square-${file}${rank}"></div>`);
      file += 1;
    }
  });
  const highlights = (opts.highlights || [])
    .map((sq) => {
      const file = 'abcdefgh'.indexOf(sq[0]) + 1;
      return `<div class="highlight square-${file}${sq[1]}"></div>`;
    })
    .join('');
  const cls = 'board' + (opts.flipped ? ' flipped' : '');
  return `<wc-chess-board class="${cls}" data-size="480">${highlights}${pieces.join('')}</wc-chess-board>`;
}

/** Renders a chess.com-style vertical move list. */
function moveListHtml(sans, selectedIndex) {
  const nodes = sans
    .map((san, index) => {
      const selected = index + 1 === selectedIndex ? ' selected' : '';
      const number = index % 2 === 0 ? `<span class="index">${index / 2 + 1}.</span>` : '';
      return `${number}<div class="node${selected}" data-ply="${index + 1}">${san}</div>`;
    })
    .join('');
  return `<wc-simple-move-list class="move-list">${nodes}</wc-simple-move-list>`;
}

/** Runs the service worker in a vm sandbox with stubbed chrome + fetch. */
function loadServiceWorker(fetchImpl) {
  const calls = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    Map,
    Date,
    Promise,
    Error,
    JSON,
    fetch: async (url, init) => {
      calls.push(url);
      return fetchImpl(url, init);
    },
    chrome: {
      runtime: { onMessage: { addListener() {} }, lastError: null },
      action: { onClicked: { addListener() {} } },
      commands: { onCommand: { addListener() {} } },
      tabs: { query() {}, sendMessage() {} },
      storage: { sync: { get() {}, set() {} } }
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (rel) => {
    const file = path.join(ROOT, 'src/background', rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  };
  vm.createContext(sandbox);
  const swPath = path.join(ROOT, 'src/background/service-worker.js');
  vm.runInContext(fs.readFileSync(swPath, 'utf8'), sandbox, { filename: swPath });
  return { sandbox, calls };
}

/** A jsdom window with the settings module and the UI loaded. */
function makeUiWindow(html) {
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true // gives us requestAnimationFrame
  });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    const size = this.dataset && this.dataset.size ? Number(this.dataset.size) : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size };
  };
  loadInto(window, ['src/shared/settings.js', 'src/content/ui.js']);
  return window;
}

/**
 * A jsdom window running the complete content-script stack against a stubbed
 * chrome API — the same wiring the extension gets inside a chess.com tab.
 */
function makeContentWindow(html, explorerData) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    const size = this.dataset && this.dataset.size ? Number(this.dataset.size) : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size };
  };

  const sent = [];
  const stored = {};
  const messageListeners = [];
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        setTimeout(() => callback({ ok: true, data: explorerData }), 0);
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) }
    },
    storage: {
      sync: {
        get: (keys, callback) => callback(Object.assign({}, stored)),
        set: (patch, callback) => {
          Object.assign(stored, patch);
          if (callback) callback();
        }
      },
      onChanged: { addListener: () => {} }
    }
  };

  loadInto(window, [
    'src/vendor/chess.bundle.js',
    'src/shared/settings.js',
    'src/content/position.js',
    'src/content/ui.js',
    'src/content/content.js'
  ]);
  return { window, sent, stored, messageListeners };
}

module.exports = { makeWindow, makeUiWindow, makeContentWindow, boardHtml, moveListHtml, loadServiceWorker, ROOT };
