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
 *   any game page   — but only once the game is over
 *
 * The last one is the point: a finished game has no opponent left to deceive,
 * so the moment a game against a person ends the engine turns itself on and
 * scores every move, right where it was played. While it is still running,
 * nothing.
 *
 * That switch needs a positive signal that the game ended — a result (1-0,
 * 0-1, ½-½), a game-over panel, a rematch button — and not merely the absence
 * of a resign button. Chess.com renames its classes often; if the resign
 * button stopped matching, "no resign button" would silently come to mean
 * "game over" in the middle of someone's game.
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

  // A finished game says so: the result, a game-over panel, a rematch button.
  var GAME_OVER_SELECTORS = [
    '[class*="game-over"]',
    '[data-cy="game-over-modal"]',
    '[class*="game-result"]',
    'button[aria-label*="rematch" i]',
    'button[aria-label*="new game" i]',
    'button[aria-label*="ván mới" i]',
    '[class*="rematch"]'
  ];
  // The result as it is written in a move list, which no class rename touches.
  var RESULT_TEXT = /^(1-0|0-1|½-½|1\/2-1\/2)$/;

  // Pages that are supposed to show a board. On anything else (home, forums,
  // profiles) a missing board is normal and the panel stays out of the way.
  var BOARD_PAGE = /^\/(play|game|games|analysis|puzzles|live|daily|variants|lessons|events|openings|practice)(\/|$)/;

  function looksLikeBoardPage(pathname) {
    return BOARD_PAGE.test(pathname || root.location.pathname);
  }

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

  function hasResultText(scope) {
    if (!scope) return false;
    var nodes = scope.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].childElementCount) continue;
      var text = (nodes[i].textContent || '').trim();
      if (text.length <= 7 && RESULT_TEXT.test(text)) return true;
    }
    return false;
  }

  /** Whether the game on this page has finished. */
  function gameIsOver(doc) {
    var scope = doc || root.document;
    for (var i = 0; i < GAME_OVER_SELECTORS.length; i++) {
      if (scope.querySelector(GAME_OVER_SELECTORS[i])) return true;
    }
    // The move list is already located and cached by the position reader, so
    // checking it for a result costs nothing.
    var moveList = root.CMPPosition && root.CMPPosition.moveListElement
      ? root.CMPPosition.moveListElement()
      : null;
    return hasResultText(moveList);
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
    if (match) {
      if (match.refuseDuringGame && hasLiveGameControls(doc)) {
        return { allowed: false, reason: 'game-in-progress', context: match.context };
      }
      return { allowed: true, reason: 'ok', context: match.context };
    }

    // Any other game page: allowed once the game is over, never before.
    if (looksLikeBoardPage(pathname)) {
      if (gameIsOver(doc) && !hasLiveGameControls(doc)) {
        return { allowed: true, reason: 'ok', context: 'finished' };
      }
      return { allowed: false, reason: 'game-in-progress', context: 'human' };
    }

    return { allowed: false, reason: 'not-allowed', context: null };
  }

  root.CMPContext = {
    engineStatus: engineStatus,
    looksLikeBoardPage: looksLikeBoardPage,
    gameIsOver: gameIsOver,
    GAME_OVER_SELECTORS: GAME_OVER_SELECTORS,
    matchContext: matchContext,
    isAnalysisPath: isAnalysisPath,
    hasLiveGameControls: hasLiveGameControls,
    LIVE_CONTROL_SELECTORS: LIVE_CONTROL_SELECTORS,
    ALLOWED_CONTEXTS: ALLOWED_CONTEXTS
  };
})(typeof self !== 'undefined' ? self : this);
