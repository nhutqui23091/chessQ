/*
 * Reads the position currently shown on a Chess.com board and turns it into a
 * FEN string.
 *
 * Two independent sources are used, because Chess.com's markup for the move
 * list changes far more often than the markup for the pieces:
 *
 *   1. The pieces themselves (`<div class="piece wp square-52">`), which give
 *      an exact placement but say nothing about side to move, castling rights
 *      or en passant.
 *   2. The move list, replayed through chess.js, which gives a complete and
 *      exact FEN.
 *
 * The move list is only trusted when the replayed placement matches the pieces
 * on the board — that keeps us correct when the user scrolls back through a
 * game, opens a variation, or loads a puzzle from a custom position. Otherwise
 * we fall back to the piece scan plus heuristics good enough for opening play.
 */
(function (root) {
  'use strict';

  var VERSION = '1.4.0';
  var FILES = 'abcdefgh';
  var PIECE_RE = /(?:^|\s)(?:piece\s+)?([wb])([kqrbnp])(?:\s|$)/;
  var SQUARE_RE = /\bsquare-(\d)(\d)\b/;
  var BOARD_SELECTORS = [
    'wc-chess-board',
    'chess-board',
    '#board-board',
    '#board-single',
    '#board-play-computer',
    '#board-layout-chessboard .board',
    '[class*="board-layout"] [class*="board"]',
    '.board'
  ];
  var SQUARE_CLASS_RE = /\bsquare-[1-8][1-8]\b/;
  var MOVE_LIST_SELECTORS = [
    'wc-simple-move-list',
    'wc-vertical-move-list',
    'wc-horizontal-move-list',
    '.vertical-move-list',
    '.move-list',
    '[class*="move-list"]'
  ];
  var FIGURINES = { pawn: '', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
  var UNICODE_PIECES = {
    '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': '',
    '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': ''
  };

  function classNameOf(el) {
    // SVG elements and custom elements can carry a non-string className.
    var cls = el.getAttribute && el.getAttribute('class');
    if (typeof cls === 'string') return cls;
    return typeof el.className === 'string' ? el.className : '';
  }

  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  /**
   * Every root to search: the document plus any open shadow roots. Chess.com
   * renders the board as a custom element, and a future version of it could
   * put the pieces inside a shadow root where a plain querySelector cannot
   * reach them.
   */
  function roots() {
    var all = [document];
    var hosts = document.querySelectorAll('*');
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].shadowRoot) all.push(hosts[i].shadowRoot);
    }
    return all;
  }

  function queryAll(selector) {
    var out = [];
    var scopes = roots();
    for (var i = 0; i < scopes.length; i++) {
      var found = scopes[i].querySelectorAll(selector);
      for (var j = 0; j < found.length; j++) out.push(found[j]);
    }
    return out;
  }

  /** Every piece element on the page, wherever it lives. */
  function allPieceElements() {
    return queryAll('[class*="square-"]').filter(function (el) {
      var cls = classNameOf(el);
      return cls.indexOf('piece') !== -1 && SQUARE_CLASS_RE.test(cls);
    });
  }

  function closestCommonAncestor(elements) {
    if (!elements.length) return null;
    var ancestor = elements[0].parentElement;
    while (ancestor) {
      var holdsAll = true;
      for (var i = 1; i < elements.length; i++) {
        if (!ancestor.contains(elements[i])) {
          holdsAll = false;
          break;
        }
      }
      if (holdsAll) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  /** The biggest visible board on the page (there is normally exactly one). */
  function findBoard() {
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < BOARD_SELECTORS.length; i++) {
      var found = queryAll(BOARD_SELECTORS[i]);
      for (var j = 0; j < found.length; j++) {
        var el = found[j];
        if (!isVisible(el)) continue;
        if (!el.querySelector('[class*="square-"]')) continue;
        var rect = el.getBoundingClientRect();
        var area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      if (best) break; // earlier selectors are the more specific ones
    }
    if (best) return best;

    // Nothing matched a known selector — Chess.com may have renamed things. The
    // pieces themselves are the one thing that cannot change without breaking
    // the site, so fall back to whatever element contains them all.
    var pieces = allPieceElements();
    if (pieces.length < 2) return null;
    var ancestor = closestCommonAncestor(pieces);
    return ancestor && isVisible(ancestor) ? ancestor : null;
  }

  function signature(el) {
    var cls = classNameOf(el).trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }

  /** The attributes that could carry a square: style, data-*, aria. */
  function interestingAttrs(el) {
    var out = {};
    var attrs = el.attributes || [];
    for (var i = 0; i < attrs.length && i < 12; i++) {
      var name = attrs[i].name;
      if (name === 'class') continue;
      var value = String(attrs[i].value || '');
      out[name] = value.length > 90 ? value.slice(0, 90) + '…' : value;
    }
    return out;
  }

  /**
   * Groups an element's descendants by tag+class and counts them, with one
   * example of each of the commonest shapes. Compact enough to paste into a
   * bug report, detailed enough to write a reader from.
   */
  function describe(el, limit) {
    if (!el) return null;
    var nodes = el.querySelectorAll('*');
    var counts = {};
    var examples = {};
    for (var i = 0; i < nodes.length; i++) {
      var key = signature(nodes[i]);
      counts[key] = (counts[key] || 0) + 1;
      if (!examples[key]) examples[key] = nodes[i];
    }
    var ranked = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var shapes = ranked.slice(0, limit || 12).map(function (key) {
      return { shape: key, count: counts[key], attrs: interestingAttrs(examples[key]) };
    });
    return {
      self: signature(el),
      children: el.children.length,
      descendants: nodes.length,
      shapes: shapes
    };
  }

  /** The element most likely to be the move list, by class name. */
  function findMoveListCandidate() {
    var best = null;
    var bestCount = 0;
    var candidates = queryAll('[class*="move"], [class*="moves"], [class*="notation"]');
    for (var i = 0; i < candidates.length; i++) {
      var count = candidates[i].children.length;
      if (count > bestCount && count < 400) {
        best = candidates[i];
        bestCount = count;
      }
    }
    return best;
  }

  /**
   * What the extension can see on this page. Shown in the panel when no board
   * is found, so a user can report something specific instead of "it does not
   * work" — and detailed enough to write a reader for markup we have never
   * seen.
   */
  function diagnose() {
    var board = findBoard();
    var selectorHits = BOARD_SELECTORS.map(function (selector) {
      return selector + ':' + queryAll(selector).length;
    });
    var moveList = readMoveList();

    // Whatever element looks most like a board, even if we cannot read it.
    var container = board;
    if (!container) {
      var guesses = queryAll('#board-layout-chessboard .board').concat(queryAll('.board'));
      for (var i = 0; i < guesses.length && !container; i++) {
        if (isVisible(guesses[i])) container = guesses[i];
      }
    }

    return {
      url: location.pathname,
      version: VERSION,
      board: board ? signature(board) : null,
      pieces: allPieceElements().length,
      squares: queryAll('[class*="square-"]').length,
      moveNodes: moveList ? moveList.sans.length : 0,
      shadowRoots: roots().length - 1,
      selectors: selectorHits,
      counts: {
        'class*=piece': queryAll('[class*="piece"]').length,
        'data-piece': queryAll('[data-piece]').length,
        img: container ? container.querySelectorAll('img').length : 0,
        svg: container ? container.querySelectorAll('svg').length : 0,
        use: container ? container.querySelectorAll('use').length : 0,
        canvas: container ? container.querySelectorAll('canvas').length : 0
      },
      // A board rendered inside an iframe would explain finding a container but
      // no pieces: this content script only runs in the top frame.
      frames: Array.prototype.slice.call(document.querySelectorAll('iframe'))
        .slice(0, 6)
        .map(function (frame) {
          var rect = frame.getBoundingClientRect();
          return {
            src: (frame.getAttribute('src') || '').slice(0, 80),
            cls: classNameOf(frame).slice(0, 60),
            size: Math.round(rect.width) + 'x' + Math.round(rect.height)
          };
        }),
      boardTree: describe(container, 14),
      moveTree: describe(findMoveListCandidate(), 6)
    };
  }

  function isFlipped(boardEl) {
    return /\bflipped\b/.test(classNameOf(boardEl));
  }

  function squareName(file, rank) {
    return FILES.charAt(file - 1) + rank;
  }

  /**
   * Scans piece elements into a { square: 'P' } map. Uppercase = white.
   * Pieces being dragged are skipped: their square class still points at the
   * origin square while the cursor is somewhere else.
   */
  function scanPieces(boardEl) {
    var nodes = boardEl.querySelectorAll('[class*="square-"]');
    var pieces = {};
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cls = classNameOf(el);
      if (cls.indexOf('piece') === -1) continue;
      if (/\b(dragging|promotion-piece|ghost)\b/.test(cls)) continue;
      var pieceMatch = PIECE_RE.exec(cls);
      var squareMatch = SQUARE_RE.exec(cls);
      if (!pieceMatch || !squareMatch) continue;
      var file = Number(squareMatch[1]);
      var rank = Number(squareMatch[2]);
      if (file < 1 || file > 8 || rank < 1 || rank > 8) continue;
      var letter = pieceMatch[2].toUpperCase();
      pieces[squareName(file, rank)] = pieceMatch[1] === 'w' ? letter : letter.toLowerCase();
      count++;
    }
    return count ? pieces : null;
  }

  /** FEN placement field (the part before the first space). */
  function placementOf(pieces) {
    var rows = [];
    for (var rank = 8; rank >= 1; rank--) {
      var row = '';
      var empty = 0;
      for (var file = 1; file <= 8; file++) {
        var piece = pieces[squareName(file, rank)];
        if (piece) {
          if (empty) {
            row += empty;
            empty = 0;
          }
          row += piece;
        } else {
          empty++;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  /** Squares Chess.com highlights for the last move (origin + destination). */
  function highlightedSquares(boardEl) {
    var nodes = boardEl.querySelectorAll('[class*="highlight"]');
    var squares = [];
    for (var i = 0; i < nodes.length; i++) {
      var cls = classNameOf(nodes[i]);
      if (/\b(hover|arrow|effect)\b/.test(cls)) continue;
      var m = SQUARE_RE.exec(cls);
      if (!m) continue;
      var name = squareName(Number(m[1]), Number(m[2]));
      if (squares.indexOf(name) === -1) squares.push(name);
    }
    // More than two means the user has marked squares by hand; ignore those.
    return squares.length === 2 ? squares : null;
  }

  /** Side to move inferred from the colour of the piece on the last move's destination. */
  function turnFromHighlights(boardEl, pieces) {
    var squares = highlightedSquares(boardEl);
    if (!squares) return null;
    var occupied = squares.filter(function (sq) { return pieces[sq]; });
    if (occupied.length !== 1) return null;
    var piece = pieces[occupied[0]];
    return piece === piece.toUpperCase() ? 'b' : 'w';
  }

  /** Castling rights assumed from king/rook still sitting on their home squares. */
  function castlingFromPlacement(pieces) {
    var rights = '';
    if (pieces.e1 === 'K') {
      if (pieces.h1 === 'R') rights += 'K';
      if (pieces.a1 === 'R') rights += 'Q';
    }
    if (pieces.e8 === 'k') {
      if (pieces.h8 === 'r') rights += 'k';
      if (pieces.a8 === 'r') rights += 'q';
    }
    return rights || '-';
  }

  /** En passant square, but only when a pawn could actually capture there. */
  function epFromHighlights(boardEl, pieces, turn) {
    var squares = highlightedSquares(boardEl);
    if (!squares) return '-';
    var from = squares[0];
    var to = squares[1];
    if (pieces[from] && !pieces[to]) {
      var swap = from;
      from = to;
      to = swap;
    }
    var moved = pieces[to];
    if (!moved || moved.toLowerCase() !== 'p') return '-';
    if (from.charAt(0) !== to.charAt(0)) return '-';
    var fromRank = Number(from.charAt(1));
    var toRank = Number(to.charAt(1));
    if (Math.abs(fromRank - toRank) !== 2) return '-';

    var file = FILES.indexOf(to.charAt(0)) + 1;
    var capturer = turn === 'w' ? 'P' : 'p';
    var hasCapturer = [file - 1, file + 1].some(function (f) {
      return f >= 1 && f <= 8 && pieces[squareName(f, toRank)] === capturer;
    });
    if (!hasCapturer) return '-';
    return to.charAt(0) + ((fromRank + toRank) / 2);
  }

  var NODE_SELECTOR = '[class*="node"], [data-ply]';

  /** Keeps only the deepest matches, so wrappers don't produce duplicate moves. */
  function innermost(elements) {
    return elements.filter(function (el) {
      return !el.querySelector(NODE_SELECTOR);
    });
  }

  function cleanSan(raw) {
    var text = String(raw || '');
    text = text.replace(/[♔-♟]/g, function (ch) { return UNICODE_PIECES[ch] || ''; });
    text = text.replace(/\s+/g, '');
    // Castling first: "0-0-0" must not lose its leading 0 to the move-number rule.
    text = text.replace(/[0O]-[0O](-[0O])?/g, function (m) { return m.replace(/0/g, 'O'); });
    text = text.replace(/^\d+\.+/, '');          // stray "12." move numbers
    text = text.replace(/[^a-zA-Z0-9=+#-]/g, ''); // !, ?, ⩲, arrows, NAGs…
    text = text.replace(/[!?+#]+$/, '');
    return text;
  }

  function sanFromNode(el) {
    var prefix = '';
    var figurine = el.getAttribute && el.getAttribute('data-figurine');
    var icon = el.querySelector('[data-figurine], [class*="icon-font-chess"], [class*="figurine"]');
    if (!figurine && icon) figurine = icon.getAttribute('data-figurine');
    if (figurine) {
      prefix = figurine.toUpperCase() === 'P' ? '' : figurine.toUpperCase();
    } else if (icon) {
      var name = /(pawn|knight|bishop|rook|queen|king)/.exec(classNameOf(icon));
      if (name) prefix = FIGURINES[name[1]];
    }
    var san = cleanSan(el.textContent);
    if (prefix && san && /^[a-h]/.test(san)) san = prefix + san;
    return san;
  }

  function looksLikeSan(san) {
    return /^(O-O(-O)?|[KQRBN][a-h1-8]{0,2}x?[a-h][1-8]|[a-h](x[a-h])?[1-8](=[QRBN])?)$/.test(san);
  }

  /** The SAN moves shown in the move list, cut off at the selected move. */
  function readMoveList() {
    var container = null;
    for (var i = 0; i < MOVE_LIST_SELECTORS.length && !container; i++) {
      var candidates = document.querySelectorAll(MOVE_LIST_SELECTORS[i]);
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].querySelector(NODE_SELECTOR)) {
          container = candidates[j];
          break;
        }
      }
    }
    if (!container) return null;

    var raw = container.querySelectorAll(NODE_SELECTOR);
    var nodes = innermost(Array.prototype.slice.call(raw));
    var sans = [];
    var elements = [];
    for (var k = 0; k < nodes.length; k++) {
      var san = sanFromNode(nodes[k]);
      if (!looksLikeSan(san)) continue;
      sans.push(san);
      elements.push(nodes[k]);
    }
    if (!sans.length) return null;

    var selected = sans.length;
    for (var n = 0; n < elements.length; n++) {
      var el = elements[n];
      var marked = /\bselected\b/.test(classNameOf(el)) ||
        !!el.querySelector('[class*="selected"]') ||
        (el.parentElement && /\bselected\b/.test(classNameOf(el.parentElement)));
      if (marked) selected = n + 1;
    }
    return { sans: sans, selected: selected };
  }

  function replay(sans, count) {
    if (!root.ChessLib || !root.ChessLib.Chess) return null;
    var game = new root.ChessLib.Chess();
    for (var i = 0; i < count; i++) {
      try {
        if (!game.move(sans[i], { strict: false })) return null;
      } catch (err) {
        return null;
      }
    }
    return game;
  }

  /**
   * @returns {null|{fen:string, board:Element, flipped:boolean, turn:string,
   *                 source:'move-list'|'board-scan', ply:number}}
   */
  function readPosition() {
    var boardEl = findBoard();
    if (!boardEl) return null;
    var pieces = scanPieces(boardEl);
    if (!pieces) return null;

    var placement = placementOf(pieces);
    var moveList = readMoveList();

    if (moveList) {
      var game = replay(moveList.sans, moveList.selected);
      if (game && game.fen().split(' ')[0] === placement) {
        return {
          fen: game.fen(),
          board: boardEl,
          flipped: isFlipped(boardEl),
          turn: game.turn(),
          source: 'move-list',
          ply: moveList.selected
        };
      }
    }

    var turn = turnFromHighlights(boardEl, pieces);
    if (!turn && moveList) turn = moveList.selected % 2 === 0 ? 'w' : 'b';
    if (!turn) turn = 'w';

    var fen = [
      placement,
      turn,
      castlingFromPlacement(pieces),
      epFromHighlights(boardEl, pieces, turn),
      '0',
      '1'
    ].join(' ');

    return {
      fen: fen,
      board: boardEl,
      flipped: isFlipped(boardEl),
      turn: turn,
      source: 'board-scan',
      ply: moveList ? moveList.selected : -1
    };
  }

  root.CMPPosition = {
    readPosition: readPosition,
    findBoard: findBoard,
    diagnose: diagnose,
    describe: describe,
    allPieceElements: allPieceElements,
    isFlipped: isFlipped,
    scanPieces: scanPieces,
    placementOf: placementOf,
    cleanSan: cleanSan,
    FILES: FILES
  };
})(typeof self !== 'undefined' ? self : this);
