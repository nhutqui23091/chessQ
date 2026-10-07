/*
 * Decides where the engine is allowed to run.
 *
 * The line is who is on the other side of the board. Against a bot there is
 * nobody to deceive and no rating to corrupt — Chess.com hands out hints and
 * takebacks there itself — so the engine runs live, move by move. Against a
 * person it would be cheating under Chess.com's fair play rules: it costs the
 * opponent a fair game and the user their account.
 *
 * So the engine runs from an allowlist:
 *
 *   /play/computer  — practising against a bot, live
 *   /analysis       — the analysis board, where Game Review also lives
 *
 * and nowhere else. On the analysis board it additionally stands down if the
 * page still carries the controls of a running game, which is how a live game
 * against a person would show up there.
 *
 * The opening statistics are not gated here; they are a book, not an engine,
 * and the panel carries the fair play warning.
 */
(function (root) {
  'use strict';

  var ALLOWED_CONTEXTS = [
    // Bot practice: the opponent cannot be human on this page.
    { pattern: /^\/play\/computer(\/|$)/, context: 'computer', refuseDuringGame: false },
    // Study and post-game review.
    { pattern: /^\/analysis(\/|$)/, context: 'analysis', refuseDuringGame: true }
  ];

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

  function matchContext(pathname) {
    var path = pathname || root.location.pathname;
    for (var i = 0; i < ALLOWED_CONTEXTS.length; i++) {
      if (ALLOWED_CONTEXTS[i].pattern.test(path)) return ALLOWED_CONTEXTS[i];
    }
    return null;
  }

  function isAnalysisPath(pathname) {
    var match = matchContext(pathname);
    return !!match && match.context === 'analysis';
  }

  function hasLiveGameControls(doc) {
    var scope = doc || root.document;
    for (var i = 0; i < LIVE_CONTROL_SELECTORS.length; i++) {
      if (scope.querySelector(LIVE_CONTROL_SELECTORS[i])) return true;
    }
    return false;
  }

  /**
   * @returns {{allowed: boolean,
   *            reason: 'ok'|'not-allowed'|'game-in-progress',
   *            context: 'computer'|'analysis'|null}}
   */
  function engineStatus(options) {
    var opts = options || {};
    var pathname = opts.pathname || root.location.pathname;
    var doc = opts.document || root.document;

    var match = matchContext(pathname);
    if (!match) return { allowed: false, reason: 'not-allowed', context: null };
    if (match.refuseDuringGame && hasLiveGameControls(doc)) {
      return { allowed: false, reason: 'game-in-progress', context: match.context };
    }
    return { allowed: true, reason: 'ok', context: match.context };
  }

  root.CMPContext = {
    engineStatus: engineStatus,
    matchContext: matchContext,
    isAnalysisPath: isAnalysisPath,
    hasLiveGameControls: hasLiveGameControls,
    LIVE_CONTROL_SELECTORS: LIVE_CONTROL_SELECTORS,
    ALLOWED_CONTEXTS: ALLOWED_CONTEXTS
  };
})(typeof self !== 'undefined' ? self : this);
