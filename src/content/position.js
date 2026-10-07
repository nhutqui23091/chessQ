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

  var VERSION = '1.6.0';
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
  var VI_FIGURINES = { 'tốt': '', 'mã': 'N', 'tượng': 'B', 'xe': 'R', 'hậu': 'Q', 'vua': 'K' };
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

  var shadowCache = { at: 0, roots: [] };
  var SHADOW_TTL_MS = 2000;

  /**
   * Open shadow roots on the page. Finding them means walking every element,
   * so the list is cached: this runs behind a poll and the page is large.
   */
  function shadowRoots() {
    var now = Date.now();
    if (now - shadowCache.at < SHADOW_TTL_MS) return shadowCache.roots;
    var found = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) found.push(all[i].shadowRoot);
    }
    shadowCache = { at: now, roots: found };
    return found;
  }

  /** Every root to search: the document plus any open shadow roots. */
  function roots() {
    return [document].concat(shadowRoots());
  }

  /**
   * Elements matching a selector. The light DOM is searched first and the
   * shadow roots only when it comes up empty — walking the page for shadow
   * hosts costs far more than the query itself, and Chess.com's board has
   * never been inside one.
   */
  function queryAll(selector) {
    var direct = document.querySelectorAll(selector);
    if (direct.length) return Array.prototype.slice.call(direct);

    var out = [];
    var scopes = shadowRoots();
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

  var boardCache = { at: 0, el: null };
  var BOARD_TTL_MS = 2000;

  /**
   * The biggest visible board on the page (there is normally exactly one).
   * Cached: the selectors are attribute-substring matches, which are the most
   * expensive thing this file does, and this runs behind a poll. The cache is
   * dropped as soon as the element leaves the page, and expires anyway so a
   * board swapped in by the single-page app is picked up.
   */
  function findBoard() {
    if (boardCache.el && boardCache.el.isConnected && isVisible(boardCache.el) &&
        Date.now() - boardCache.at < BOARD_TTL_MS) {
      return boardCache.el;
    }
    var found = searchForBoard();
    boardCache = { at: Date.now(), el: found };
    return found;
  }

  function searchForBoard() {
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
    if (pieces.length >= 2) {
      var ancestor = closestCommonAncestor(pieces);
      if (ancestor && isVisible(ancestor)) return ancestor;
    }

    // Still nothing: the board may render its pieces in a way we cannot read
    // at all (a canvas, a closed shadow root). A big square element is still
    // worth having — the badges need somewhere to sit, and the position can
    // come from the move list instead.
    return findSquareElement();
  }

  /** A large, roughly square element: the shape of a chessboard. */
  function findSquareElement() {
    var best = null;
    var bestArea = 0;
    var candidates = queryAll(BOARD_SELECTORS.join(','));
    for (var i = 0; i < candidates.length; i++) {
      var rect = candidates[i].getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) continue;
      if (Math.abs(rect.width - rect.height) > rect.width * 0.06) continue;
      var area = rect.width * rect.height;
      if (area > bestArea) {
        best = candidates[i];
        bestArea = area;
      }
    }
    return best;
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
      moveNodes: moveList ? moveList.moves.length : 0,
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

  /**
   * Board orientation. The `flipped` class is the usual signal, but Chess.com
   * also draws rank numbers into the board: whichever rank label sits highest
   * tells us which way round the board is, whatever the classes are called.
   */
  function isFlipped(boardEl) {
    if (/\bflipped\b/.test(classNameOf(boardEl))) return true;
    var fromLabels = flippedFromCoordinates(boardEl);
    return fromLabels === null ? false : fromLabels;
  }

  function flippedFromCoordinates(boardEl) {
    if (!boardEl) return null;
    var labels = boardEl.querySelectorAll('text');
    var topRank = null;
    var topY = Infinity;
    for (var i = 0; i < labels.length; i++) {
      var text = (labels[i].textContent || '').trim();
      if (!/^[1-8]$/.test(text)) continue;
      var y = parseFloat(labels[i].getAttribute('y'));
      if (isNaN(y) || y >= topY) continue;
      topY = y;
      topRank = Number(text);
    }
    if (topRank === null) return null;
    // Rank 8 at the top means white is at the bottom: not flipped.
    return topRank < 5;
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

  /**
   * The piece letter a figurine glyph stands for, from however the glyph is
   * drawn: an attribute, a class, an image, an SVG sprite, a label, or the
   * Unicode character itself. Returns '' for a pawn and null when unknown.
   */
  /**
   * @param useClass whether the element's class may be read. Hashed class
   *        names are a minefield for the sprite-code pattern below — a class
   *        like "a7Bq" reads as "black queen" — so it is only trusted on an
   *        element that is plainly a glyph, never on the move itself.
   */
  function figurineLetter(el, useClass) {
    if (!el || !el.getAttribute) return null;

    var figurine = el.getAttribute('data-figurine') || el.getAttribute('data-piece');
    if (figurine) {
      var code = figurine.length > 1 ? figurine.charAt(1) : figurine.charAt(0);
      return code.toUpperCase() === 'P' ? '' : code.toUpperCase();
    }

    var haystack = [
      useClass ? classNameOf(el) : '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('alt') || '',
      el.getAttribute('title') || '',
      el.getAttribute('src') || '',
      el.getAttribute('href') || '',
      el.getAttribute('xlink:href') || ''
    ].join(' ').toLowerCase();

    var named = /(pawn|knight|bishop|rook|queen|king|tốt|mã|tượng|xe|hậu|vua)/.exec(haystack);
    if (named) {
      return FIGURINES[named[1]] !== undefined ? FIGURINES[named[1]] : VI_FIGURINES[named[1]];
    }

    // Sprite names like "wn.svg", "#wn", "piece wn" — the code must be a whole
    // token, so that a hashed class cannot be mistaken for one.
    var coded = /(?:^|[\s/_#.-])([wb])([kqrbnp])(?=$|[\s/_#.-])/.exec(haystack);
    if (coded) return coded[2].toUpperCase() === 'P' ? '' : coded[2].toUpperCase();

    var glyph = /[\u2654-\u265F]/.exec(el.textContent || '');
    if (glyph) return UNICODE_PIECES[glyph[0]];

    // A CSS sprite names the piece in its URL.
    if (useClass && root.getComputedStyle) {
      try {
        var background = root.getComputedStyle(el).backgroundImage || '';
        var fromBackground = /(?:^|[\s/_#.(-])([wb])([kqrbnp])(?=$|[\s/_#.)-])/
          .exec(background.toLowerCase());
        if (fromBackground) {
          return fromBackground[2].toUpperCase() === 'P' ? '' : fromBackground[2].toUpperCase();
        }
      } catch (err) { /* detached node */ }
    }

    return null;
  }

  /**
   * A move as read from the page: the text that was legible, the piece letter
   * if the glyph could be identified, and whether a glyph was there at all.
   *
   * Chess.com draws the piece as an image, so the text of "Nxd4" reads only
   * "xd4". Knowing merely that a glyph exists is enough: it rules out a pawn
   * move, and the rules of chess settle the rest.
   */
  function moveEntry(el) {
    var text = cleanSan(el.textContent);
    var letter = null;
    var glyph = false;

    // The move element itself: attributes only, never its class.
    var own = figurineLetter(el, false);
    if (own !== null && !/^[KQRBN]/.test(text)) {
      letter = own;
      glyph = true;
    }
    // The glyph can be nested — <svg><use href="#wn"> — so look past the
    // immediate children. Capped: this only runs for moves that have a glyph.
    var inside = el.querySelectorAll('*');
    for (var i = 0; i < inside.length && i < 8 && letter === null; i++) {
      var child = figurineLetter(inside[i], true);
      if (child !== null) {
        letter = child;
        glyph = true;
      }
    }
    if (!glyph && el.childElementCount) glyph = true; // a glyph we could not read
    return { text: text, letter: letter, glyph: glyph };
  }

  /** Text that could be a move, including "xd4" where the piece was an image. */
  function looksLikeMoveText(text) {
    return /^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)$/.test(text);
  }

  function looksLikeSan(san) {
    return /^(O-O(-O)?|[KQRBN][a-h1-8]{0,2}x?[a-h][1-8]|[a-h](x[a-h])?[1-8](=[QRBN])?)$/.test(san);
  }

  /** The SAN moves shown in the move list, cut off at the selected move. */
  function readMoveListBySelector() {
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
    return extractFromContainer(container);
  }

  /** Pulls the moves out of a classic Chess.com move-list container. */
  function extractFromContainer(container) {
    var raw = container.querySelectorAll(NODE_SELECTOR);
    var nodes = innermost(Array.prototype.slice.call(raw));
    var moves = [];
    var elements = [];
    for (var k = 0; k < nodes.length; k++) {
      var entry = moveEntry(nodes[k]);
      if (!looksLikeMoveText(entry.text)) continue;
      moves.push(entry);
      elements.push(nodes[k]);
    }
    if (!moves.length) return null;

    return {
      container: container,
      moves: moves,
      selected: selectedIndexOf(elements, container),
      source: 'selector'
    };
  }

  // Finding the move list means querying the whole page — by selector, or by
  // reading every element's text. Affordable once, not on every poll, so the
  // container is remembered and later reads only look inside it. The full
  // search runs again the moment it leaves the page or stops holding moves.
  var moveCache = { container: null, kind: null };

  /** The move list, by selector if possible and by content otherwise. */
  function readMoveList() {
    if (moveCache.container && moveCache.container.isConnected) {
      var again = moveCache.kind === 'selector'
        ? extractFromContainer(moveCache.container)
        : readTextMoves(moveCache.container);
      if (again && again.moves.length) return again;
      moveCache = { container: null, kind: null };
    }

    var bySelector = readMoveListBySelector();
    if (bySelector && bySelector.moves.length) {
      moveCache = { container: bySelector.container, kind: 'selector' };
      return bySelector;
    }

    var found = findMoveNodesByText();
    if (!found || !found.moves.length) return null;
    moveCache = { container: found.container, kind: 'text' };
    return readTextMoves(found.container, found);
  }

  function readTextMoves(container, known) {
    var found = known || collectMovesFrom(container);
    if (!found || !found.moves.length) return null;
    return {
      container: container,
      moves: found.moves,
      selected: selectedIndexOf(found.nodes, container),
      source: 'text'
    };
  }

  /**
   * Finds the move list by what it says rather than what it is called.
   *
   * Chess.com renames its CSS classes; it cannot rename the moves themselves.
   * This collects every leaf element whose text reads as a move, then picks
   * the ancestor holding the most of them — that container is the move list,
   * whatever its markup.
   */
  /** Reads the moves out of a container already known to hold them. */
  function collectMovesFrom(container) {
    var nodes = [];
    var moves = [];
    var all = container.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.childElementCount > 1) continue;
      var raw = el.textContent;
      if (!raw || raw.length > 12) continue;
      var text = cleanSan(raw);
      if (!text || text.length > 7 || !looksLikeMoveText(text)) continue;
      nodes.push(el);
      // Only elements holding a glyph pay for the figurine lookup.
      moves.push(el.childElementCount === 0
        ? { text: text, letter: null, glyph: false }
        : moveEntry(el));
    }
    return moves.length ? { container: container, nodes: nodes, moves: moves } : null;
  }

  function findMoveNodesByText() {
    var hits = [];
    var sans = [];
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // A move is a leaf, or a leaf plus a figurine glyph.
      if (el.childElementCount > 1) continue;
      var raw = el.textContent;
      if (!raw || raw.length > 12) continue;
      var text = cleanSan(raw);
      if (!text || text.length > 7 || !looksLikeMoveText(text)) continue;
      hits.push(el);
      // Only elements holding a glyph pay for the figurine lookup, which costs
      // DOM access — the rest are read straight from their text.
      sans.push(el.childElementCount === 0
        ? { text: text, letter: null, glyph: false }
        : moveEntry(el));
    }
    if (hits.length < 2) return null;

    // Which ancestor is the move list? Not simply the one holding the most
    // moves — <body> holds every one of them, including a move quoted in the
    // chat. Score by count AND density (count² / descendants) so a tight
    // cluster of moves beats a large container that merely encloses it, while
    // the real list still beats one of its own rows.
    var counts = new Map();
    for (var h = 0; h < hits.length; h++) {
      var node = hits[h].parentElement;
      for (var up = 0; up < 5 && node; up++) {
        counts.set(node, (counts.get(node) || 0) + 1);
        node = node.parentElement;
      }
    }

    var container = null;
    var bestScore = 0;
    counts.forEach(function (count, node) {
      if (count < 2) return;
      if (node === document.body || node === document.documentElement) return;
      var size = node.querySelectorAll('*').length || 1;
      var score = (count * count) / size;
      if (score > bestScore) {
        container = node;
        bestScore = score;
      }
    });
    if (!container) return null;

    var nodes = [];
    var moves = [];
    for (var k = 0; k < hits.length; k++) {
      if (!container.contains(hits[k])) continue;
      nodes.push(hits[k]);
      moves.push(sans[k]);
    }
    return { container: container, nodes: nodes, moves: moves };
  }

  function selectedIndexOf(nodes, container) {
    var selected = nodes.length;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var marked = false;
      // The marker can sit on the move or on a wrapper up to the container.
      for (var node = el; node && node !== container; node = node.parentElement) {
        var cls = classNameOf(node);
        if (/\b(selected|active|current)\b/.test(cls) ||
            node.getAttribute('aria-current') === 'true') {
          marked = true;
          break;
        }
      }
      if (marked) selected = i + 1;
    }
    return selected;
  }

  /**
   * Works out which legal move the page meant.
   *
   * The text alone is often incomplete — "xd4" for Nxd4, "f3" for Nf3 — so it
   * is matched against the moves that are actually legal here. A glyph next to
   * the text means a piece moved, which rules out the pawn reading. When two
   * legal moves still fit, this gives up rather than guess: a wrong move would
   * silently poison every position after it.
   */
  function resolveCandidates(game, entry) {
    var text = entry.text;
    if (!text) return [];
    var legal = game.moves();
    var candidates = [];

    for (var i = 0; i < legal.length; i++) {
      var bare = legal[i].replace(/[+#]/g, '');
      if (entry.letter && bare === entry.letter + text) return [legal[i]];
      var isPawnMove = /^[a-h]/.test(bare);
      if (bare === text) {
        candidates.push({ san: legal[i], exact: true, pawn: isPawnMove });
      } else if (bare.length > text.length && bare.slice(-text.length) === text) {
        candidates.push({ san: legal[i], exact: false, pawn: isPawnMove });
      }
    }
    if (!candidates.length) return [];

    var pool = candidates;
    if (entry.glyph) {
      // A glyph was drawn, so a piece moved, not a pawn.
      var pieceMoves = candidates.filter(function (c) { return !c.pawn; });
      if (pieceMoves.length) pool = pieceMoves;
    } else {
      var exact = candidates.filter(function (c) { return c.exact; });
      if (exact.length) pool = exact;
    }
    return pool.map(function (c) { return c.san; });
  }

  /**
   * Replays the move list, searching when a move is ambiguous.
   *
   * Chess.com draws piece letters as images; when the image says nothing about
   * which piece it is, "xd4" could be Nxd4 or Qxd4. Trying both and continuing
   * usually settles it, because the wrong one makes a later move impossible.
   * If two readings both survive to the end, this returns nothing rather than
   * pick one — a wrong game would mean confidently wrong advice.
   */
  function replay(entries, count) {
    if (!root.ChessLib || !root.ChessLib.Chess) return null;
    var game = new root.ChessLib.Chess();
    var state = { budget: 400, solutions: 0, fen: null };
    search(game, entries, 0, count, state);
    if (state.solutions !== 1) return null;
    return new root.ChessLib.Chess(state.fen);
  }

  function search(game, entries, index, count, state) {
    if (index >= count) {
      state.solutions++;
      if (state.solutions === 1) state.fen = game.fen();
      return;
    }
    var entry = entries[index];
    if (!entry) return;
    var options = resolveCandidates(game, entry);
    for (var i = 0; i < options.length && state.solutions < 2; i++) {
      if (state.budget-- <= 0) return;
      try {
        if (!game.move(options[i])) continue;
      } catch (err) {
        continue;
      }
      search(game, entries, index + 1, count, state);
      game.undo();
    }
  }

  /**
   * @returns {null|{fen:string, board:Element, flipped:boolean, turn:string,
   *                 source:'move-list'|'board-scan', ply:number}}
   */
  function readPosition() {
    var boardEl = findBoard();
    var pieces = boardEl ? scanPieces(boardEl) : null;
    var moveList = readMoveList();
    var placement = pieces ? placementOf(pieces) : null;

    if (moveList) {
      var game = replay(moveList.moves, moveList.selected);
      if (game) {
        // With readable pieces the replay is only trusted when it matches what
        // is on the board, which is what keeps variations and puzzles correct.
        if (placement && game.fen().split(' ')[0] === placement) {
          return {
            fen: game.fen(),
            board: boardEl,
            flipped: isFlipped(boardEl),
            turn: game.turn(),
            source: 'move-list',
            ply: moveList.selected
          };
        }
        // Without readable pieces there is nothing to check it against, but a
        // move list that replays cleanly from the opening position is still a
        // real game — and it is all we have.
        if (!placement) {
          return {
            fen: game.fen(),
            board: boardEl,
            flipped: boardEl ? isFlipped(boardEl) : false,
            turn: game.turn(),
            source: 'move-list-only',
            ply: moveList.selected
          };
        }
      }
    }

    if (!pieces) return null;

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
    flippedFromCoordinates: flippedFromCoordinates,
    findSquareElement: findSquareElement,
    scanPieces: scanPieces,
    placementOf: placementOf,
    cleanSan: cleanSan,
    FILES: FILES
  };
})(typeof self !== 'undefined' ? self : this);
