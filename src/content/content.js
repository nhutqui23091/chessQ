/*
 * Ties everything together: watch the board, ask the background worker for the
 * statistics of whatever position is on screen, hand the result to the UI.
 */
(function (root) {
  'use strict';

  var POLL_MS = 700;
  var DEBOUNCE_MS = 220;

  var settings = root.CMPSettings.DEFAULTS;
  var ui = null;
  var currentFen = null;
  var requestToken = 0;
  var engineState = { status: 'idle', moves: [], depth: 0, reason: null, error: null };
  var boardEl = null;
  var observer = null;
  var pollTimer = null;
  var debounceTimer = null;

  function setEngine(patch) {
    engineState = Object.assign({}, engineState, patch);
    ui.setState({
      status: ui.state.status,
      data: ui.state.data,
      position: ui.state.position,
      error: ui.state.error,
      engine: engineState
    });
  }

  /**
   * Turns the engine's UCI moves into SAN, which is what a player reads.
   * Returns the moves unchanged if the FEN will not load — better a row of
   * "e2e4" than no rows at all.
   */
  function toSan(fen, moves) {
    if (!root.ChessLib || !root.ChessLib.Chess) return moves;
    return moves.map(function (move) {
      var line = [];
      var san = null;
      try {
        var game = new root.ChessLib.Chess(fen);
        for (var i = 0; i < move.pv.length; i++) {
          var played = game.move(uciToMove(move.pv[i]));
          if (!played) break;
          line.push(played.san);
        }
        san = line[0] || null;
      } catch (err) {
        san = null;
      }
      return Object.assign({}, move, { san: san, pvSan: line.length ? line : null });
    });
  }

  function uciToMove(uci) {
    var move = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    if (uci.length > 4) move.promotion = uci.charAt(4);
    return move;
  }

  function requestEngine(position) {
    var gate = root.CMPContext.engineStatus();
    if (!gate.allowed) {
      setEngine({
        status: 'blocked', reason: gate.reason, context: gate.context,
        moves: [], depth: 0, error: null
      });
      return;
    }
    setEngine({
      status: 'thinking', reason: null, context: gate.context,
      moves: [], depth: 0, error: null
    });
    try {
      chrome.runtime.sendMessage({
        type: 'analyze',
        fen: position.fen,
        depth: settings.engineDepth,
        lines: settings.engineLines
      }, function (response) {
        if (chrome.runtime.lastError) {
          setEngine({ status: 'error', error: chrome.runtime.lastError.message, moves: [] });
          return;
        }
        if (response && !response.ok) {
          setEngine({ status: 'error', error: response.error, moves: [] });
        }
      });
    } catch (err) {
      setEngine({ status: 'error', error: 'mất kết nối tiện ích', moves: [] });
    }
  }

  function stopEngine() {
    try {
      chrome.runtime.sendMessage({ type: 'analyze-stop' }, function () {
        void chrome.runtime.lastError;
      });
    } catch (err) { /* extension reloaded */ }
  }

  function requestStats(position) {
    var token = ++requestToken;
    var fen = position.fen;
    ui.setState({ status: 'loading', data: null, position: position, engine: engineState });
    try {
      chrome.runtime.sendMessage({
        type: 'explorer',
        fen: fen,
        settings: {
          database: settings.database,
          speeds: settings.speeds,
          ratings: settings.ratings
        }
      }, function (response) {
        // A newer position arrived while we waited — drop this answer.
        if (token !== requestToken) return;
        if (chrome.runtime.lastError || !response) {
          ui.setState({
            status: 'error',
            data: null,
            position: position,
            engine: engineState,
            error: (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              'không nhận được phản hồi'
          });
          return;
        }
        if (!response.ok) {
          ui.setState({
            status: 'error', data: null, position: position, engine: engineState, error: response.error
          });
          return;
        }
        ui.setState({ status: 'ready', data: response.data, position: position, engine: engineState });
      });
    } catch (err) {
      // Happens when the extension is reloaded while the page stays open.
      ui.setState({
        status: 'error', data: null, position: position, engine: engineState, error: 'mất kết nối tiện ích'
      });
    }
  }

  function attachObserver(el) {
    if (observer) observer.disconnect();
    boardEl = el;
    if (!el) return;
    observer = new MutationObserver(function () {
      scheduleSync();
    });
    observer.observe(el, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] });
  }

  function sync() {
    if (!settings.enabled) return;
    if (document.hidden) return;

    var position = root.CMPPosition.readPosition();
    if (!position) {
      currentFen = null;
      if (ui.state.status !== 'no-board') {
        engineState = { status: 'idle', moves: [], depth: 0, reason: null, error: null };
        ui.setState({ status: 'no-board', data: null, position: null, engine: engineState });
      }
      if (boardEl) attachObserver(null);
      return;
    }

    if (position.board !== boardEl) attachObserver(position.board);
    if (position.fen === currentFen) {
      // Same position: refresh the stored board reference so the overlay keeps
      // tracking the right element after a re-render.
      if (ui.state.position) ui.state.position.board = position.board;
      if (ui.state.position) ui.state.position.flipped = position.flipped;
      return;
    }
    currentFen = position.fen;
    analyzePosition(position);
  }

  /** Runs whichever source the current mode needs for this position. */
  function analyzePosition(position) {
    if (settings.mode === 'engine') {
      // Keep the panel's position reference fresh even though the explorer is
      // not queried in this mode.
      ui.setState({ status: 'idle', data: null, position: position, engine: engineState });
      requestEngine(position);
    } else {
      requestStats(position);
    }
  }

  function scheduleSync() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sync, DEBOUNCE_MS);
  }

  function applySettings(next, options) {
    var previous = settings;
    settings = next;
    ui.setSettings(settings);

    if (!settings.enabled) {
      currentFen = null;
      stopEngine();
      engineState = { status: 'idle', moves: [], depth: 0, reason: null, error: null };
      ui.setState({ status: 'idle', data: null, position: null, engine: engineState });
      return;
    }

    var queryChanged = previous.mode !== settings.mode ||
      previous.database !== settings.database ||
      previous.speeds.join() !== settings.speeds.join() ||
      previous.ratings.join() !== settings.ratings.join() ||
      previous.engineDepth !== settings.engineDepth ||
      previous.engineLines !== settings.engineLines;

    if (previous.mode === 'engine' && settings.mode !== 'engine') stopEngine();

    if (queryChanged || (options && options.force)) {
      currentFen = null;
      scheduleSync();
    } else {
      ui.render();
    }
  }

  function saveSettings(patch) {
    // Apply locally first so the UI feels instant, then persist. The storage
    // listener below reconciles anything the normalizer rejects.
    applySettings(root.CMPSettings.normalize(Object.assign({}, settings, patch)));
    root.CMPSettings.save(patch);
  }

  function start(loaded) {
    settings = loaded;
    ui = new root.CMPUI({ onSettingsChange: saveSettings });
    ui.setSettings(settings);

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      var patch = {};
      var touched = false;
      Object.keys(changes).forEach(function (key) {
        patch[key] = changes[key].newValue;
        touched = true;
      });
      if (!touched) return;
      applySettings(root.CMPSettings.normalize(Object.assign({}, settings, patch)));
    });

    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'analysis') return false;
      // Results for a position we have already moved on from are discarded.
      if (message.fen !== currentFen || settings.mode !== 'engine') return false;
      if (message.status === 'error') {
        setEngine({ status: 'error', error: message.error, moves: [] });
        return false;
      }
      setEngine({
        status: message.status === 'done' ? 'ready' : 'thinking',
        moves: toSan(message.fen, message.moves || []),
        depth: message.depth || 0,
        nodes: message.nodes || 0,
        error: null
      });
      return false;
    });

    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.type !== 'toggle-panel') return false;
      var showPanel = !(settings.enabled && settings.showPanel);
      saveSettings({ showPanel: showPanel, enabled: true });
      sendResponse({ ok: true, showPanel: showPanel });
      return false;
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleSync();
    });

    // Chess.com is a single-page app: board and move list are swapped in and
    // out without a reload, so a slow poll backs up the mutation observer.
    pollTimer = setInterval(sync, POLL_MS);
    scheduleSync();
  }

  root.CMPSettings.load().then(start);
})(typeof self !== 'undefined' ? self : this);
