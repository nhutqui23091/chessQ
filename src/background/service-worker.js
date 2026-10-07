/*
 * Two jobs:
 *
 *  1. Fetch opening statistics from the Lichess opening explorer.
 *  2. Own the offscreen document that hosts Stockfish, and shuttle analysis
 *     requests and results between the content script and the engine.
 *
 * The content script cannot call the API directly (chess.com's page would be a
 * cross-origin caller), so every lookup goes through here. This worker also
 * owns the cache, de-duplicates concurrent lookups and keeps the request rate
 * polite — the explorer is a free public service.
 */
'use strict';

importScripts('../shared/settings.js');

var OFFSCREEN_PATH = 'src/offscreen/engine.html';
var offscreenReady = null;
var enginePing = null;
// Which tab asked for which analysis, so streamed results go back to it.
var analysisRequests = new Map();
var analysisSeq = 0;

var ENDPOINTS = {
  lichess: 'https://explorer.lichess.ovh/lichess',
  masters: 'https://explorer.lichess.ovh/masters'
};
var CACHE_TTL_MS = 6 * 60 * 60 * 1000;
var CACHE_MAX = 400;
var MIN_REQUEST_GAP_MS = 350;
var MAX_RETRIES = 2;

var cache = new Map();
var inFlight = new Map();
var lastRequestAt = 0;

/**
 * @param minimal strips every optional parameter, leaving just the position.
 *        Used as a second attempt when the explorer rejects a request: if the
 *        bare query works, one of the filters was what it objected to, and
 *        statistics without filters beat no statistics at all.
 */
function buildUrl(fen, settings, minimal) {
  var database = settings.database === 'masters' ? 'masters' : 'lichess';
  var url = new URL(ENDPOINTS[database]);
  url.searchParams.set('fen', fen);
  if (minimal) return url.toString();

  url.searchParams.set('moves', '12');
  url.searchParams.set('topGames', '0');
  if (database === 'lichess') {
    url.searchParams.set('variant', 'standard');
    url.searchParams.set('speeds', settings.speeds.join(','));
    url.searchParams.set('ratings', settings.ratings.join(','));
    url.searchParams.set('recentGames', '0');
  }
  return url.toString();
}

function cacheGet(key) {
  var entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency for the LRU eviction below.
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data: data });
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function throttle() {
  var wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * The reason a request was refused, as the server stated it. Throwing away
 * the body and reporting only "HTTP 401" leaves nobody anything to act on —
 * which is exactly what happened to a user hitting a 401 in a live game.
 */
async function readErrorBody(response) {
  try {
    var text = (await response.text()).trim();
    if (!text) return '';
    try {
      var parsed = JSON.parse(text);
      if (parsed && parsed.error) return String(parsed.error).slice(0, 180);
    } catch (err) { /* not JSON */ }
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  } catch (err) {
    return '';
  }
}

async function requestOnce(url) {
  await throttle();
  var response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 429 || response.status === 503) {
    var retryAfter = Number(response.headers.get('Retry-After')) || 4;
    var err = new Error('rate-limited');
    err.retryAfterMs = Math.min(retryAfter * 1000, 20000);
    err.status = response.status;
    throw err;
  }
  if (!response.ok) {
    var detail = await readErrorBody(response);
    var failure = new Error('HTTP ' + response.status + (detail ? ' — ' + detail : ''));
    failure.status = response.status;
    throw failure;
  }
  return response.json();
}

async function fetchExplorer(url) {
  var lastError = null;
  for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestOnce(url);
    } catch (err) {
      lastError = err;
      if (err.retryAfterMs && attempt < MAX_RETRIES) {
        await sleep(err.retryAfterMs);
        continue;
      }
      if (attempt < MAX_RETRIES && /NetworkError|Failed to fetch/i.test(err.message)) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  throw lastError || new Error('Explorer request failed');
}

/** Keeps only what the UI needs, so we cache small objects. */
function shape(raw) {
  var moves = (raw.moves || []).map(function (move) {
    var total = (move.white || 0) + (move.draws || 0) + (move.black || 0);
    return {
      uci: move.uci,
      san: move.san,
      white: move.white || 0,
      draws: move.draws || 0,
      black: move.black || 0,
      total: total,
      averageRating: move.averageRating || null
    };
  });
  var played = moves.reduce(function (sum, move) { return sum + move.total; }, 0);
  moves.forEach(function (move) {
    move.share = played ? (move.total / played) * 100 : 0;
  });
  return {
    total: (raw.white || 0) + (raw.draws || 0) + (raw.black || 0),
    played: played,
    white: raw.white || 0,
    draws: raw.draws || 0,
    black: raw.black || 0,
    opening: raw.opening ? { eco: raw.opening.eco, name: raw.opening.name } : null,
    moves: moves
  };
}

// Statuses that mean "this request", not "this service": worth one more try
// with the filters removed.
var REFUSED = [400, 401, 403, 404, 422];

