/*
 * End-to-end check: loads the real extension into a real Chromium and drives it
 * against a stand-in Chess.com page.
 *
 *   npm i -D playwright && npm run test:e2e
 *
 * This is the only test that proves the things unit tests cannot: that the
 * manifest loads at all, that the service worker starts, that the offscreen
 * document may compile WASM under the extension CSP, and that Stockfish really
 * produces numbers on the board.
 *
 * It is kept out of `npm test` because it needs a browser download.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8911;

let playwright;
try {
  playwright = require('playwright');
} catch (err) {
  console.error('playwright is not installed. Run:  npm i -D playwright');
  process.exit(2);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/** A copy of the extension whose content script also matches the local server. */
function stageExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-e2e-'));
  for (const entry of ['manifest.json', 'icons', 'src']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.content_scripts[0].matches.push(`http://127.0.0.1:${PORT}/*`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

function serveFixture() {
  const page = fs.readFileSync(path.join(__dirname, 'fixture.html'));
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (['/play/computer', '/analysis', '/play/online', '/'].includes(url)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  for (;;) {
    const value = await page.evaluate(fn);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await wait(250);
  }
}

async function main() {
  const extension = stageExtension();
  const server = await serveFixture();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-profile-'));

  // 'chromium' selects the new headless mode; the old one cannot load extensions.
  const context = await playwright.chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });

  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/play/computer`);
    await wait(1500);

    const workers = context.serviceWorkers();
    check('the extension loads and its service worker starts', workers.length === 1,
      workers.map((w) => w.url()).join(','));
    const extensionId = workers.length ? new URL(workers[0].url()).host : null;

    const panel = await waitFor(page, () => {
      const el = document.querySelector('.cmp-panel');
      return el && getComputedStyle(el).display !== 'none' ? el.className : null;
    });
    check('the panel appears on a game page', !!panel, panel || 'no panel');

    const readsBoard = await page.evaluate(() =>
      !document.querySelector('.cmp-diagnosis') ||
      document.querySelector('.cmp-diagnosis').style.display === 'none');
    check('the board is read (no diagnosis shown)', readsBoard);

    // Switch the extension into engine mode through its own options page.
    if (extensionId) {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
      await options.waitForTimeout(400);
      await options.click('input[name="mode"][value="engine"]');
      await options.waitForTimeout(400);
      await options.close();
    }

    await page.reload();
    // Wait for the search to settle rather than for its first partial result,
    // so this also proves MultiPV returns the configured number of lines.
    const engine = await waitFor(page, () => {
      const rows = document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head)');
      const meta = document.querySelector('.cmp-meta');
      const depth = /độ sâu (\d+)/.exec(meta ? meta.textContent : '');
      if (rows.length < 4 || !depth || Number(depth[1]) < 14) return null;
      return {
        depth: Number(depth[1]),
        rows: rows.length,
        first: rows[0].querySelector('.cmp-c-san').textContent,
        score: rows[0].querySelector('.cmp-eval').textContent,
        badges: document.querySelectorAll('.cmp-badge').length
      };
    }, 30000);
    check('Stockfish runs in the bot game and scores every move', !!engine,
      engine
        ? `${engine.rows} nước ở độ sâu ${engine.depth}, tốt nhất ${engine.first} ${engine.score}, ${engine.badges} huy hiệu`
        : 'did not reach 4 lines at the configured depth');

    // And must refuse where the opponent could be a person.
    const human = await context.newPage();
    await human.goto(`http://127.0.0.1:${PORT}/play/online`);
    await wait(2500);
    const refused = await human.evaluate(() => {
      const status = document.querySelector('.cmp-status');
      return {
        text: status ? status.textContent : '',
        rows: document.querySelectorAll('.cmp-row-eng:not(.cmp-row-head)').length
      };
    });
    check('the engine refuses in a game against a person',
      refused.rows === 0 && /người thật/.test(refused.text), refused.text.slice(0, 60));
  } finally {
    await context.close();
    server.close();
    fs.rmSync(extension, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
