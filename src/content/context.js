/*
 * Decides where the engine is allowed to run.
 *
 * Engine evaluations are a study tool here, not a playing aid: feeding best
 * moves into a game in progress is cheating under Chess.com's fair play rules
 * and gets accounts closed. So the engine runs from an allowlist — the
 * analysis board, which is also where Game Review of a finished game lives —
 * and never on a page that still has the controls of a running game.
 *
 * The opening statistics are not gated here; they are a book, not an engine,
 * and the panel carries the fair play warning.
 */
(function (root) {
  'use strict';

  var ANALYSIS_PATH = /^\/analysis(\/|$)/;

  // Controls that only exist while a game of yours is still running.
  var LIVE_CONTROL_SELECTORS = [
    '[data-cy="resign-button"]',
    '.resign-button-component',
    '.draw-button-component',
    '.live-game-buttons-component',
    '.game-controls-buttons-component',
    'button[aria-label*="resign" i]',
    'button[aria-label*="đầu hàng" i]',
    '[class*="resign-button"]'
  ];

  function isAnalysisPath(pathname) {
    return ANALYSIS_PATH.test(pathname || root.location.pathname);
  }

  function hasLiveGameControls(doc) {
    var scope = doc || root.document;
    for (var i = 0; i < LIVE_CONTROL_SELECTORS.length; i++) {
      if (scope.querySelector(LIVE_CONTROL_SELECTORS[i])) return true;
    }
    return false;
  }

  /**
   * @returns {{allowed: boolean, reason: 'ok'|'not-analysis'|'game-in-progress'}}
   */
  function engineStatus(options) {
    var opts = options || {};
    var pathname = opts.pathname || root.location.pathname;
    var doc = opts.document || root.document;

    if (!isAnalysisPath(pathname)) return { allowed: false, reason: 'not-analysis' };
    if (hasLiveGameControls(doc)) return { allowed: false, reason: 'game-in-progress' };
    return { allowed: true, reason: 'ok' };
  }

  root.CMPContext = {
    engineStatus: engineStatus,
    isAnalysisPath: isAnalysisPath,
    hasLiveGameControls: hasLiveGameControls,
    LIVE_CONTROL_SELECTORS: LIVE_CONTROL_SELECTORS
  };
})(typeof self !== 'undefined' ? self : this);