async function lookup(fen, settings) {
  var url = buildUrl(fen, settings);
  var cached = cacheGet(url);
  if (cached) return { ok: true, data: cached, cached: true };

  if (inFlight.has(url)) return inFlight.get(url);

  var promise = fetchExplorer(url)
    .then(function (raw) {
      var data = shape(raw);
      cacheSet(url, data);
      return { ok: true, data: data, cached: false };
    })
    .catch(async function (err) {
      var bare = buildUrl(fen, settings, true);
      if (REFUSED.indexOf(err && err.status) === -1 || bare === url) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
      try {
        var raw = await fetchExplorer(bare);
        var data = shape(raw);
        cacheSet(url, data);
        // The caller is told the filters did not survive, so the panel can say so.
        return { ok: true, data: data, cached: false, degraded: true, reason: err.message };
      } catch (second) {
        return {
          ok: false,
          error: err.message,
          alsoFailed: second && second.message ? second.message : String(second)
        };
      }
    })
    .finally(function () {
      inFlight.delete(url);
    });

  inFlight.set(url, promise);
  return promise;
}

/**
 * Resolves once the offscreen document's message listener is live.
 *
 * createDocument() can resolve a touch before the page's scripts have
 * registered their listener, and this worker can also restart while the
 * document stays alive — in which case no boot message is coming. So we ping
 * and accept either answer, with a timeout so a lost ping cannot wedge the
 * engine for good.
 */
function waitForEngine() {
  if (enginePing) return enginePing;
  enginePing = new Promise(function (resolve) {
    engineReadyResolve = resolve;
    setTimeout(resolve, 3000);
  });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'engine-ping' }, function () {
    void chrome.runtime.lastError;
  });
  return enginePing;
}

var engineReadyResolve = null;

function markEngineReady() {
  if (!enginePing) enginePing = Promise.resolve();
  if (engineReadyResolve) {
    engineReadyResolve();
    engineReadyResolve = null;
  }
}

/**
 * Creates the offscreen document on first use. Chrome allows exactly one, so
 * concurrent callers share a single promise, and an "already exists" error
 * (possible after the worker restarts) counts as success.
 */
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async function () {
    var existed = chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument());
    if (!existed) {
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: ['WORKERS'],
          justification: 'Chạy Stockfish (Web Worker + WASM) để phân tích thế cờ.'
        });
      } catch (err) {
        if (!/single offscreen|already/i.test(String(err && err.message))) {
          offscreenReady = null;
          throw err;
        }
      }
    }
    await waitForEngine();
  })();
  return offscreenReady;
}

async function startAnalysis(message, tabId) {
  await ensureOffscreen();
  // Only the newest position per tab is worth computing.
  for (var [id, entry] of analysisRequests) {
    if (entry.tabId === tabId) analysisRequests.delete(id);
  }
  var id = ++analysisSeq;
  analysisRequests.set(id, { tabId: tabId, fen: message.fen });
  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'engine-analyze',
    id: id,
    fen: message.fen,
    depth: message.depth,
    lines: message.lines
  });
  return { ok: true, id: id };
}

function routeEngineResult(message) {
  var entry = analysisRequests.get(message.id);
  if (!entry) return; // superseded by a newer position
  if (message.status !== 'progress') analysisRequests.delete(message.id);
  chrome.tabs.sendMessage(entry.tabId, {
    type: 'analysis',
    id: message.id,
    fen: message.fen,
    status: message.status,
    error: message.error,
    depth: message.depth,
    nodes: message.nodes,
    nps: message.nps,
    moves: message.moves,
    bestMove: message.bestMove
  }, function () {
    // The tab may have navigated away mid-search.
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;

  if (message.type === 'explorer') {
    var settings = self.CMPSettings.normalize(message.settings);
    lookup(message.fen, settings).then(sendResponse);
    return true; // response is async
  }

  if (message.type === 'analyze') {
    var tabId = sender.tab && sender.tab.id;
    if (tabId == null) return false;
    startAnalysis(message, tabId)
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      });
    return true;
  }

  if (message.type === 'analyze-stop') {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'engine-stop' }, function () {
      void chrome.runtime.lastError;
    });
    return false;
  }

  if (message.type === 'engine-ready' && message.target === 'background') {
    markEngineReady();
    return false;
  }

  if (message.type === 'engine-result' && message.target === 'background') {
    routeEngineResult(message);
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  for (var [id, entry] of analysisRequests) {
    if (entry.tabId === tabId) analysisRequests.delete(id);
  }
});

function togglePanelInTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'toggle-panel' }, function () {
    // The tab may not have a content script (not a chess.com page) — ignore.
    void chrome.runtime.lastError;
  });
}

chrome.action.onClicked.addListener(function (tab) {
  if (tab && tab.id != null) togglePanelInTab(tab.id);
});

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-panel') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs[0] && tabs[0].id != null) togglePanelInTab(tabs[0].id);
  });
});
