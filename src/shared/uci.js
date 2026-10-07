/*
 * Parsing of the UCI text the engine emits, kept free of any DOM or extension
 * API so it can run in the offscreen document and in tests alike.
 */
(function (root) {
  'use strict';

  /**
   * Parses one `info ...` line into a candidate move.
   *
   * Scores arrive from the side-to-move's point of view; everything here keeps
   * that convention, so a positive score always means "good for whoever is
   * about to move". The UI turns that into a white-relative number when it
   * needs one.
   *
   * @returns {null|{multipv:number, depth:number, cp:number|null,
   *                 mate:number|null, pv:string[], nodes:number, nps:number}}
   */
  function parseInfo(line) {
    if (typeof line !== 'string' || line.indexOf('info ') !== 0) return null;
    if (line.indexOf(' pv ') === -1 || line.indexOf(' score ') === -1) return null;
    // Lines about the move currently being searched carry no usable score.
    if (line.indexOf(' currmove ') !== -1) return null;

    var tokens = line.split(/\s+/);
    var out = { multipv: 1, depth: 0, seldepth: 0, cp: null, mate: null, pv: [], nodes: 0, nps: 0 };

    for (var i = 1; i < tokens.length; i++) {
      var token = tokens[i];
      if (token === 'depth') out.depth = Number(tokens[++i]) || 0;
      else if (token === 'seldepth') out.seldepth = Number(tokens[++i]) || 0;
      else if (token === 'multipv') out.multipv = Number(tokens[++i]) || 1;
      else if (token === 'nodes') out.nodes = Number(tokens[++i]) || 0;
      else if (token === 'nps') out.nps = Number(tokens[++i]) || 0;
      else if (token === 'score') {
        var kind = tokens[++i];
        var value = Number(tokens[++i]);
        if (kind === 'cp') out.cp = value;
        else if (kind === 'mate') out.mate = value;
      } else if (token === 'pv') {
        out.pv = tokens.slice(i + 1).filter(Boolean);
        break;
      }
    }

    if (!out.pv.length) return null;
    if (out.cp === null && out.mate === null) return null;
    return out;
  }

  /** `bestmove e2e4 ponder e7e5` -> 'e2e4' */
  function parseBestMove(line) {
    if (typeof line !== 'string' || line.indexOf('bestmove') !== 0) return null;
    var move = line.split(/\s+/)[1];
    return move && move !== '(none)' ? move : null;
  }

  /**
   * Collects `info` lines into one result per candidate move.
   *
   * The engine re-emits every line at each new depth, so a line is only
   * replaced when it comes from a depth at least as deep as the one stored.
   * Lines from a shallower depth (which Stockfish can emit while it is still
   * re-searching after a new depth started) are ignored.
   */
  function Collector(moveCount) {
    this.lines = new Map();
    this.moveCount = moveCount || 1;
    this.depth = 0;
    this.nodes = 0;
    this.nps = 0;
  }

  Collector.prototype.add = function (info) {
    if (!info) return false;
    var previous = this.lines.get(info.multipv);
    if (previous && previous.depth > info.depth) return false;
    this.lines.set(info.multipv, info);
    if (info.depth > this.depth) this.depth = info.depth;
    if (info.nodes) this.nodes = info.nodes;
    if (info.nps) this.nps = info.nps;
    return true;
  };

  /**
   * The candidate moves, best first, each annotated with how much worse than
   * the best move it is (`loss`, in centipawns) — that is what the UI colours
   * the badges by.
   */
  Collector.prototype.result = function () {
    var moves = Array.from(this.lines.values())
      .filter(function (info) { return info.pv.length; })
      .sort(function (a, b) { return a.multipv - b.multipv; })
      .slice(0, this.moveCount)
      .map(function (info) {
        return {
          uci: info.pv[0],
          pv: info.pv.slice(0, 8),
          cp: info.cp,
          mate: info.mate,
          depth: info.depth,
          score: scoreValue(info)
        };
      });

    // multipv order is the engine's own ranking, but a re-search can leave two
    // lines momentarily out of order; sorting by score keeps the UI stable.
    moves.sort(function (a, b) { return b.score - a.score; });
    var best = moves.length ? moves[0].score : 0;
    moves.forEach(function (move) {
      move.loss = best - move.score;
      move.best = move.score === best;
    });

    return {
      depth: this.depth,
      nodes: this.nodes,
      nps: this.nps,
      moves: moves
    };
  };

  /**
   * A single comparable number for sorting: mates rank above every centipawn
   * score, and a faster mate above a slower one.
   */
  function scoreValue(info) {
    if (info.mate !== null && info.mate !== undefined) {
      var distance = Math.abs(info.mate);
      var magnitude = 100000 - distance;
      return info.mate > 0 ? magnitude : -magnitude;
    }
    return info.cp || 0;
  }

  root.CMPUci = {
    parseInfo: parseInfo,
    parseBestMove: parseBestMove,
    Collector: Collector,
    scoreValue: scoreValue
  };
})(typeof self !== 'undefined' ? self : this);
