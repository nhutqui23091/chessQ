/*
 * Shared settings model. Loaded both as a content script (plain script, no
 * modules) and via importScripts() in the service worker, so everything hangs
 * off a single global namespace.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    // Master switch — when false the content script stays dormant.
    enabled: true,
    // What the panel and the board badges show:
    //   'explorer' = how often each move is played (opening statistics)
    //   'engine'   = Stockfish's score for each move (analysis board only)
    mode: 'explorer',
    // 'lichess' = games by Lichess players, 'masters' = OTB master games.
    database: 'lichess',
    // Only used by the 'lichess' database.
    speeds: ['blitz', 'rapid', 'classical'],
    ratings: [1600, 1800, 2000, 2200, 2500],
    // UI
    showPanel: true,
    showBoardBadges: true,
    badgeCount: 5,
    // Hide moves played in fewer than this share of games (percent).
    minPercent: 0.4,
    // Engine
    engineDepth: 14,
    engineLines: 4,
    // Remembered panel position {left, top} in px, null = default corner.
    panelPos: null,
    panelCollapsed: false
  };

  var MODE_OPTIONS = ['explorer', 'engine'];
  var SPEED_OPTIONS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
  var RATING_OPTIONS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** Merge stored values over the defaults, dropping unknown/invalid keys. */
  function normalize(stored) {
    var out = clone(DEFAULTS);
    if (!stored || typeof stored !== 'object') return out;

    Object.keys(DEFAULTS).forEach(function (key) {
      if (!(key in stored)) return;
      var value = stored[key];
      var fallback = DEFAULTS[key];
      if (Array.isArray(fallback)) {
        if (Array.isArray(value)) out[key] = value.slice();
      } else if (typeof fallback === 'boolean') {
        if (typeof value === 'boolean') out[key] = value;
      } else if (typeof fallback === 'number') {
        if (typeof value === 'number' && isFinite(value)) out[key] = value;
      } else {
        out[key] = value;
      }
    });

    if (out.database !== 'masters') out.database = 'lichess';
    if (MODE_OPTIONS.indexOf(out.mode) === -1) out.mode = 'explorer';
    out.speeds = out.speeds.filter(function (s) { return SPEED_OPTIONS.indexOf(s) !== -1; });
    if (!out.speeds.length) out.speeds = clone(DEFAULTS.speeds);
    out.ratings = out.ratings
      .map(Number)
      .filter(function (r) { return RATING_OPTIONS.indexOf(r) !== -1; })
      .sort(function (a, b) { return a - b; });
    if (!out.ratings.length) out.ratings = clone(DEFAULTS.ratings);
    out.badgeCount = Math.max(1, Math.min(10, Math.round(out.badgeCount)));
    out.minPercent = Math.max(0, Math.min(25, out.minPercent));
    out.engineDepth = Math.max(8, Math.min(22, Math.round(out.engineDepth)));
    out.engineLines = Math.max(1, Math.min(8, Math.round(out.engineLines)));
    return out;
  }

  function load() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get(null, function (stored) {
          var failed = chrome.runtime && chrome.runtime.lastError;
          resolve(normalize(failed ? null : stored));
        });
      } catch (err) {
        resolve(clone(DEFAULTS));
      }
    });
  }

  function save(patch) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.set(patch, function () { resolve(); });
      } catch (err) {
        resolve();
      }
    });
  }

  root.CMPSettings = {
    DEFAULTS: DEFAULTS,
    MODE_OPTIONS: MODE_OPTIONS,
    SPEED_OPTIONS: SPEED_OPTIONS,
    RATING_OPTIONS: RATING_OPTIONS,
    normalize: normalize,
    load: load,
    save: save
  };
})(typeof self !== 'undefined' ? self : this);
