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

  var worker = null;
  var ready = false;
  var readyWaiters = [];
  var current = null;   // the analysis in flight
  var pending = null;   // the one that should start as soon as it stops
  var optionsApplied = { multipv: 0 };

  function send(command) {
    if (worker) worker.postMessage(command);
  }

  function boot() {
    if (worker) return;
    worker = new Worker(ENGINE_URL);
    worker.onmessage = function (event) {
      handleLine(typeof event.data === 'string' ? event.data : String(event.data));
    };
    worker.onerror = function (event) {
      failCurrent('engine error: ' + (event.message || 'không khởi động được Stockfish'));
    };
    send('uci');
  }

  function whenReady(callback) {
    if (ready) {
      callback();
      return;
    }
    readyWaiters.push(callback);
    boot();
  }

  function handleLine(line) {
    if (line.indexOf('uciok') === 0) {
      send('setoption name Hash value 32');
      send('isready');
      return;
    }
    if (line.indexOf('readyok') === 0) {
      ready = true;
      var waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach(function (callback) { callback(); });
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
    if (analysis) {
      chrome.runtime.sendMessage({
        type: 'engine-result',
        target: 'background',
        id: analysis.id,
        fen: analysis.fen,
        status: 'error',
        error: message
      });
    }
    startPending();
  }

  function startPending() {
    if (!pending || current) return;
    var next = pending;
    pending = null;
    run(next);
  }

  function run(request) {
    whenReady(function () {
      current = {
        id: request.id,
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
