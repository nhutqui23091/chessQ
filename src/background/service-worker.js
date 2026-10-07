/*
 * Fetches opening statistics from the Lichess opening explorer.
 *
 * The content script cannot call the API directly (chess.com's page would be a
 * cross-origin caller), so every lookup goes through here. This worker also
 * owns the cache, de-duplicates concurrent lookups and keeps the request rate
 * polite — the explorer is a free public service.
 */
'use strict';

importScripts('../shared/settings.js');

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

function buildUrl(fen, settings) {
  var database = settings.database === 'masters' ? 'masters' : 'lichess';
  var url = new URL(ENDPOINTS[database]);
  url.searchParams.set('fen', fen);
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

async function requestOnce(url) {
  await throttle();
  var response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 429 || response.status === 503) {
    var retryAfter = Number(response.headers.get('Retry-After')) || 4;
    var err = new Error('rate-limited');
    err.retryAfterMs = Math.min(retryAfter * 1000, 20000);
    throw err;
  }
  if (!response.ok) {
    throw new Error('Explorer HTTP ' + response.status);
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
    .catch(function (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    })
    .finally(function () {
      inFlight.delete(url);
    });

  inFlight.set(url, promise);
  return promise;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== 'explorer') return false;
  var settings = self.CMPSettings.normalize(message.settings);
  lookup(message.fen, settings).then(sendResponse);
  return true; // response is async
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
