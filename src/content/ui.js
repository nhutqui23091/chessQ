/*
 * All of the extension's own DOM: a draggable statistics panel and the
 * percentage badges drawn on top of the board.
 *
 * The overlay is appended to <body> and positioned with `fixed` coordinates
 * taken from the board's bounding box, which keeps it out of Chess.com's own
 * stacking contexts (boards sit inside containers that clip and transform
 * their children).
 */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';
  var SPEED_LABELS = {
    ultraBullet: 'UltraBullet',
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical',
    correspondence: 'Thư tín'
  };

  function h(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  function formatPercent(value) {
    if (value >= 10) return Math.round(value) + '%';
    if (value >= 1) return value.toFixed(1) + '%';
    return value.toFixed(2).replace(/0$/, '') + '%';
  }

  function UI(callbacks) {
    this.callbacks = callbacks || {};
    this.settings = root.CMPSettings.DEFAULTS;
    this.state = { status: 'idle', data: null, position: null };
    this.hoveredUci = null;
    // Set when the user explicitly asks for the panel (toolbar icon / Alt+P).
    // An explicit request always wins over the "no board here" auto-hide,
    // otherwise clicking the icon appears to do nothing at all.
    this.forcedVisible = false;
    this.panel = null;
    this.overlay = null;
    this.frame = null;
    this.lastBoardRect = '';
    this.build();
  }

  UI.prototype.build = function () {
    this.buildPanel();
    this.buildOverlay();
    this.trackBoardGeometry();
  };

  // ---------------------------------------------------------------- panel ---

  UI.prototype.buildPanel = function () {
    var self = this;
    var panel = h('div', 'cmp-panel cmp-hidden');
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Thống kê % nước đi');

    var head = h('div', 'cmp-head');
    var title = h('div', 'cmp-title');
    title.appendChild(h('span', 'cmp-dot'));
    title.appendChild(h('span', null, '% nước đi'));

    var modes = h('div', 'cmp-modes');
    [['explorer', 'Thống kê', 'Tần suất nước đi trong hàng triệu ván'],
     ['engine', 'Máy', 'Điểm số Stockfish cho từng nước (chỉ trên bàn phân tích)']
    ].forEach(function (entry) {
      var button = h('button', 'cmp-mode', entry[1]);
      button.dataset.mode = entry[0];
      button.title = entry[2];
      button.addEventListener('click', function () {
        self.emit({ mode: entry[0] });
      });
      modes.appendChild(button);
    });

    var gear = h('button', 'cmp-icon-btn', '⚙');
    gear.title = 'Tùy chọn bộ lọc';
    gear.addEventListener('click', function () {
      panel.classList.toggle('cmp-settings-open');
    });

    var collapse = h('button', 'cmp-icon-btn cmp-collapse', '–');
    collapse.title = 'Thu gọn';
    collapse.addEventListener('click', function () {
      self.emit({ panelCollapsed: !self.settings.panelCollapsed });
    });

    var close = h('button', 'cmp-icon-btn', '×');
    close.title = 'Ẩn bảng (Alt+P để hiện lại)';
    close.addEventListener('click', function () {
      self.emit({ showPanel: false });
    });

    head.appendChild(title);
    head.appendChild(modes);
    head.appendChild(gear);
    head.appendChild(collapse);
    head.appendChild(close);

    var body = h('div', 'cmp-body');
    var diagnosis = h('div', 'cmp-diagnosis');
    var meta = h('div', 'cmp-meta');
    var totals = h('div', 'cmp-totals');
    var list = h('div', 'cmp-moves');
    var status = h('div', 'cmp-status');
    var settingsBox = this.buildSettings();

    body.appendChild(diagnosis);
    body.appendChild(meta);
    body.appendChild(totals);
    body.appendChild(settingsBox);
    body.appendChild(list);
    body.appendChild(status);

    panel.appendChild(head);
    panel.appendChild(body);
    document.body.appendChild(panel);

    list.addEventListener('mouseleave', function () {
      self.setHovered(null);
    });

    this.panel = panel;
    this.els = {
      head: head,
      modes: modes,
      collapse: collapse,
      meta: meta,
      diagnosis: diagnosis,
      totals: totals,
      list: list,
      status: status
    };

    this.makeDraggable(head);
  };

  UI.prototype.buildSettings = function () {
    var self = this;
    var box = h('div', 'cmp-settings');

    var dbRow = h('div', 'cmp-field cmp-explorer-only');
    dbRow.appendChild(h('div', 'cmp-field-label', 'Nguồn dữ liệu'));
    var dbSelect = h('select', 'cmp-db');
    [['lichess', 'Ván của người chơi Lichess'], ['masters', 'Ván của kiện tướng (OTB)']]
      .forEach(function (pair) {
        var option = h('option', null, pair[1]);
        option.value = pair[0];
        dbSelect.appendChild(option);
      });
    dbSelect.addEventListener('change', function () {
      self.emit({ database: dbSelect.value });
    });
    dbRow.appendChild(dbSelect);

    var speedRow = h('div', 'cmp-field cmp-explorer-only');
    speedRow.appendChild(h('div', 'cmp-field-label', 'Thể loại'));
    var speedChips = h('div', 'cmp-chips');
    root.CMPSettings.SPEED_OPTIONS.forEach(function (speed) {
      var chip = h('button', 'cmp-chip', SPEED_LABELS[speed] || speed);
      chip.dataset.speed = speed;
      chip.addEventListener('click', function () {
        var next = self.settings.speeds.slice();
        var at = next.indexOf(speed);
        if (at === -1) next.push(speed);
        else next.splice(at, 1);
        if (!next.length) return;
        self.emit({ speeds: next });
      });
      speedChips.appendChild(chip);
    });
    speedRow.appendChild(speedChips);

    var ratingRow = h('div', 'cmp-field cmp-explorer-only');
    ratingRow.appendChild(h('div', 'cmp-field-label', 'Mức Elo'));
    var ratingChips = h('div', 'cmp-chips');
    root.CMPSettings.RATING_OPTIONS.forEach(function (rating) {
      var chip = h('button', 'cmp-chip', rating === 0 ? '<1000' : String(rating));
      chip.dataset.rating = String(rating);
      chip.addEventListener('click', function () {
        var next = self.settings.ratings.slice();
        var at = next.indexOf(rating);
        if (at === -1) next.push(rating);
        else next.splice(at, 1);
        if (!next.length) return;
        self.emit({ ratings: next });
      });
      ratingChips.appendChild(chip);
    });
    ratingRow.appendChild(ratingChips);

    var depthRow = h('div', 'cmp-field cmp-engine-only');
    depthRow.appendChild(h('div', 'cmp-field-label', 'Độ sâu phân tích'));
    var depthWrap = h('div', 'cmp-range');
    var depthInput = h('input');
    depthInput.type = 'range';
    depthInput.min = '8';
    depthInput.max = '22';
    depthInput.step = '1';
    var depthValue = h('span', 'cmp-range-value');
    depthInput.addEventListener('input', function () {
      depthValue.textContent = depthInput.value;
    });
    depthInput.addEventListener('change', function () {
      self.emit({ engineDepth: Number(depthInput.value) });
    });
    depthWrap.appendChild(depthInput);
    depthWrap.appendChild(depthValue);
    depthRow.appendChild(depthWrap);

    var linesRow = h('div', 'cmp-field cmp-engine-only');
    linesRow.appendChild(h('div', 'cmp-field-label', 'Số nước gợi ý'));
    var linesChips = h('div', 'cmp-chips');
    [1, 2, 3, 4, 5, 6].forEach(function (count) {
      var chip = h('button', 'cmp-chip', String(count));
      chip.dataset.lines = String(count);
      chip.addEventListener('click', function () {
        self.emit({ engineLines: count });
      });
      linesChips.appendChild(chip);
    });
    linesRow.appendChild(linesChips);

    var styleRow = h('div', 'cmp-field cmp-engine-only');
    styleRow.appendChild(h('div', 'cmp-field-label', 'Cách ghi điểm'));
    var styleChips = h('div', 'cmp-chips');
    [['winrate', 'Tỉ lệ thắng (62%)'], ['pawns', 'Điểm máy (+0.8)']].forEach(function (pair) {
      var chip = h('button', 'cmp-chip', pair[1]);
      chip.dataset.scoreStyle = pair[0];
      chip.addEventListener('click', function () {
        self.emit({ scoreStyle: pair[0] });
      });
      styleChips.appendChild(chip);
    });
    styleRow.appendChild(styleChips);

    var badgeRow = h('label', 'cmp-field cmp-check');
    var badgeToggle = h('input');
    badgeToggle.type = 'checkbox';
    badgeToggle.addEventListener('change', function () {
      self.emit({ showBoardBadges: badgeToggle.checked });
    });
    badgeRow.appendChild(badgeToggle);
    badgeRow.appendChild(h('span', null, 'Hiện % trên bàn cờ'));

    box.appendChild(dbRow);
    box.appendChild(speedRow);
    box.appendChild(ratingRow);
    box.appendChild(styleRow);
    box.appendChild(depthRow);
    box.appendChild(linesRow);
    box.appendChild(badgeRow);

    this.settingsEls = {
      box: box,
      dbRow: dbRow,
      dbSelect: dbSelect,
      speedRow: speedRow,
      ratingRow: ratingRow,
      speedChips: speedChips,
      ratingChips: ratingChips,
      depthInput: depthInput,
      depthValue: depthValue,
      linesChips: linesChips,
      styleChips: styleChips,
      badgeToggle: badgeToggle
    };
    return box;
  };

  UI.prototype.makeDraggable = function (handle) {
    var self = this;
    var dragging = false;
    var offsetX = 0;
    var offsetY = 0;

    handle.addEventListener('pointerdown', function (event) {
      if (event.target.closest('button, select')) return;
      var rect = self.panel.getBoundingClientRect();
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      self.panel.classList.add('cmp-dragging');
    });

    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var maxLeft = window.innerWidth - self.panel.offsetWidth - 4;
      var maxTop = window.innerHeight - 40;
      var left = Math.max(4, Math.min(maxLeft, event.clientX - offsetX));
      var top = Math.max(4, Math.min(maxTop, event.clientY - offsetY));
      self.panel.style.left = left + 'px';
      self.panel.style.top = top + 'px';
      self.panel.style.right = 'auto';
      self.panel.style.bottom = 'auto';
    });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      self.panel.classList.remove('cmp-dragging');
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (err) { /* capture already gone */ }
      var rect = self.panel.getBoundingClientRect();
      self.emit({ panelPos: { left: Math.round(rect.left), top: Math.round(rect.top) } });
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  };

  /** Pulls the panel back into view after a resize or a smaller window. */
  UI.prototype.clampToViewport = function () {
    var rect = this.panel.getBoundingClientRect();
    if (!rect.width) return;
    var maxLeft = window.innerWidth - rect.width - 8;
    var maxTop = window.innerHeight - 40;
    if (rect.left > maxLeft || rect.top > maxTop || rect.left < 0 || rect.top < 0) {
      this.panel.style.left = Math.max(8, Math.min(maxLeft, rect.left)) + 'px';
      this.panel.style.top = Math.max(8, Math.min(maxTop, rect.top)) + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';
    }
  };

  UI.prototype.emit = function (patch) {
    if (this.callbacks.onSettingsChange) this.callbacks.onSettingsChange(patch);
  };

  // -------------------------------------------------------------- overlay ---

  UI.prototype.buildOverlay = function () {
    var overlay = h('div', 'cmp-overlay');
    var arrows = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrows.setAttribute('class', 'cmp-arrows');
    arrows.setAttribute('viewBox', '0 0 100 100');
    arrows.setAttribute('preserveAspectRatio', 'none');
    overlay.appendChild(arrows);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.arrows = arrows;
  };

  /** Keeps the overlay glued to the board as the page scrolls or resizes. */
  UI.prototype.trackBoardGeometry = function () {
    var self = this;
    var frames = 0;
    function tick() {
      // Every third frame is plenty to follow scrolling, and keeps us from
      // forcing a layout 60 times a second.
      if (frames % 3 === 0) self.positionOverlay();
      if (frames % 60 === 0 && self.settings.panelPos) self.clampToViewport();
      frames++;
      self.frame = requestAnimationFrame(tick);
    }
    this.frame = requestAnimationFrame(tick);
  };

  UI.prototype.positionOverlay = function () {
    var board = this.state.position && this.state.position.board;
    if (!board || !board.isConnected || !this.showBadges()) {
      if (this.overlay.style.display !== 'none') this.overlay.style.display = 'none';
      return;
    }
    var rect = board.getBoundingClientRect();
    if (rect.width < 40) {
      this.overlay.style.display = 'none';
      return;
    }
    var key = [rect.left, rect.top, rect.width, rect.height].join(':');
    if (key === this.lastBoardRect && this.overlay.style.display === 'block') return;
    this.lastBoardRect = key;
    this.overlay.style.display = 'block';
    this.overlay.style.left = rect.left + 'px';
    this.overlay.style.top = rect.top + 'px';
    this.overlay.style.width = rect.width + 'px';
    this.overlay.style.height = rect.height + 'px';
    this.overlay.style.setProperty('--cmp-square', rect.width / 8 + 'px');
    this.overlay.style.setProperty('--cmp-font', Math.max(9, Math.min(18, rect.width / 8 * 0.3)) + 'px');
  };

  /**
   * Shown when a page that ought to have a board does not appear to have one.
   * Without this the panel simply vanished, which told nobody anything.
   */
  UI.prototype.renderDiagnosis = function () {
    var box = this.els.diagnosis;
    var info = this.state.diagnosis;
    box.textContent = '';
    if (this.state.status !== 'no-board' || !info) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';

    var movesFound = info.moveNodes > 0;
    box.appendChild(h('div', 'cmp-diag-title',
      movesFound ? 'Không dựng lại được ván' : 'Không đọc được bàn cờ'));
    box.appendChild(h('div', 'cmp-diag-hint', movesFound
      ? 'Đọc được ' + info.moveNodes + ' nước nhưng không ghép thành ván hợp lệ — ' +
        'thường là do không phân biệt được ký hiệu quân. Gửi thông tin dưới đây:'
      : 'Chess.com có thể đã đổi giao diện. Gửi thông tin dưới đây để sửa:'));

    var counts = info.counts || {};
    var lines = [
      'trang: ' + info.url + '   bản: ' + (info.version || '?'),
      'quân cờ: ' + info.pieces + '   ô square-XX: ' + info.squares +
        '   nước: ' + info.moveNodes,
      'class*=piece: ' + (counts['class*=piece'] || 0) +
        '   data-piece: ' + (counts['data-piece'] || 0) +
        '   svg: ' + (counts.svg || 0) +
        '   canvas: ' + (counts.canvas || 0),
      'iframe: ' + ((info.frames && info.frames.length) || 0) +
        '   shadow root: ' + info.shadowRoots,
      info.boardTree
        ? 'bàn cờ: ' + info.boardTree.self + ' (' + info.boardTree.descendants + ' phần tử con)'
        : 'không thấy phần tử nào giống bàn cờ'
    ];
    box.appendChild(h('div', 'cmp-diag-body', lines.join('\n')));
    box.appendChild(h('div', 'cmp-diag-hint',
      'Nút Sao chép lấy đầy đủ cấu trúc HTML — dán nguyên cho người sửa.'));

    var copy = h('button', 'cmp-diag-copy', 'Sao chép');
    copy.addEventListener('click', function () {
      var text = JSON.stringify(info, null, 2);
      try {
        navigator.clipboard.writeText(text).then(function () {
          copy.textContent = 'Đã chép';
          setTimeout(function () { copy.textContent = 'Sao chép'; }, 1500);
        });
      } catch (err) {
        copy.textContent = 'Không chép được';
      }
    });
    box.appendChild(copy);
  };

  UI.prototype.engineState = function () {
    return this.state.engine || { status: 'idle', moves: [] };
  };

  UI.prototype.showBadges = function () {
    if (!this.settings.enabled || !this.settings.showBoardBadges) return false;
    if (this.settings.mode === 'engine') {
      var engine = this.engineState();
      return (engine.status === 'thinking' || engine.status === 'ready') && !!engine.moves.length;
    }
    return this.state.status === 'ready' && !!this.state.data && !!this.state.data.moves.length;
  };

  /** Square -> percentage offsets inside the 8x8 overlay, honouring board flip. */
  UI.prototype.squareOffset = function (square) {
    var file = FILES.indexOf(square.charAt(0));
    var rank = Number(square.charAt(1)) - 1;
    if (file < 0 || rank < 0 || rank > 7) return null;
    var flipped = this.state.position && this.state.position.flipped;
    var col = flipped ? 7 - file : file;
    var row = flipped ? rank : 7 - rank;
    return { col: col, row: row };
  };

  UI.prototype.renderBadges = function (moves) {
    var self = this;
    Array.prototype.slice.call(this.overlay.querySelectorAll('.cmp-badge')).forEach(function (el) {
      el.remove();
    });
    if (!this.showBadges()) return;
    // Make sure --cmp-square is up to date before the badges rely on it.
    this.positionOverlay();

    var engineMode = this.settings.mode === 'engine';
    var shown = engineMode ? moves : moves.slice(0, this.settings.badgeCount);

    // Several candidate moves can land on the same square (c3 and Nc3, Nbd2 and
    // Nfd2). Group first so they can be spread out evenly instead of stacking
    // on top of each other.
    var bySquare = [];
    var index = {};
    shown.forEach(function (move) {
      var square = move.uci.slice(2, 4);
      if (index[square] === undefined) {
        index[square] = bySquare.length;
        bySquare.push({ square: square, moves: [] });
      }
      bySquare[index[square]].moves.push(move);
    });

    bySquare.forEach(function (group) {
      var offset = self.squareOffset(group.square);
      if (!offset) return;
      var shown = group.moves.slice(0, 3);
      var count = shown.length;

      shown.forEach(function (move, position) {
        var badge = h('div', 'cmp-badge');
        var chip = h('span', 'cmp-badge-text',
          engineMode ? self.formatScore(move) : formatPercent(move.share));
        badge.appendChild(chip);
        badge.dataset.uci = move.uci;
        if (engineMode) {
          badge.classList.add('cmp-badge-eval', lossClass(move));
          badge.title = (move.san || move.uci) + ' — ' + scoreDetail(move);
        } else if (move.share >= 25) {
          badge.classList.add('cmp-badge-top');
        } else if (move.share >= 8) {
          badge.classList.add('cmp-badge-mid');
        }

        if (count > 1) {
          badge.classList.add('cmp-badge-stacked');
          // Spread the chips down the square's own height so they never spill
          // onto the squares below, and name each one since the square alone
          // no longer tells them apart.
          badge.style.transform = 'translateY(' + (position * 34) + '%)';
          chip.textContent = (move.san || '') + ' ' + chip.textContent;
        }

        badge.style.left = 'calc(var(--cmp-square, 48px) * ' + offset.col + ')';
        badge.style.top = 'calc(var(--cmp-square, 48px) * ' + offset.row + ')';
        if (move.uci === self.hoveredUci) badge.classList.add('cmp-badge-hover');
        self.overlay.appendChild(badge);
      });
    });
  };

  UI.prototype.renderArrow = function () {
    var svg = this.arrows;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!this.hoveredUci || !this.showBadges()) return;

    var from = this.squareOffset(this.hoveredUci.slice(0, 2));
    var to = this.squareOffset(this.hoveredUci.slice(2, 4));
    if (!from || !to) return;

    var x1 = from.col * 12.5 + 6.25;
    var y1 = from.row * 12.5 + 6.25;
    var x2 = to.col * 12.5 + 6.25;
    var y2 = to.row * 12.5 + 6.25;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    // Stop short of the centre so the badge stays readable.
    var shorten = 4.5;
    var ex = x2 - (dx / length) * shorten;
    var ey = y2 - (dy / length) * shorten;

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', ey);
    line.setAttribute('class', 'cmp-arrow-line');
    var head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    var angle = Math.atan2(dy, dx);
    var size = 2.9;
    var points = [
      [x2 - (dx / length) * 1.2, y2 - (dy / length) * 1.2],
      [ex - Math.cos(angle - 0.5) * size, ey - Math.sin(angle - 0.5) * size],
      [ex - Math.cos(angle + 0.5) * size, ey - Math.sin(angle + 0.5) * size]
    ];
    head.setAttribute('points', points.map(function (p) { return p.join(','); }).join(' '));
    head.setAttribute('class', 'cmp-arrow-head');
    svg.appendChild(line);
    svg.appendChild(head);
  };

  UI.prototype.setHovered = function (uci) {
    if (this.hoveredUci === uci) return;
    this.hoveredUci = uci;
    var self = this;
    Array.prototype.slice.call(this.overlay.querySelectorAll('.cmp-badge')).forEach(function (badge) {
      badge.classList.toggle('cmp-badge-hover', badge.dataset.uci === self.hoveredUci);
    });
    Array.prototype.slice.call(this.els.list.querySelectorAll('.cmp-row')).forEach(function (row) {
      row.classList.toggle('cmp-row-hover', row.dataset.uci === self.hoveredUci);
    });
    this.renderArrow();
  };

  // --------------------------------------------------------------- render ---

  UI.prototype.setSettings = function (settings) {
    this.settings = settings;
    this.els.collapse.textContent = settings.panelCollapsed ? '+' : '–';
    this.els.collapse.title = settings.panelCollapsed ? 'Mở rộng' : 'Thu gọn';
    this.panel.classList.toggle('cmp-collapsed', settings.panelCollapsed);
    this.panel.classList.toggle('cmp-masters', settings.database === 'masters');

    var engineMode = settings.mode === 'engine';
    this.panel.classList.toggle('cmp-engine-mode', engineMode);
    Array.prototype.slice.call(this.els.modes.children).forEach(function (button) {
      button.classList.toggle('cmp-mode-on', button.dataset.mode === settings.mode);
    });

    var els = this.settingsEls;
    els.dbSelect.value = settings.database;
    els.depthInput.value = String(settings.engineDepth);
    els.depthValue.textContent = String(settings.engineDepth);
    Array.prototype.slice.call(els.linesChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', Number(chip.dataset.lines) === settings.engineLines);
    });
    Array.prototype.slice.call(els.styleChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', chip.dataset.scoreStyle === settings.scoreStyle);
    });
    els.badgeToggle.checked = settings.showBoardBadges;
    Array.prototype.slice.call(els.speedChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', settings.speeds.indexOf(chip.dataset.speed) !== -1);
    });
    Array.prototype.slice.call(els.ratingChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', settings.ratings.indexOf(Number(chip.dataset.rating)) !== -1);
    });
    // Speed and rating buckets only exist in the Lichess-players database.
    var otb = settings.database === 'masters';
    els.speedRow.style.display = otb || engineMode ? 'none' : '';
    els.ratingRow.style.display = otb || engineMode ? 'none' : '';

    if (settings.panelPos) {
      this.panel.style.left = settings.panelPos.left + 'px';
      this.panel.style.top = settings.panelPos.top + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';
    }
    this.panel.classList.toggle('cmp-hidden', !(settings.enabled && settings.showPanel));
    this.positionOverlay();
  };

  UI.prototype.setForcedVisible = function (forced) {
    this.forcedVisible = !!forced;
    this.render();
  };

  UI.prototype.boardlessHidden = function () {
    return this.state.status === 'no-board' && !this.state.diagnosis && !this.forcedVisible;
  };

  UI.prototype.setState = function (state) {
    this.state = state;
    this.render();
  };

  UI.prototype.render = function () {
    if (this.settings.mode === 'engine') this.renderEngine();
    else this.renderExplorer();
  };

  /** Score as a chess GUI writes it: +1.2, -0.4, M3 (mate in three). */
  function formatPawns(move) {
    if (move.mate !== null && move.mate !== undefined) {
      return (move.mate > 0 ? 'M' : '-M') + Math.abs(move.mate);
    }
    var pawns = (move.cp || 0) / 100;
    var digits = Math.abs(pawns) >= 10 ? 0 : 1;
    return (pawns > 0 ? '+' : '') + pawns.toFixed(digits);
  }

  /**
   * The same score as a chance of winning, which is what most players can
   * actually picture. Lichess's curve, fitted to real results: a pawn up is
   * about 60%, not 100%.
   */
  function winPercent(move) {
    if (move.mate !== null && move.mate !== undefined) return move.mate > 0 ? 100 : 0;
    var cp = move.cp || 0;
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }

  function formatWinrate(move) {
    if (move.mate !== null && move.mate !== undefined) {
      return (move.mate > 0 ? 'M' : '-M') + Math.abs(move.mate);
    }
    return Math.round(winPercent(move)) + '%';
  }

  UI.prototype.formatScore = function (move) {
    return this.settings.scoreStyle === 'pawns' ? formatPawns(move) : formatWinrate(move);
  };

  /** Both readings, for the hover title. */
  function scoreDetail(move) {
    if (move.mate !== null && move.mate !== undefined) {
      return 'Chiếu hết sau ' + Math.abs(move.mate) + ' nước';
    }
    return 'Tỉ lệ thắng ' + Math.round(winPercent(move)) + '% · điểm ' + formatPawns(move);
  }

  /** How far behind the best move this is — what the badge colour encodes. */
  function lossClass(move) {
    if (move.best) return 'cmp-eval-best';
    if (move.loss <= 30) return 'cmp-eval-good';
    if (move.loss <= 90) return 'cmp-eval-ok';
    if (move.loss <= 200) return 'cmp-eval-bad';
    return 'cmp-eval-blunder';
  }

  UI.prototype.renderEngine = function () {
    var self = this;
    var els = this.els;
    var engine = this.engineState();
    var moves = engine.moves || [];

    els.totals.textContent = '';
    els.totals.style.display = 'none';
    this.panel.classList.remove('cmp-boardless');

    var statusText = '';
    if (engine.status === 'blocked') {
      if (engine.reason === 'game-in-progress') {
        statusText = 'Ván đang diễn ra nên máy phân tích tắt. ' +
          'Ngay khi ván kết thúc nó sẽ tự bật và chấm điểm từng nước, ngay trên trang này.';
      } else {
        statusText = 'Máy phân tích chạy khi bạn luyện với máy, trên bàn phân tích, ' +
          'và ở mọi ván đã kết thúc. Trong ván với người đang đánh thì không.';
      }
    } else if (engine.status === 'error') {
      statusText = 'Lỗi máy phân tích: ' + (engine.error || 'không rõ');
    } else if (engine.status === 'thinking' && !moves.length) {
      statusText = 'Đang tính…';
    } else if (this.state.status === 'no-board') {
      this.panel.classList.toggle('cmp-boardless', this.boardlessHidden());
      if (!this.state.diagnosis) statusText = 'Trang này không có bàn cờ. Mở một ván cờ để bắt đầu.';
    }
    this.renderDiagnosis();
    els.status.textContent = statusText;
    els.status.style.display = statusText ? '' : 'none';

    // One short line. Everything else lives in its tooltip: five facts strung
    // together wrapped onto three lines and read like noise.
    els.meta.textContent = '';
    if (moves.length) {
      var turn = this.state.position && this.state.position.turn === 'b' ? 'Đen đi' : 'Trắng đi';
      els.meta.appendChild(h('span', 'cmp-meta-turn', turn));
      els.meta.appendChild(h('span', 'cmp-meta-depth', 'độ sâu ' + engine.depth));
      var detail = ['Điểm tính theo bên đang đi: số càng lớn càng tốt cho ' + turn.toLowerCase()];
      if (engine.context === 'computer') detail.push('Ván luyện với máy');
      if (engine.context === 'finished') detail.push('Ván đã kết thúc — xem lại từng nước');
      if (this.state.position && this.state.position.source === 'move-list-only') {
        detail.push('Thế cờ đọc từ danh sách nước đi (bàn cờ vẽ bằng canvas nên không đọc được)');
        els.meta.appendChild(h('span', 'cmp-meta-tag', 'từ danh sách nước'));
      }
      els.meta.title = detail.join('\n');
    }
    els.meta.style.display = moves.length ? '' : 'none';

    els.list.textContent = '';
    if (moves.length) {
      var header = h('div', 'cmp-row cmp-row-eng cmp-row-head');
      header.appendChild(h('div', 'cmp-c-san', 'Nước'));
      header.appendChild(h('div', 'cmp-c-eval', 'Điểm'));
      header.appendChild(h('div', 'cmp-c-pv', 'Biến chính'));
      els.list.appendChild(header);
      moves.forEach(function (move, index) {
        els.list.appendChild(self.buildEngineRow(move, index));
      });
    }

    this.renderBadges(moves);
    this.renderArrow();
  };

  UI.prototype.buildEngineRow = function (move, index) {
    var self = this;
    var row = h('div', 'cmp-row cmp-row-eng');
    row.dataset.uci = move.uci;

    var san = h('div', 'cmp-c-san', move.san || move.uci);
    if (index === 0) san.classList.add('cmp-san-best');
    row.appendChild(san);

    var evalCell = h('div', 'cmp-c-eval');
    var chip = h('span', 'cmp-eval ' + lossClass(move), this.formatScore(move));
    chip.title = scoreDetail(move) +
      (move.best ? '' : ' · kém hơn nước tốt nhất ' + (move.loss / 100).toFixed(2));
    evalCell.appendChild(chip);
    row.appendChild(evalCell);

    var pvMoves = move.pvSan || move.pv || [];
    var pv = h('div', 'cmp-c-pv', pvMoves.slice(0, 6).join(' '));
    pv.title = pvMoves.join(' ');
    row.appendChild(pv);

    row.addEventListener('mouseenter', function () {
      self.setHovered(move.uci);
    });
    return row;
  };

  UI.prototype.renderExplorer = function () {
    var self = this;
    var els = this.els;
    var data = this.state.data;
    var status = this.state.status;

    var statusText = '';
    if (status === 'loading') statusText = 'Đang tải…';
    else if (status === 'no-board') {
      statusText = this.state.diagnosis ? '' : 'Trang này không có bàn cờ. Mở một ván cờ để bắt đầu.';
    }
    else if (status === 'error') statusText = 'Lỗi: ' + (this.state.error || 'không tải được dữ liệu');
    else if (status === 'ready' && data && !data.moves.length) {
      statusText = 'Không có dữ liệu cho thế cờ này (đã ra khỏi sách khai cuộc).';
    }
    els.status.textContent = statusText;
    els.status.style.display = statusText ? '' : 'none';
    // Hide the panel on pages that simply have no board (home, forums,
    // profiles) — but stay visible, with a diagnosis, where one was expected,
    // and whenever the user asked for it by hand.
    this.panel.classList.toggle('cmp-boardless', this.boardlessHidden());
    this.renderDiagnosis();

    var position = this.state.position;
    var metaParts = [];
    if (data && data.opening && data.opening.name) {
      metaParts.push((data.opening.eco ? data.opening.eco + ' ' : '') + data.opening.name);
    }
    if (position) metaParts.push(position.turn === 'w' ? 'Trắng đi' : 'Đen đi');
    if (position && position.source === 'move-list-only') {
      metaParts.push('đọc từ danh sách nước đi');
    }
    els.meta.textContent = metaParts.join(' · ');
    els.meta.style.display = metaParts.length ? '' : 'none';

    this.renderTotals(data);

    els.list.textContent = '';
    if (!data || !data.moves.length) {
      this.renderBadges([]);
      this.renderArrow();
      return;
    }

    var visible = data.moves.filter(function (move) {
      return move.share >= self.settings.minPercent;
    });
    if (!visible.length) visible = data.moves.slice(0, 3);

    var header = h('div', 'cmp-row cmp-row-head');
    header.appendChild(h('div', 'cmp-c-san', 'Nước'));
    header.appendChild(h('div', 'cmp-c-share', 'Tần suất'));
    header.appendChild(h('div', 'cmp-c-wdl', 'Thắng/Hòa/Bại'));
    header.appendChild(h('div', 'cmp-c-games', 'Ván'));
    els.list.appendChild(header);

    visible.forEach(function (move) {
      els.list.appendChild(self.buildRow(move));
    });

    this.renderBadges(visible);
    this.renderArrow();
  };

  UI.prototype.renderTotals = function (data) {
    var els = this.els;
    els.totals.textContent = '';
    if (!data || !data.total) {
      els.totals.style.display = 'none';
      return;
    }
    els.totals.style.display = '';
    els.totals.appendChild(h('span', 'cmp-total-count', formatCount(data.total) + ' ván'));
    els.totals.appendChild(this.buildWdlBar(data.white, data.draws, data.black, data.total, 11));
  };

  /**
   * @param labelMin smallest share (%) that still gets a readable inline label;
   *        the narrow per-move bars need a higher bar than the wide total one.
   */
  UI.prototype.buildWdlBar = function (white, draws, black, total, labelMin) {
    var minLabel = labelMin == null ? 22 : labelMin;
    var bar = h('div', 'cmp-wdl');
    var parts = [
      ['cmp-wdl-w', white, 'Trắng thắng'],
      ['cmp-wdl-d', draws, 'Hòa'],
      ['cmp-wdl-b', black, 'Đen thắng']
    ];
    parts.forEach(function (part) {
      var pct = total ? (part[1] / total) * 100 : 0;
      var seg = h('div', 'cmp-wdl-seg ' + part[0]);
      seg.style.width = pct + '%';
      seg.title = part[2] + ': ' + formatPercent(pct) + ' (' + formatCount(part[1]) + ')';
      if (pct >= minLabel) seg.textContent = Math.round(pct) + '%';
      bar.appendChild(seg);
    });
    bar.setAttribute('aria-label',
      'Trắng ' + Math.round((white / total) * 100) + '%, hòa ' +
      Math.round((draws / total) * 100) + '%, đen ' + Math.round((black / total) * 100) + '%');
    return bar;
  };

  UI.prototype.buildRow = function (move) {
    var self = this;
    var row = h('div', 'cmp-row');
    row.dataset.uci = move.uci;

    row.appendChild(h('div', 'cmp-c-san', move.san));

    var shareCell = h('div', 'cmp-c-share');
    var shareBar = h('div', 'cmp-share-bar');
    var shareFill = h('div', 'cmp-share-fill');
    shareFill.style.width = Math.max(2, Math.min(100, move.share)) + '%';
    shareBar.appendChild(shareFill);
    shareCell.appendChild(shareBar);
    shareCell.appendChild(h('span', 'cmp-share-text', formatPercent(move.share)));
    row.appendChild(shareCell);

    var wdlCell = h('div', 'cmp-c-wdl');
    wdlCell.appendChild(this.buildWdlBar(move.white, move.draws, move.black, move.total));
    row.appendChild(wdlCell);

    var games = h('div', 'cmp-c-games', formatCount(move.total));
    if (move.averageRating) games.title = 'Elo trung bình: ' + move.averageRating;
    row.appendChild(games);

    row.addEventListener('mouseenter', function () {
      self.setHovered(move.uci);
    });
    return row;
  };

  UI.prototype.destroy = function () {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.panel) this.panel.remove();
    if (this.overlay) this.overlay.remove();
  };

  root.CMPUI = UI;
})(typeof self !== 'undefined' ? self : this);
