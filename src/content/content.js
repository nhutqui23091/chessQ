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
  var boardEl = null;
  var observer = null;
  var pollTimer = null;
  var debounceTimer = null;

  function requestStats(position) {
    var token = ++requestToken;
    var fen = position.fen;
    ui.setState({ status: 'loading', data: null, position: position });
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
            error: (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              'không nhận được phản hồi'
          });
          return;
        }
        if (!response.ok) {
          ui.setState({ status: 'error', data: null, position: position, error: response.error });
          return;
        }
        ui.setState({ status: 'ready', data: response.data, position: position });
      });
    } catch (err) {
      // Happens when the extension is reloaded while the page stays open.
      ui.setState({ status: 'error', data: null, position: position, error: 'mất kết nối tiện ích' });
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
        ui.setState({ status: 'no-board', data: null, position: null });
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
    requestStats(position);
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
      ui.setState({ status: 'idle', data: null, position: null });
      return;
    }

    var queryChanged = previous.database !== settings.database ||
      previous.speeds.join() !== settings.speeds.join() ||
      previous.ratings.join() !== settings.ratings.join();

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
