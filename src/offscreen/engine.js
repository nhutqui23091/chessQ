/*
 * Drives Stockfish over UCI inside the offscreen document.
 *
 * One analysis runs at a time. A new request stops the running search instead
 * of queueing behind it — by the time a user has clicked to the next move, the
 * previous position is no longer interesting.
 */
(function () {
  'use strict';

  var ENGINE_URL = '../vendor/stockfish/stockfish.wasm.js';
  var PROGRESS_INTERVAL_MS = 220;
  // Compiling half a megabyte of WASM is slow on a cold, busy machine, but it
  // is not minutes. Past this, the engine is not coming.
  var READY_TIMEOUT_MS = 25000;

  var worker = null;
  var ready = false;
  var readyWaiters = [];
  var readyTimer = null;
  var bootError = null;
  var current = null;   // the analysis in flight
  var pending = null;   // the one that should start as soon as it stops
  var optionsApplied = { multipv: 0 };

  function send(command) {
    if (worker) worker.postMessage(command);
  }

  function boot() {
    if (worker) return;
    try {
      worker = new Worker(ENGINE_URL);
    } catch (err) {
      // Nobody is waiting yet at first boot, so remember why: the next request
      // can be refused immediately instead of waiting for a ready that will
      // never come.
      engineDied('không tạo được Web Worker: ' + (err && err.message ? err.message : err));
      return;
    }
    worker.onmessage = function (event) {
      handleLine(typeof event.data === 'string' ? event.data : String(event.data));
    };
    worker.onerror = function (event) {
      engineDied(event && event.message ? event.message : 'Stockfish lỗi khi khởi động');
    };
    send('uci');
  }

  /** The engine is not going to answer: tell everyone waiting, and remember. */
  function engineDied(message) {
    bootError = message;
    ready = false;
    clearTimeout(readyTimer);
    readyTimer = null;
    var waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach(function (waiter) { waiter.fail(message); });
    failCurrent(message);
  }

  function whenReady(request, callback) {
    if (ready) {
      callback();
      return;
    }
    if (bootError) {
      failRequest(request, bootError);
      return;
    }
    readyWaiters.push({
      run: callback,
      fail: function (message) { failRequest(request, message); }
    });
    boot();
    if (!readyTimer) {
      readyTimer = setTimeout(function () {
        engineDied('Stockfish không phản hồi sau ' + (READY_TIMEOUT_MS / 1000) + ' giây');
      }, READY_TIMEOUT_MS);
    }
  }

  function handleLine(line) {
    if (line.indexOf('uciok') === 0) {
      send('setoption name Hash value 32');
      send('isready');
      return;
    }
    if (line.indexOf('readyok') === 0) {
      ready = true;
      bootError = null;
      clearTimeout(readyTimer);
      readyTimer = null;
      var waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach(function (waiter) { waiter.run(); });
      return;
    }

    if (!current) return;

    if (line.indexOf('bestmove') === 0) {
      finishCurrent(self.CMPUci.parseBestMove(line));
      return;
    }

    var info = self.CMPUci.parseInfo(line);
    if (!info) return;
    if (!current.collector.add(info)) return;

    var now = Date.now();
    if (now - current.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      current.lastProgressAt = now;
      emit(current, 'progress');
    }
  }

  function emit(analysis, status, extra) {
    var result = analysis.collector.result();
    chrome.runtime.sendMessage(Object.assign({
      type: 'engine-result',
      target: 'background',
      id: analysis.id,
      tabId: analysis.tabId,
      fen: analysis.fen,
      status: status,
      depth: result.depth,
      nodes: result.nodes,
      nps: result.nps,
      moves: result.moves
    }, extra || {}));
  }

  function finishCurrent(bestMove) {
    var analysis = current;
    current = null;
    if (analysis) emit(analysis, 'done', { bestMove: bestMove });
    startPending();
  }

  function failCurrent(message) {
    var analysis = current;
    current = null;
    if (analysis) failRequest(analysis, message);
    var queued = pending;
    pending = null;
    if (queued) failRequest(queued, message);
  }

  /** Reports a request as failed, whether it ever started or not. */
  function failRequest(request, message) {
    if (!request) return;
    chrome.runtime.sendMessage({
      type: 'engine-result',
      target: 'background',
      id: request.id,
      tabId: request.tabId,
      fen: request.fen,
      status: 'error',
      error: message
    }, function () { void chrome.runtime.lastError; });
  }

  function startPending() {
    if (!pending || current) return;
    var next = pending;
    pending = null;
    run(next);
  }

  function run(request) {
    whenReady(request, function () {
      current = {
        id: request.id,
        tabId: request.tabId,
        fen: request.fen,
        collector: new self.CMPUci.Collector(request.lines),
        lastProgressAt: 0
      };
      if (optionsApplied.multipv !== request.lines) {
        send('setoption name MultiPV value ' + request.lines);
        optionsApplied.multipv = request.lines;
      }
      send('ucinewgame');
      send('position fen ' + request.fen);
      send('go depth ' + request.depth);
    });
  }

  function analyze(request) {
    if (current) {
      // Replace whatever was queued: only the newest position matters.
      pending = request;
      send('stop');
      return;
    }
    pending = null;
    run(request);
  }

  function stop() {
    pending = null;
    if (current) send('stop');
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.target !== 'offscreen') return false;
    if (message.type === 'engine-analyze') {
      analyze({
        id: message.id,
        tabId: message.tabId,
        fen: message.fen,
        depth: Math.max(6, Math.min(24, message.depth || 14)),
        lines: Math.max(1, Math.min(8, message.lines || 4))
      });
    } else if (message.type === 'engine-stop') {
      stop();
    } else if (message.type === 'engine-ping') {
      announceReady();
    }
    return false;
  });

  function announceReady() {
    chrome.runtime.sendMessage({ target: 'background', type: 'engine-ready' }, function () {
      void chrome.runtime.lastError;
    });
  }

  // Warm the engine up so the first real request does not pay for the WASM
  // compile as well as the search, and tell the worker we are listening.
  boot();
  announceReady();
})();
