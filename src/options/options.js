/* Options page: a thin editor over the same settings the content script reads. */
(function () {
  'use strict';

  var SPEED_LABELS = {
    ultraBullet: 'UltraBullet',
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical',
    correspondence: 'Thư tín'
  };

  var settings = CMPSettings.DEFAULTS;
  var savedTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function flashSaved() {
    var badge = $('saved');
    badge.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { badge.hidden = true; }, 1200);
  }

  function update(patch) {
    settings = CMPSettings.normalize(Object.assign({}, settings, patch));
    CMPSettings.save(patch).then(flashSaved);
    render();
  }

  function buildChips(container, values, label, isOn, onToggle) {
    container.textContent = '';
    values.forEach(function (value) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = label(value);
      chip.setAttribute('aria-pressed', String(isOn(value)));
      chip.addEventListener('click', function () { onToggle(value); });
      container.appendChild(chip);
    });
  }

  function toggleIn(list, value) {
    var next = list.slice();
    var at = next.indexOf(value);
    if (at === -1) next.push(value);
    else next.splice(at, 1);
    return next.length ? next : null;
  }

  function render() {
    $('enabled').checked = settings.enabled;
    $('showPanel').checked = settings.showPanel;
    $('showBoardBadges').checked = settings.showBoardBadges;
    $('badgeCount').value = settings.badgeCount;
    $('minPercent').value = settings.minPercent;
    $('engineDepth').value = settings.engineDepth;
    $('engineLines').value = settings.engineLines;
    document.querySelectorAll('input[name="database"]').forEach(function (radio) {
      radio.checked = radio.value === settings.database;
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
      radio.checked = radio.value === settings.mode;
    });
    document.querySelectorAll('input[name="scoreStyle"]').forEach(function (radio) {
      radio.checked = radio.value === settings.scoreStyle;
    });
    $('lichess-filters').hidden = settings.database === 'masters';
    $('engine-settings').hidden = settings.mode !== 'engine';
    $('explorer-settings').hidden = settings.mode === 'engine';

    buildChips($('speeds'), CMPSettings.SPEED_OPTIONS,
      function (speed) { return SPEED_LABELS[speed] || speed; },
      function (speed) { return settings.speeds.indexOf(speed) !== -1; },
      function (speed) {
        var next = toggleIn(settings.speeds, speed);
        if (next) update({ speeds: next });
      });

    buildChips($('ratings'), CMPSettings.RATING_OPTIONS,
      function (rating) { return rating === 0 ? '<1000' : String(rating); },
      function (rating) { return settings.ratings.indexOf(rating) !== -1; },
      function (rating) {
        var next = toggleIn(settings.ratings, rating);
        if (next) update({ ratings: next });
      });
  }

  function wire() {
    $('enabled').addEventListener('change', function () {
      update({ enabled: this.checked });
    });
    $('showPanel').addEventListener('change', function () {
      update({ showPanel: this.checked });
    });
    $('showBoardBadges').addEventListener('change', function () {
      update({ showBoardBadges: this.checked });
    });
    $('badgeCount').addEventListener('change', function () {
      update({ badgeCount: Number(this.value) });
    });
    $('minPercent').addEventListener('change', function () {
      update({ minPercent: Number(this.value) });
    });
    $('engineDepth').addEventListener('change', function () {
      update({ engineDepth: Number(this.value) });
    });
    $('engineLines').addEventListener('change', function () {
      update({ engineLines: Number(this.value) });
    });
    document.querySelectorAll('input[name="database"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (this.checked) update({ database: this.value });
      });
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (this.checked) update({ mode: this.value });
      });
    });
    document.querySelectorAll('input[name="scoreStyle"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (this.checked) update({ scoreStyle: this.value });
      });
    });
    $('reset').addEventListener('click', function () {
      update(JSON.parse(JSON.stringify(CMPSettings.DEFAULTS)));
    });
  }

  CMPSettings.load().then(function (loaded) {
    settings = loaded;
    wire();
    render();
  });
})();
