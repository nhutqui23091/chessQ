'use strict';

// How the connection check reads back. The point of the check is to tell
// Lichess apart from whatever may be standing in front of it: a status code
// cannot, but the final URL, the server header and the error page can.

const test = require('node:test');
const assert = require('node:assert');
const { makeUiWindow } = require('./helpers');

function reportWindow(t, report) {
  const window = makeUiWindow('<!doctype html><html><body></body></html>');
  const ui = new window.CMPUI({ onSettingsChange: () => {} });
  ui.setSettings(window.CMPSettings.normalize({}));
  ui.setState({ status: 'idle', data: null, position: null });
  ui.connectionReport = report;
  ui.render();
  t.after(() => { ui.destroy(); window.close(); });
  return window.document.querySelector('.cmp-diagnosis');
}

test('an nginx error page is named as interception, not as Lichess', (t) => {
  // The reported case, verbatim.
  const box = reportWindow(t, {
    ok: false, status: 401, statusText: 'Unauthorized',
    requested: 'https://explorer.lichess.ovh/lichess?fen=x',
    finalUrl: 'https://explorer.lichess.ovh/lichess?fen=x',
    server: 'nginx', contentType: 'text/html',
    body: '401 Authorization Required 401 Authorization Required nginx', ms: 42
  });
  assert.match(box.textContent, /BỊ TỪ CHỐI \(401\)/);
  assert.match(box.textContent, /server  : nginx/);
  assert.match(box.textContent, /không phải của Lichess/);
  assert.match(box.textContent, /danh sách trắng/);
});

test('a redirect somewhere else is flagged', (t) => {
  const box = reportWindow(t, {
    ok: false, status: 403,
    requested: 'https://explorer.lichess.ovh/lichess?fen=x',
    finalUrl: 'http://blocked.local/notice', redirected: true,
    server: '', contentType: 'text/html', body: 'blocked', ms: 8
  });
  assert.match(box.textContent, /ĐÃ BỊ CHUYỂN HƯỚNG/);
  assert.match(box.textContent, /blocked\.local/);
});

test('a refusal that really is Lichess says so', (t) => {
  const box = reportWindow(t, {
    ok: false, status: 429,
    requested: 'https://explorer.lichess.ovh/lichess?fen=x',
    finalUrl: 'https://explorer.lichess.ovh/lichess?fen=x',
    server: 'Lichess', contentType: 'application/json',
    body: '{"error":"too many requests"}', ms: 120
  });
  assert.match(box.textContent, /Lichess từ chối yêu cầu/);
  assert.ok(!/không phải của Lichess/.test(box.textContent));
});

test('a healthy connection reports success', (t) => {
  const box = reportWindow(t, {
    ok: true, status: 200,
    requested: 'https://explorer.lichess.ovh/lichess?fen=x',
    finalUrl: 'https://explorer.lichess.ovh/lichess?fen=x',
    server: 'Lichess', contentType: 'application/json',
    body: '{"white":1}', ms: 95
  });
  assert.match(box.textContent, /OK — Lichess trả lời bình thường/);
  assert.ok(box.classList.contains('cmp-diagnosis-ok'));
});

test('a host that cannot be reached at all reports the network error', (t) => {
  const box = reportWindow(t, {
    ok: false, requested: 'https://explorer.lichess.ovh/lichess?fen=x',
    networkError: 'Failed to fetch', ms: 3
  });
  assert.match(box.textContent, /KHÔNG KẾT NỐI ĐƯỢC/);
  assert.match(box.textContent, /DNS chặn/);
});

// --- the engine check -------------------------------------------------------

function engineReport(t, status) {
  const window = makeUiWindow('<!doctype html><html><body></body></html>');
  const ui = new window.CMPUI({ onSettingsChange: () => {} });
  ui.setSettings(window.CMPSettings.normalize({ mode: 'engine' }));
  ui.setState({ status: 'idle', data: null, position: null, engine: { status: 'idle', moves: [] } });
  ui.connectionReport = { engine: status };
  ui.render();
  t.after(() => { ui.destroy(); window.close(); });
  return window.document.querySelector('.cmp-diagnosis');
}

test('a healthy idle engine says so', (t) => {
  const box = engineReport(t, {
    document: true, replied: true, worker: true, uciok: true, ready: true,
    lastLine: 'readyok', searching: null, queued: null
  });
  assert.match(box.textContent, /sẵn sàng \(readyok\): rồi/);
  assert.match(box.textContent, /engine rảnh và khoẻ/);
  assert.ok(box.classList.contains('cmp-diagnosis-ok'));
});

test('an engine still loading is named as such', (t) => {
  const box = engineReport(t, {
    document: true, replied: true, worker: true, uciok: false, ready: false,
    lastLine: 'Stockfish 10 64', queued: 'some fen'
  });
  assert.match(box.textContent, /uciok\s+: CHƯA/);
  assert.match(box.textContent, /chưa nạp xong/);
  assert.match(box.textContent, /Stockfish 10 64/);
  assert.ok(!box.classList.contains('cmp-diagnosis-ok'));
});

test('a missing or mute engine page is named', (t) => {
  assert.match(engineReport(t, { document: false }).textContent,
    /không tạo được trang chạy engine/);
  assert.match(engineReport(t, { document: true, replied: false }).textContent,
    /trang chạy engine treo/);
  assert.match(engineReport(t, { unreachable: true }).textContent,
    /KHÔNG HỎI ĐƯỢC TIỆN ÍCH/);
});

test('a boot failure is shown verbatim', (t) => {
  const box = engineReport(t, {
    document: true, replied: true, worker: true, uciok: false, ready: false,
    bootError: 'CompileError: wasm validation'
  });
  assert.match(box.textContent, /CompileError: wasm validation/);
});
