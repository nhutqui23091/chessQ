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

    var dbSelect = h('select', 'cmp-db');
    dbSelect.title = 'Nguồn dữ liệu';
    [['lichess', 'Người chơi Lichess'], ['masters', 'Kiện tướng (OTB)']].forEach(function (pair) {
      var option = h('option', null, pair[1]);
      option.value = pair[0];
      dbSelect.appendChild(option);
    });
    dbSelect.addEventListener('change', function () {
      self.emit({ database: dbSelect.value });
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
    head.appendChild(dbSelect);
    head.appendChild(gear);
    head.appendChild(collapse);
    head.appendChild(close);

    var body = h('div', 'cmp-body');
    var meta = h('div', 'cmp-meta');
    var totals = h('div', 'cmp-totals');
    var list = h('div', 'cmp-moves');
    var status = h('div', 'cmp-status');
    var settingsBox = this.buildSettings();

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
      dbSelect: dbSelect,
      collapse: collapse,
      meta: meta,
      totals: totals,
      list: list,
      status: status
    };

    this.makeDraggable(head);
  };

  UI.prototype.buildSettings = function () {
    var self = this;
    var box = h('div', 'cmp-settings');

    var speedRow = h('div', 'cmp-field');
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

    var ratingRow = h('div', 'cmp-field');
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

    var badgeRow = h('label', 'cmp-field cmp-check');
    var badgeToggle = h('input');
    badgeToggle.type = 'checkbox';
    badgeToggle.addEventListener('change', function () {
      self.emit({ showBoardBadges: badgeToggle.checked });
    });
    badgeRow.appendChild(badgeToggle);
    badgeRow.appendChild(h('span', null, 'Hiện % trên bàn cờ'));

    box.appendChild(speedRow);
    box.appendChild(ratingRow);
    box.appendChild(badgeRow);

    this.settingsEls = {
      box: box,
      speedRow: speedRow,
      ratingRow: ratingRow,
      speedChips: speedChips,
      ratingChips: ratingChips,
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
      if (frames++ % 3 === 0) self.positionOverlay();
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

  UI.prototype.showBadges = function () {
    return this.settings.enabled && this.settings.showBoardBadges &&
      this.state.status === 'ready' && !!this.state.data && !!this.state.data.moves.length;
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

    moves.slice(0, this.settings.badgeCount).forEach(function (move) {
      var offset = self.squareOffset(move.uci.slice(2, 4));
      if (!offset) return;
      var badge = h('div', 'cmp-badge', formatPercent(move.share));
      badge.dataset.uci = move.uci;
      if (move.share >= 25) badge.classList.add('cmp-badge-top');
      else if (move.share >= 8) badge.classList.add('cmp-badge-mid');
      badge.style.left = 'calc(var(--cmp-square, 48px) * ' + offset.col + ')';
      badge.style.top = 'calc(var(--cmp-square, 48px) * ' + offset.row + ')';
      if (move.uci === self.hoveredUci) badge.classList.add('cmp-badge-hover');
      self.overlay.appendChild(badge);
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
    var size = 3.6;
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
    this.els.dbSelect.value = settings.database;
    this.els.collapse.textContent = settings.panelCollapsed ? '+' : '–';
    this.els.collapse.title = settings.panelCollapsed ? 'Mở rộng' : 'Thu gọn';
    this.panel.classList.toggle('cmp-collapsed', settings.panelCollapsed);
    this.panel.classList.toggle('cmp-masters', settings.database === 'masters');

    var els = this.settingsEls;
    els.badgeToggle.checked = settings.showBoardBadges;
    Array.prototype.slice.call(els.speedChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', settings.speeds.indexOf(chip.dataset.speed) !== -1);
    });
    Array.prototype.slice.call(els.ratingChips.children).forEach(function (chip) {
      chip.classList.toggle('cmp-chip-on', settings.ratings.indexOf(Number(chip.dataset.rating)) !== -1);
    });
    // Speed and rating buckets only exist in the Lichess-players database.
    var otb = settings.database === 'masters';
    els.speedRow.style.display = otb ? 'none' : '';
    els.ratingRow.style.display = otb ? 'none' : '';

    if (settings.panelPos) {
      this.panel.style.left = settings.panelPos.left + 'px';
      this.panel.style.top = settings.panelPos.top + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';
    }
    this.panel.classList.toggle('cmp-hidden', !(settings.enabled && settings.showPanel));
    this.positionOverlay();
  };

  UI.prototype.setState = function (state) {
    this.state = state;
    this.render();
  };

  UI.prototype.render = function () {
    var self = this;
    var els = this.els;
    var data = this.state.data;
    var status = this.state.status;

    var statusText = '';
    if (status === 'loading') statusText = 'Đang tải…';
    else if (status === 'no-board') statusText = 'Không tìm thấy bàn cờ trên trang này.';
    else if (status === 'error') statusText = 'Lỗi: ' + (this.state.error || 'không tải được dữ liệu');
    else if (status === 'ready' && data && !data.moves.length) {
      statusText = 'Không có dữ liệu cho thế cờ này (đã ra khỏi sách khai cuộc).';
    }
    els.status.textContent = statusText;
    els.status.style.display = statusText ? '' : 'none';
    // Chess.com pages without a board (home, forums, profiles) should not carry
    // a floating panel around.
    this.panel.classList.toggle('cmp-boardless', status === 'no-board');

    var position = this.state.position;
    var metaParts = [];
    if (data && data.opening && data.opening.name) {
      metaParts.push((data.opening.eco ? data.opening.eco + ' ' : '') + data.opening.name);
    }
    if (position) metaParts.push(position.turn === 'w' ? 'Trắng đi' : 'Đen đi');
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
