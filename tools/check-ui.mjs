#!/usr/bin/env node
// 法則ハンター — 画面を実際に動かす検査（Chrome の画面なしモードを DevTools Protocol で操作する）
// 使い方: node tools/check-ui.mjs [index.html] [--chrome Chrome の実行ファイル] [--root 素材のフォルダ] [--mutants]
//   --mutants = わざと不具合を入れた写し（11種）でも動かし、狙った項目が FAIL することを確かめる（数分かかる）
//   Chrome は CHROME 環境変数か --chrome、無ければ macOS の /Applications/Google Chrome.app・Linux の google-chrome / chromium を探す。
//   検査用の小さな HTTP サーバ（127.0.0.1・空いているポート）で対象の HTML と、同じフォルダ（または --root）の PWA の素材（manifest・sw.js・アイコン・
//   support.html）を配り、一時フォルダのプロファイルで Chrome を起動して、終わったら両方を止めて消す。
//   外へは通信しない（Google Fonts の読み込みは空の応答で返す。Service Worker は登録させるが、ページの読み込みは Service Worker を通さない）。音は Chrome の --mute-audio と、開くたびに何より先に流すミュートのスクリプト
//   （アプリ開発/_テンプレート/動作チェックのミュート手順.md と同じもの）で止める。
// 確かめること（クリック・キー・時計を進める・別のタブ・iframe で、画面の関数 solve・check・retry・wantJudge・newJudge・startCase・
//   renderHome・renderBook・renderBar・wipe・copyFn を本当に動かす）:
//   - はじめての調査（案内の場所・第2話の案内）・今日のルール（調べる→確かめの帯→判定→外れ→もう一度→解決→コピー）・練習（調べずに判定→★2）
//   - 375×667 で予想と［調べる］がスクロールなしで押せる・確かめの帯や案内で台の下が隠れない・320〜1280 で横にはみ出さない
//   - 焦点（描き直しで消えない・role=radio の矢印キー・名前の無い焦点が無い）・読み上げの句点
//   - 動きを減らす設定でも「1つに絞れた」・判定中のメーター・候補が1つなら確かめない・判定の5枚に答えを書かない
//   - 連続日数（0〜3時に今日→昨日の順）・3時で「昨日の No.n」が消える・過去の日のコピーはその日の連続
//   - 別のタブ（練習を二重に数えない・判定に進んだ記録を消さない）・裏に回ったら音を鳴らさない・iframe でコピーの返事が遅れても二重に出さない
//   - 記録帳（もっと見る）・図鑑（範囲ごとの箱）・遊び方（続きから）・設定（ダーク・スイッチのつまみ・color-scheme・記録を消す）・コンソールのエラー 0
//   - PWA（#0004）: 直接開くと manifest と apple-touch-icon を置き、Service Worker を登録する。iframe の中では置かず、登録もしない
// 外部パッケージは使わない（Node.js 22 以上の fetch・WebSocket だけで動く）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def; };
const here = path.dirname(fileURLToPath(import.meta.url));
const optIdx = new Set(['--chrome', '--fail-out', '--root'].map((n) => argv.indexOf(n)).filter((i) => i >= 0).map((i) => i + 1));
const target = path.resolve(argv.find((a, i) => !a.startsWith('--') && !optIdx.has(i)) || path.join(here, '..', 'index.html'));
const FAIL_OUT = opt('--fail-out', null);
const RUN_MUTANTS = argv.includes('--mutants');
if (!fs.existsSync(target)) { console.log('FAIL  検査対象がありません: ' + target); process.exit(1); }
const HTML = fs.readFileSync(target);
// PWA の素材（manifest・sw.js・アイコン・サポートページ）を配るフォルダ。写し（--mutants）のときは元のフォルダを渡す
const ROOT = path.resolve(opt('--root', path.dirname(target)));
const ASSETS = { '/manifest.json': 'application/manifest+json', '/sw.js': 'text/javascript; charset=utf-8', '/support.html': 'text/html; charset=utf-8', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/apple-touch-icon.png': 'image/png', '/ogp.png': 'image/png', '/icon.svg': 'image/svg+xml' };
if (typeof WebSocket === 'undefined') { console.log('FAIL  Node.js 22 以上が必要です（WebSocket が無い）'); process.exit(1); }

function findChrome() {
  const c = [opt('--chrome', null), process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}
const CHROME = findChrome();
if (!CHROME) { console.log('FAIL  Chrome が見つかりません（CHROME 環境変数か --chrome で指定）'); process.exit(1); }

// 開くたびに、アプリより先に流すスクリプト: ミュート（手順書と同じ）・時計（あとから進められる）・音の数え方・クリップボードの代わり
const MUTE = "(() => { const w = window; if (w.__muteReport) return 'already'; const R = { intercepted: 0, ctxs: [] }; const origConnect = AudioNode.prototype.connect; AudioNode.prototype.connect = function (dest, ...rest) { try { if (dest && dest.context && dest === dest.context.destination) { R.intercepted++; if (R.ctxs.indexOf(dest.context) < 0) R.ctxs.push(dest.context); const g = dest.context.createGain(); g.gain.value = 0; origConnect.call(g, dest); return origConnect.call(this, g, ...rest); } } catch (e) { R.err = String(e); } return origConnect.call(this, dest, ...rest); }; const M = HTMLMediaElement.prototype; const origPlay = M.play; M.play = function () { this.muted = true; this.volume = 0; return origPlay.call(this); }; document.querySelectorAll('audio,video').forEach(e => { e.muted = true; e.volume = 0; }); w.__muteReport = () => ({ intercepted: R.intercepted, contexts: R.ctxs.map(c => ({ state: c.state })), err: R.err || null }); return 'mute-armed'; })()";
const PRELUDE = MUTE + `;
(() => {
  const real = Date; let off = 0;
  class FD extends real { constructor(...a) { if (a.length === 0) super(real.now() + off); else super(...a); } static now() { return real.now() + off; } }
  FD.UTC = real.UTC; FD.parse = real.parse; window.Date = FD;
  window.__setClock = (iso) => { off = iso ? new real(iso).getTime() - real.now() : 0; try { sessionStorage.setItem('__clock', iso || ''); } catch (e) {} };
  try { const q = sessionStorage.getItem('__clock'); if (q) off = new real(q).getTime() - real.now(); } catch (e) {}
  window.__osc = 0;
  const os = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__osc++; return os.apply(this, a); };
  window.__clip = [];
  window.__clipDelay = 0;
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => new Promise((res) => setTimeout(() => { window.__clip.push(t); res(); }, window.__clipDelay)) } }); } catch (e) {}
  window.__hide = (v) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); };
})();`;

/* ---------- 検査用のサーバと Chrome ---------- */
const FRAME = Buffer.from('<!doctype html><html lang="ja"><meta charset="utf-8"><title>frame</title><body style="margin:0"><iframe id="f" src="/index.html" style="width:375px;height:700px;border:0"></iframe></body></html>');
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(HTML); return; }
  if (u === '/frame.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(FRAME); return; }
  if (u === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (ASSETS[u]) { try { const b = fs.readFileSync(path.join(ROOT, u.slice(1))); res.writeHead(200, { 'content-type': ASSETS[u], 'cache-control': 'no-store' }); res.end(b); return; } catch (e) { /* 無ければ 404 */ } }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hosoku-ui-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let finished = false, chromeGone = false;
chrome.on('exit', () => { chromeGone = true; });
// Chrome とサーバを止め、一時フォルダのプロファイルを消す（Chrome が止まるのを待ってから）
async function cleanup() {
  if (finished) return; finished = true;
  try { chrome.kill('SIGKILL'); } catch (e) { /* もう止まっている */ }
  try { server.close(); } catch (e) { /* 同上 */ }
  for (let i = 0; i < 40 && !chromeGone; i++) await new Promise((r) => setTimeout(r, 50));
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { /* 消せなくても続ける */ }
}
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) { /* 止まっている */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 同上 */ } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port = 0;
for (let i = 0; i < 100 && !port; i++) { try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) { await sleep(100); } }
if (!port) { console.log('FAIL  Chrome を起動できません: ' + CHROME); await cleanup(); process.exit(1); }
const BASE = 'http://127.0.0.1:' + port;

const errors = [];
async function newPage(name) {
  const t = await (await fetch(BASE + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map(), waiters = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.j(new Error(JSON.stringify(m.error))); else p.r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(name + ' 例外 ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning' || m.params.type === 'assert')) errors.push(name + ' console.' + m.params.type + ' ' + m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) errors.push(name + ' ' + m.params.entry.level + ' ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: /\.css|css2/.test(u) ? 'text/css' : 'application/octet-stream' }, { name: 'access-control-allow-origin', value: '*' }], body: '' }).catch(() => {});
    }
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].m === m.method) { waiters[i].r(m.params); waiters.splice(i, 1); }
  };
  const send = (method, params) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const waitEv = (m, ms) => new Promise((r) => { waiters.push({ m, r }); setTimeout(r, ms || 10000); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  // Service Worker は登録させる（PWA の検査）が、ページの読み込みは通さない（書体を Service Worker が外から取りに行かないように。Fetch で空の応答を返すため）
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://fonts.googleapis.com/*' }, { urlPattern: 'https://fonts.gstatic.com/*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
  const pg = {
    name, send,
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 160));
      return r.result.value;
    },
    async open(url) {
      const p = waitEv('Page.loadEventFired');
      await send('Page.navigate', { url: url || ORIGIN + '/' });
      await p; await sleep(120);
      // ミュートの手順: 開いたら何もクリックする前に流す（先に流してあれば 'already'）
      const m = await pg.ev(MUTE);
      if (m !== 'already' && m !== 'mute-armed') throw new Error('ミュートできない');
      return m;
    },
    async reload() { return pg.open(await pg.ev('location.href')); },
    async size(w, h, scheme, rm) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768, screenWidth: w, screenHeight: h });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }, { name: 'prefers-reduced-motion', value: rm || 'no-preference' }] });
    },
    async clock(iso) { await pg.ev('window.__setClock(' + JSON.stringify(iso) + ')'); },
    // 本当のマウス操作で押す（要素が見えていて、ほかの要素に隠れていないこと）。noScroll なら、スクロールせずに押せることも確かめる
    async tap(sel, o) {
      o = o || {};
      // 画面のなめらかなスクロール（判定へ進んだときなど）が止まるのを待ってから押す（動いている途中だと別の所を押してしまう）
      await pg.ev(`new Promise((res) => { let y = -1, n = 0; const t0 = performance.now(); const f = () => { if (scrollY === y) n++; else n = 0; y = scrollY; if (n >= 3 || performance.now() - t0 > 1500) res(true); else setTimeout(f, 40); }; f(); })`);
      const r = await pg.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return { none: true }; ${o.noScroll ? '' : "e.scrollIntoView({ block: 'center', behavior: 'instant' });"}
        const b = e.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const top = document.elementFromPoint(x, y);
        return { x, y, dis: !!e.disabled, inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, covered: !top || !(e === top || e.contains(top)) }; })()`);
      if (r.none) throw new Error('押すものが無い: ' + sel);
      if (r.dis) throw new Error('押せない（disabled）: ' + sel);
      if (o.noScroll && !r.inView) throw new Error('スクロールしないと押せない: ' + sel);
      if (r.covered) throw new Error('ほかの要素に隠れている: ' + sel);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(o.wait == null ? 80 : o.wait);
    },
    async key(k) {
      const code = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Enter: 13, ' ': 32, Tab: 9 }[k];
      // nativeVirtualKeyCode は渡さない（macOS では別のキーと読まれ、Chrome の画面が開いてページが裏に回ることがある）
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code });
      if (k === 'Enter' || k === ' ') await send('Input.dispatchKeyEvent', { type: 'char', text: k === 'Enter' ? '\r' : ' ', key: k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code });
      await sleep(80);
    },
    async until(expr, ms, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 4000)) { if (await pg.ev(expr)) return true; await sleep(60); }
      throw new Error('待っても変わらない: ' + (label || expr.slice(0, 100)));
    },
    close() { try { ws.close(); } catch (e) { /* 閉じている */ } },
  };
  return pg;
}

/* ---------- 結果の記録 ---------- */
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: ok ? '' : detail }); return ok; };
async function step(name, fn) {
  try { const r = await fn(); if (r === false) check(name, false, ''); else if (r !== true && r !== undefined) check(name, false, String(r)); else check(name, true); } catch (e) { check(name, false, e.message.split('\n')[0].slice(0, 300)); }
}

// ページの中で使う小物（アプリの外。エンジンは window.Engine）
const HELP = `window.__T = {
  st: () => JSON.parse(localStorage.getItem('hosoku.v1') || 'null'),
  pz: () => { const meta = document.querySelector('#tbMeta').textContent, s = __T.st(); const t = document.body.dataset.view;
    if (/はじめての調査/.test(meta)) { const ep = +(/第(\\d)話/.exec(meta) || [0, 1])[1]; return { pz: Engine.tutorial(ep), rec: s.tutorial.cur && s.tutorial.cur.ep === ep ? s.tutorial.cur : null }; }
    if (/練習/.test(meta)) { const c = [1, 2, 3].map((k) => s.practice.cur[k]).filter((x) => x && x.state === 'playing').concat([1, 2, 3].map((k) => s.practice.cur[k]).filter(Boolean))[0]; return { pz: Engine.generate({ seed: c.seed, star: c.star }), rec: c }; }
    const no = +document.querySelector('#tbMeta .tnum').textContent.replace('No.', ''); const d = Engine.addDays('2026-10-20', no - 1); return { pz: Engine.daily(d), rec: s.daily[d] || null }; },
  obs: () => { const x = __T.pz(); const r = x.rec || { obs: [], fails: [] }; return r.obs.concat([].concat(...(r.fails || []))).map((i) => ({ card: Engine.CARDS[i] })); },
  cand: () => { const x = __T.pz(); return Engine.candidates(x.pz, __T.obs()).length; },
  best: () => { const x = __T.pz(); return Engine.bestQuestion(x.pz, __T.obs()).card; },
  test: (c) => Engine.test(__T.pz().pz, c),
  noAnswerInDom: () => { const x = __T.pz(); const c = document.documentElement.cloneNode(true); c.querySelectorAll('script').forEach((s) => s.remove()); const h = c.outerHTML; return !h.includes(x.pz.ruleText) && !/data-ok|data-right|data-ans-ok/.test(h); },
  overflow: () => { const out = []; document.querySelectorAll('body *').forEach((e) => { if (e.closest('[hidden]') || e.closest('.burst') || e.closest('.vh') || e.getAnimations().some((a) => a.playState === 'running')) return; const r = e.getBoundingClientRect(); if (!r.width) return; if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push((e.id ? '#' + e.id : e.tagName) + '.' + (typeof e.className === 'string' ? e.className : '')); }); return { sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), iw: innerWidth, out: out.slice(0, 4) }; },
  unnamed: () => { const sel = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])'; const out = [];
    document.querySelectorAll(sel).forEach((e) => { if (e.closest('[hidden]') || e.disabled) return; const r = e.getBoundingClientRect(); if (!r.width && !r.height && e.tagName !== 'rect') return;
      let n = e.getAttribute('aria-label') || ''; const lb = e.getAttribute('aria-labelledby'); if (lb) n += lb.split(' ').map((i) => (document.getElementById(i) || {}).textContent || '').join('');
      n += e.textContent || ''; n += e.getAttribute('title') || ''; if (!n.trim()) out.push(e.tagName + '#' + e.id + '.' + (e.getAttribute('class') || '')); }); return out; },
};`;

async function pickCard(pg, card, o) {
  await pg.tap('[data-pk="c"][data-v="' + card.c + '"]', o);
  await pg.tap('[data-pk="s"][data-v="' + card.s + '"]', o);
  await pg.tap('[data-pk="n"][data-v="' + card.n + '"]', o);
}
// 予想して調べる（予想と［調べる］は下の帯から、スクロールせずに押す）
async function askCard(pg, card, guess) {
  await pickCard(pg, card);
  await pg.tap('#playBar [data-guess="' + (guess ? 1 : 0) + '"]', { noScroll: true });
  await pg.tap('#btnAsk', { noScroll: true, wait: 0 });
  await pg.until('!document.querySelector("#btnAsk") || document.querySelector("#btnAsk").disabled', 2000, '調べたあと');
  await sleep(1500);
}
async function askBest(pg) { const c = await pg.ev('__T.best()'); if (!c) return false; const ok = await pg.ev('__T.test(' + JSON.stringify(c) + ')'); await askCard(pg, c, ok); return true; }
// 判定の5枚に答える（right = 正しく答える。false なら1枚目だけ逆）
async function answerJudge(pg, right) {
  const ans = await pg.ev('Array.from(document.querySelectorAll(".jd-i .txt")).map((e, k) => { const t = e.textContent.replace(/正し.*$/, ""); const c = Engine.CARDS.find((x) => Engine.cardText(x) === t); return __T.test(c); })');
  for (let k = 0; k < ans.length; k++) await pg.tap('[data-ans="' + k + '"][data-v="' + ((right || k > 0 ? ans[k] : !ans[k]) ? 1 : 0) + '"]');
  await pg.tap('#btnCheck', { noScroll: true });
  await sleep(500);
}
async function freshStart(pg, clock, state) {
  await pg.open(ORIGIN + '/');
  await pg.ev('localStorage.clear(); sessionStorage.clear(); true');
  await pg.clock(clock);
  if (state) await pg.ev('localStorage.setItem("hosoku.v1", ' + JSON.stringify(JSON.stringify(state)) + '); true');
  await pg.reload();
  await pg.ev(HELP);
}
const doneRec = (o) => Object.assign({ state: 'done', obs: [], guess: [], fails: [], tries: 1, judging: false, grade: 2, power: 0.5, rule: 'red', v: 3, openedOnDay: true, solvedOnDay: true }, o || {});

const t0 = Date.now();
try {
  const A = await newPage('A');
  await A.size(375, 667);

  /* はじめての調査 */
  await freshStart(A, '2026-10-21T12:00:00');
  await step('ホーム: 初回は「はじめての調査」の入口を出し、エンジンの版と同じ版で動く（renderHome）', async () => {
    const r = await A.ev('({ tut: !document.querySelector("#tutCard").hidden, view: document.body.dataset.view, v: Engine.VERSION, scroll: history.scrollRestoration })');
    return r.tut && r.view === 'home' && r.v >= 3 && r.scroll === 'manual' ? true : JSON.stringify(r);
  });
  await step('はじめての調査 第1話: 最初の一言は上、カードを作ったら案内は下の帯（375×667 で見える）', async () => {
    await A.tap('#tutGo'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    const top = await A.ev('!!document.querySelector("#playBody .guide")');
    await pickCard(A, { c: 'blue', s: 'square', n: 3 });
    const r = await A.ev('(() => { const g = document.querySelector("#playBar .bar-guide"); if (!g) return null; const b = g.getBoundingClientRect(); return { top: !!document.querySelector("#playBody .guide"), inView: b.top >= 0 && b.bottom <= innerHeight, text: g.textContent }; })()');
    return top && r && !r.top && r.inView ? true : JSON.stringify({ top, r });
  });
  await step('調査の画面（375×667）: 予想（合う／合わない）と［調べる］は下の帯にあり、スクロールせずに押せる', async () => {
    await A.ev('window.scrollTo(0, 0)');
    await A.tap('#playBar [data-guess="0"]', { noScroll: true });
    const r = await A.ev('(() => { const a = document.querySelector("#btnAsk").getBoundingClientRect(); return { ask: a.bottom <= innerHeight && a.top >= 0, dis: document.querySelector("#btnAsk").disabled, benchGuess: !!document.querySelector("#bench [data-guess]") }; })()');
    return r.ask && !r.dis && !r.benchGuess ? true : JSON.stringify(r);
  });
  await step('role=radio: 矢印キーで次を選び、焦点もそこへ動く（描き直しで焦点が消えない）', async () => {
    await A.ev('document.querySelector("[data-pk=\\"c\\"][data-v=\\"blue\\"]").focus()');
    await A.key('ArrowRight');
    const r = await A.ev('({ f: document.activeElement && document.activeElement.dataset.v, sel: document.querySelector("[data-pk=\\"c\\"][aria-checked=\\"true\\"]").dataset.v, tab: Array.from(document.querySelectorAll("[data-pk=\\"c\\"]")).map((e) => e.tabIndex).join(",") })');
    return r.f === 'green' && r.sel === 'green' && r.tab === '-1,-1,0' ? true : JSON.stringify(r);
  });
  await step('調べる（キーボード）: ［調べる］を Enter で押すと答えがめくれ、焦点が消えない・読み上げに「！。」が無い', async () => {
    await A.tap('#playBar [data-guess="1"]', { noScroll: true });
    await A.ev('document.querySelector("#btnAsk").focus()');
    await A.key('Enter');
    await sleep(1500);
    const r = await A.ev('({ obs: __T.st().tutorial.cur.obs.length, act: document.activeElement && document.activeElement !== document.body, live: document.querySelector("#live").textContent })');
    return r.obs === 1 && r.act && !/！。|。。/.test(r.live) && r.live.length > 0 ? true : JSON.stringify(r);
  });
  await step('名前の無い焦点が無い（調査の画面・下の帯）', async () => { const u = await A.ev('__T.unnamed()'); return u.length === 0 ? true : u.join(' '); });
  await step('はじめての調査 第1話: 解いて「この話のポイント」を主役に（★と「もっと絞れた」を出さない）', async () => {
    while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
    await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000);
    await answerJudge(A, true);
    await A.until('document.body.dataset.view === "result"', 3000);
    const r = await A.ev('({ pt: !!document.querySelector(".res-point"), stars: !!document.querySelector(".res-stars"), more: /もっと良い1枚|もっと絞れた/.test(document.querySelector("#resultBody").textContent), power: /調査力/.test(document.querySelector("#resultBody").textContent) })');
    return r.pt && !r.stars && !r.more && !r.power ? true : JSON.stringify(r);
  });
  await step('はじめての調査 第2話: 最初は「×になるカードも試そう」を出さず、○のカードで候補が減らなかったあとに出す', async () => {
    await A.tap('#btnNextTut'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    const L = await A.ev('Engine.tutorial(2).lesson');
    // 候補が減らない○のカード（例と同じ形・色で数だけ違う）
    const flat = await A.ev('(() => { const x = __T.pz().pz; const n0 = Engine.candidates(x, []).length; return Engine.CARDS.find((c) => Engine.test(x, c) && !x.examples.some((e) => Engine.cardIndex(e.card) === Engine.cardIndex(c)) && Engine.candidates(x, [{ card: c }]).length === n0); })()');
    await pickCard(A, flat);
    const g1 = await A.ev('document.querySelector("#playBar .bar-guide .g-main").textContent');
    await A.tap('#playBar [data-guess="1"]', { noScroll: true }); await A.tap('#btnAsk', { noScroll: true }); await sleep(1500);
    const g2 = await A.ev('document.querySelector("#playBar .bar-guide").textContent');
    return g1 === L.first && g1 !== L.ask && g2.includes(L.flat) && g2.includes(L.ask) ? true : JSON.stringify({ g1, g2 });
  });

  /* 今日のルール: 調べる → 確かめの帯 → 判定 → 外れ → もう一度 → 解決 → コピー */
  await freshStart(A, '2026-10-21T12:00:00', { v: 1, tutorial: { done: 3, dismissed: false, cur: null } });
  await step('今日のルール: 調べて、回数が残っていて候補が2つ以上なら確かめの帯（台の下は帯に隠れない）', async () => {
    await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    await askBest(A);
    await A.tap('#btnJudge', { noScroll: true });
    const r = await A.ev('(() => { window.scrollTo(0, document.documentElement.scrollHeight); const bar = document.querySelector("#playBar").getBoundingClientRect(); const b = document.querySelector("#bench").getBoundingClientRect(); return { stay: !!document.querySelector("#btnStay"), focus: document.activeElement && document.activeElement.id, benchBottom: Math.round(b.bottom), barTop: Math.round(bar.top) }; })()');
    return r.stay && r.focus === 'btnStay' && r.benchBottom <= r.barTop ? true : JSON.stringify(r);
  });
  await step('今日のルール: ［調査を続ける］で戻り、最善手で1つに絞ると、判定へ進むときに確かめない（候補が1つ）', async () => {
    await A.tap('#btnStay', { noScroll: true });
    while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
    await A.until('!!document.querySelector(".mt-one")', 3000, '「1つに絞れた」').catch(() => {});
    const one = await A.ev('document.querySelector(".mt-one") && document.querySelector(".mt-one").textContent');
    await A.tap('#btnJudge', { noScroll: true });
    await sleep(300);
    const r = await A.ev('({ judge: !!document.querySelector("#judge"), stay: !!document.querySelector("#btnStay"), meter: document.querySelector(".mt-foot").textContent, focus: document.activeElement && document.activeElement.id })');
    return one === '1つに絞れた' && r.judge && !r.stay && /判定中/.test(r.meter) && !/調べる.*あと/.test(r.meter) && r.focus === 'judgeH' ? true : JSON.stringify({ one, r });
  });
  await step('判定: 答え合わせの前の画面に答えのルール・判定の答え（data-ok など）を書かない', async () => (await A.ev('__T.noAnswerInDom()')) ? true : 'DOM に答え');
  await step('判定: 1枚外すと「もう一度判定」に焦点、新しい5枚で解き直して解決・結果は★1（solve・check・retry）', async () => {
    await answerJudge(A, false);
    const r1 = await A.ev('({ retry: !!document.querySelector("#btnRetry"), focus: document.activeElement && document.activeElement.id, jd: __T.st().daily["2026-10-21"].fails.length })');
    await A.tap('#btnRetry', { noScroll: true });
    const f2 = await A.ev('document.activeElement && document.activeElement.id');
    await answerJudge(A, true);
    await A.until('document.body.dataset.view === "result"', 3000);
    const r = await A.ev('({ st: __T.st().daily["2026-10-21"], aria: document.querySelector(".res-st").getAttribute("aria-label"), focus: document.activeElement && document.activeElement.id })');
    return r1.retry && r1.focus === 'btnRetry' && r1.jd === 1 && f2 === 'judgeH' && r.st.state === 'done' && r.st.grade === 1 && r.st.tries === 2 && r.aria === '結果 ★1' && r.focus === 'resTitle' ? true : JSON.stringify({ r1, f2, r });
  });
  await step('コピー（copyFn）: 「難しさ★」と「結果★」を書き分け、その日の連続、ルールは書かない', async () => {
    await A.tap('#btnCopy'); await sleep(300);
    const r = await A.ev('({ clip: window.__clip[window.__clip.length - 1], rule: Engine.daily("2026-10-21").ruleText, star: Engine.daily("2026-10-21").star, fb: document.querySelector("#copyFb").hidden })');
    const L = (r.clip || '').split('\n');
    return L[0] === '法則ハンター No.2（難しさ★' + r.star + '）' && /^結果★☆☆ 調べ\d回・判定2回$/.test(L[1]) && /^候補 [\d→]+$/.test(L[2]) && L[3] === '連続1日' && L[4] === 'https://kiyotake1229.github.io/hosoku-hunter/' && L.length === 5 && !r.clip.includes(r.rule) && r.fb ? true : JSON.stringify(r);
  });

  /* 練習: 調べずに判定へ → ★2（0回で★3 にならない） */
  await step('練習 ★1: 調べずに判定へ進んで通過しても★2（「見事な調査」を出さない）・調査力は0%と最善の値を並べる', async () => {
    await A.tap('#btnHome'); await A.tap('[data-star="1"]'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    await A.tap('#btnJudge', { noScroll: true }); await A.tap('#btnJudgeGo', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000);
    await answerJudge(A, true);
    await A.until('document.body.dataset.view === "result"', 3000);
    const r = await A.ev('({ aria: document.querySelector(".res-st").getAttribute("aria-label"), msg: document.querySelector(".res-msg").textContent, pw: document.querySelector(".pw-n") && document.querySelector(".pw-n").textContent, best: !!document.querySelector(".pw-best") })');
    return r.aria === '結果 ★2' && !/見事/.test(r.msg) && /調べずに/.test(r.msg) && r.pw === '0' && r.best ? true : JSON.stringify(r);
  });

  /* 動きを減らす設定でも「1つに絞れた」 */
  await A.size(375, 667, 'light', 'reduce');
  await step('動きを減らす設定: 1つに絞れたら、すぐ「1つに絞れた」を出す（発見の演出は出さない）', async () => {
    await A.tap('#btnNext'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    let saw = '';
    while ((await A.ev('__T.cand()')) > 1) { const c = await A.ev('__T.best()'); await pickCard(A, c); await A.tap('#playBar [data-guess="1"]', { noScroll: true }); await A.tap('#btnAsk', { noScroll: true }); await sleep(150); saw = await A.ev('(document.querySelector(".mt-one") || {}).textContent || document.querySelector("#mtN").textContent'); }
    const burst = await A.ev('!!document.querySelector(".burst")');
    return saw === '1つに絞れた' && !burst ? true : JSON.stringify({ saw, burst });
  });
  await A.size(375, 667);

  /* 裏に回ったら音を鳴らさない */
  await step('効果音: 調べた直後に裏へ回ると、そのあとの音（○×・発見）を鳴らさず、音の仕組みを止める', async () => {
    if (await A.ev('document.hidden')) return '検査の前からページが裏にある';
    await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000); await answerJudge(A, true); await A.until('document.body.dataset.view === "result"', 3000);
    await A.tap('#btnNext'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    const c = await A.ev('__T.best()');
    await pickCard(A, c); await A.tap('#playBar [data-guess="1"]', { noScroll: true });
    await A.tap('#btnAsk', { noScroll: true, wait: 0 });
    await A.ev('window.__hide(true)');
    const n0 = await A.ev('window.__osc');
    await sleep(1600);
    const r = await A.ev('({ n: window.__osc, mute: window.__muteReport(), hidden: document.hidden, sound: __T.st().settings.sound })');
    await A.ev('window.__hide(false)');
    return r.n === n0 && r.mute.intercepted >= 1 && r.mute.contexts.every((x) => x.state !== 'running') ? true : JSON.stringify({ n0, r });
  });

  /* 記録帳・図鑑・遊び方・設定 */
  await step('記録帳（renderBook）: もっと見るで30件ずつ足し、押したボタンに焦点が残る', async () => {
    await A.clock('2026-12-15T12:00:00'); await A.ev('window.dispatchEvent(new Event("focus"))');
    await A.tap('#playBack'); await A.tap('#v-home [data-nav="book"]');
    const n1 = await A.ev('document.querySelectorAll("#ledger button[data-day]").length');
    await A.ev('document.querySelector("#bookMore").focus()'); await A.key('Enter');
    const r = await A.ev('({ n: document.querySelectorAll("#ledger button[data-day]").length, more: !!document.querySelector("#bookMore"), f: document.activeElement && (document.activeElement.id || document.activeElement.dataset.day) })');
    // 57日（10-20〜12-15）: 30 → 57 で全部出たら、ボタンを消して足した最初の行（10-15 = 31行目）に焦点
    return n1 === 30 && r.n === 57 && !r.more && r.f === '2026-11-15' ? true : JSON.stringify({ n1, r });
  });
  await step('名前の無い焦点が無い（記録帳・調査力の棒も名前つき）', async () => { const u = await A.ev('__T.unnamed()'); return u.length === 0 ? true : u.join(' '); });
  await step('図鑑（renderZukan）: 標本箱は候補の範囲ごと（21・78・251）、初めて見抜いた日は年から書く', async () => {
    await A.tap('#v-book [data-nav="home"]'); await A.tap('#v-home [data-nav="zukan"]');
    const r = await A.ev('({ box: Array.from(document.querySelectorAll(".zk-box")).map((b) => b.children.length), day: (document.querySelector(".zk-list small") || {}).textContent || "" })');
    return r.box.join(',') === '21,78,251' && /^初めて見抜いた日: 20\d\d年/.test(r.day) ? true : JSON.stringify(r);
  });
  await step('遊び方: はじめての調査が途中なら「第n話の続きから」', async () => {
    await A.ev('(() => { const s = __T.st(); s.tutorial = { done: 1, dismissed: true, cur: { ep: 2, obs: [3], guess: [true], fails: [], tries: 0, judging: false, v: Engine.VERSION } }; localStorage.setItem("hosoku.v1", JSON.stringify(s)); })()');
    await A.reload(); await A.ev(HELP);
    await A.tap('#v-home [data-nav="howto"]');
    const t = await A.ev('document.querySelector("#howTut").textContent');
    return t.includes('第2話の続きから') ? true : t;
  });
  await step('設定（ダーク）: スイッチのつまみが地と見分けられ、color-scheme もダーク', async () => {
    await A.tap('#v-howto [data-nav="home"]'); await A.tap('#v-home [data-nav="settings"]');
    await A.tap('[data-theme-set="dark"]');
    const fdark = await A.ev('document.activeElement && document.activeElement.dataset.themeSet');
    await A.tap('[data-set="haptics"]');   // 片方を切って、入・切の両方のつまみを見る
    const r = await A.ev(`(() => { const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const out = []; document.querySelectorAll('.switch').forEach((s) => { const k = lum(getComputedStyle(s, '::after').backgroundColor), t = lum(getComputedStyle(s).backgroundColor); out.push(((Math.max(k, t) + 0.05) / (Math.min(k, t) + 0.05)).toFixed(2)); });
      return { theme: document.documentElement.dataset.theme, scheme: document.querySelector('#metaScheme').content, cs: document.documentElement.style.colorScheme, ratio: out, f: document.activeElement && document.activeElement.dataset.set }; })()`);
    await A.tap('[data-set="haptics"]');
    return r.theme === 'dark' && r.scheme === 'dark' && r.cs === 'dark' && r.ratio.length === 2 && r.ratio.every((x) => +x >= 3) && fdark === 'dark' && r.f === 'haptics' ? true : JSON.stringify({ r, fdark });
  });
  await step('記録を消す（wipe）: 2段階で消し、設定（ダーク）は残す', async () => {
    await A.tap('#wipeAsk'); const f = await A.ev('document.activeElement && document.activeElement.id');
    await A.tap('#wipeYes');
    const s = await A.ev('__T.st()');
    return f === 'wipeNo' && s && Object.keys(s.daily).length === 0 && s.practice.solved === 0 && s.settings.theme === 'dark' && s.epoch ? true : JSON.stringify({ f, s });
  });

  /* 連続日数: 0〜3時に「今日 → 昨日」の順、3時で「昨日の No.n」が消える */
  await A.size(375, 667);
  const st0 = { v: 1, tutorial: { done: 3, dismissed: false, cur: null }, daily: { '2026-10-20': doneRec(), '2026-10-21': doneRec() }, stats: { streak: 2, bestStreak: 2, lastDailyDate: '2026-10-21', totalSolved: 2 } };
  await freshStart(A, '2026-10-22T23:30:00', st0);
  await step('連続: 夜（23:30）に開いた No.3 を残し、0時半に今日の No.4、1時に昨日の No.3 を解くと連続4日（ホームとコピー）', async () => {
    await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP); await askBest(A); await A.tap('#playBack');
    await A.clock('2026-10-23T00:30:00'); await A.reload(); await A.ev(HELP);
    const note = await A.ev('(document.querySelector("#homeNote [data-pending]") || {}).textContent || ""');
    await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
    await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000); await answerJudge(A, true); await A.until('document.body.dataset.view === "result"', 3000);
    await A.clock('2026-10-23T01:00:00'); await A.tap('#btnHome');
    await A.tap('#homeNote [data-pending]'); await A.until('document.querySelector("#bench, #judge")', 3000); await A.ev(HELP);
    const title = await A.ev('document.querySelector("#tbTitle").textContent');
    while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
    await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000); await answerJudge(A, true); await A.until('document.body.dataset.view === "result"', 3000);
    await A.tap('#btnCopy'); await sleep(200);
    const clip = await A.ev('window.__clip[window.__clip.length - 1]');
    await A.tap('#btnHome');
    const home = await A.ev('document.querySelector("#streakLine").textContent');
    const s = await A.ev('__T.st().stats');
    return /昨日の No\.3 が調査中です/.test(note) && /連続2日がつながります/.test(note) && title === 'No.3 のルール' && /連続 4日/.test(home) && s.streak === 4 && s.bestStreak === 4 && /\n連続3日\nhttps:\/\/kiyotake1229\.github\.io\/hosoku-hunter\/$/.test(clip) ? true : JSON.stringify({ note, title, home, s, clip });
  });
  await step('3時を過ぎたら「昨日の No.n」のお知らせを消す（日付が変わらなくても描き直す）', async () => {
    await freshStart(A, '2026-10-22T23:30:00', st0);
    await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP); await askBest(A); await A.tap('#playBack');
    await A.clock('2026-10-23T02:59:50'); await A.reload();
    const before = await A.ev('!!document.querySelector("#homeNote [data-pending]")');
    await A.clock('2026-10-23T03:00:30'); await A.ev('window.dispatchEvent(new Event("focus"))');
    const after = await A.ev('!!document.querySelector("#homeNote [data-pending]")');
    return before && !after ? true : JSON.stringify({ before, after });
  });

  /* 別のタブ */
  await freshStart(A, '2026-10-21T12:00:00', { v: 1, tutorial: { done: 3, dismissed: false, cur: null } });
  const B = await newPage('B');
  await B.size(375, 667);
  await step('別のタブ: 片方が判定に進んだら、もう片方（調べる途中）も判定になり、判定の記録を消さない', async () => {
    await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    await B.open(ORIGIN + '/'); await B.clock('2026-10-21T12:00:00'); await B.reload(); await B.ev(HELP);
    await B.tap('#tOpen'); await B.until('document.querySelector("#bench")', 3000); await B.ev(HELP);
    await B.tap('#btnJudge', { noScroll: true }); await B.tap('#btnJudgeGo', { noScroll: true }); await B.until('document.querySelector("#judge")', 2000);
    await A.until('!!document.querySelector("#judge")', 3000, 'A も判定になる');
    await A.ev('document.dispatchEvent(new Event("visibilitychange"))');
    const r = await A.ev('__T.st().daily["2026-10-21"]');
    return r.judging === true && r.state === 'playing' ? true : JSON.stringify(r);
  });
  await step('別のタブ: 同じ練習を2つのタブで開いて片方で解くと、もう片方は結果になり、二重に数えない', async () => {
    await A.tap('#playBack'); await A.tap('[data-star="2"]'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
    await B.tap('#playBack'); await B.tap('[data-star="2"]'); await B.until('document.querySelector("#bench")', 3000); await B.ev(HELP);
    while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
    await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000); await answerJudge(A, true); await A.until('document.body.dataset.view === "result"', 3000);
    await B.until('document.body.dataset.view === "result"', 3000, 'B も結果になる');
    await B.ev('document.dispatchEvent(new Event("visibilitychange"))');
    const s = await A.ev('__T.st().practice');
    return s.solved === 1 && s.byStar[2] === 1 ? true : JSON.stringify(s);
  });
  B.close();

  /* iframe（Artifact のような環境）でコピーの返事が遅れる */
  await step('iframe: コピーの返事が遅れたら手でコピーする欄を出し、あとから来た返事で「コピーしました」を重ねない', async () => {
    await A.open(ORIGIN + '/frame.html'); await sleep(400);
    const W = 'document.querySelector("#f").contentWindow';
    await A.ev(W + '.eval(' + JSON.stringify(MUTE) + ')');
    await A.ev(`(() => { const w = ${W}; const s = { v: 1, tutorial: { done: 3, dismissed: false, cur: null }, daily: { "2026-10-21": ${JSON.stringify(doneRec({ rule: undefined }))} } }; w.localStorage.setItem("hosoku.v1", JSON.stringify(s)); w.__setClock("2026-10-21T12:00:00"); w.location.reload(); return true; })()`);
    await sleep(800);
    await A.ev(W + '.eval(' + JSON.stringify(MUTE) + ')');
    await A.ev(`(() => { const w = ${W}; w.__clipDelay = 2600; w.document.querySelector("#tOpen").click(); return true; })()`);
    await sleep(600);
    await A.ev(`${W}.document.querySelector("#btnCopy").click()`);
    await sleep(1800);
    const r1 = await A.ev(`({ fb: !${W}.document.querySelector("#copyFb").hidden, toast: ${W}.document.querySelector("#toast").textContent })`);
    await sleep(1400);
    const r2 = await A.ev(`({ fb: !${W}.document.querySelector("#copyFb").hidden, toast: ${W}.document.querySelector("#toast").textContent })`);
    return r1.fb && /コピーできない/.test(r1.toast) && r2.fb && !/コピーしました/.test(r2.toast) ? true : JSON.stringify({ r1, r2 });
  });

  /* PWA（#0004）: 直接開いたときだけ manifest・apple-touch-icon を置き、Service Worker を登録する */
  await step('PWA: 直接開くと manifest と apple-touch-icon を置き、Service Worker を登録して先にキャッシュする（manifest もエラーなく読める）', async () => {
    await A.open(ORIGIN + '/');
    const reg = await A.ev('Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((res) => setTimeout(() => res(false), 8000))])');
    const r = await A.ev('(async () => ({ links: Array.from(document.querySelectorAll("link[rel=manifest],link[rel=apple-touch-icon]")).map((l) => l.rel + " " + l.getAttribute("href")).join(","), keys: await caches.keys(), n: (await (await caches.open("hosoku-app-v1")).keys()).length }))()');
    const man = await A.send('Page.getAppManifest');
    const data = (() => { try { return JSON.parse(man.data || 'null'); } catch (e) { return null; } })();
    return reg && r.links === 'apple-touch-icon apple-touch-icon.png,manifest manifest.json' && r.keys.includes('hosoku-app-v1') && r.n >= 7 && (man.errors || []).length === 0 && data && data.name === '法則ハンター' ? true : JSON.stringify({ reg, r, errors: man.errors, name: data && data.name });
  });
  await step('PWA: iframe（Artifact のような環境）の中では manifest・apple-touch-icon を置かず、Service Worker も登録しない', async () => {
    await A.ev('(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return true; })()');
    await A.open(ORIGIN + '/frame.html'); await sleep(1500);
    const W = 'document.querySelector("#f").contentWindow';
    const r = await A.ev(`(async () => ({ links: ${W}.document.querySelectorAll("link[rel=manifest],link[rel=apple-touch-icon]").length, regs: (await navigator.serviceWorker.getRegistrations()).length, home: !${W}.document.querySelector("#v-home").hidden }))()`);
    return r.links === 0 && r.regs === 0 && r.home ? true : JSON.stringify(r);
  });

  /* 幅とライト/ダーク: 横にはみ出さない・「1つに絞れた」が改行で分かれない */
  for (const [w, h, sc] of [[320, 568, 'light'], [360, 740, 'dark'], [375, 667, 'light'], [1280, 900, 'dark']]) {
    await step(`幅 ${w}（${sc}）: ホーム・調査・判定・結果・記録帳・図鑑・遊び方・設定で横にはみ出さない・「1つに絞れた」が1行`, async () => {
      await A.size(w, h, sc);
      await freshStart(A, '2026-10-24T12:00:00', { v: 1, tutorial: { done: 3, dismissed: false, cur: null } });
      const bad = [];
      const ov = async (tag) => { const o = await A.ev('__T.overflow()'); if (o.sw > o.iw || o.out.length) bad.push(tag + ' ' + JSON.stringify(o)); };
      await ov('home');
      await A.tap('#tOpen'); await A.until('document.querySelector("#bench")', 3000); await A.ev(HELP);
      while ((await A.ev('__T.cand()')) > 1) if (!(await askBest(A))) break;
      await A.until('!!document.querySelector(".mt-one")', 3000, '「1つに絞れた」').catch(() => {});
      await ov('play');
      const one = await A.ev('(() => { const e = document.querySelector(".mt-one"); return e ? e.getClientRects().length : -1; })()');
      if (one !== 1) bad.push('1つに絞れた の行 ' + one);
      await A.tap('#btnJudge', { noScroll: true }); await A.until('document.querySelector("#judge")', 2000); await ov('judge');
      await answerJudge(A, true); await A.until('document.body.dataset.view === "result"', 3000); await sleep(1800); await ov('result');
      await A.tap('#btnHome');
      for (const v of ['book', 'zukan', 'howto', 'settings']) {
        await A.ev(`document.querySelector('#v-home [data-nav="${v}"]').click()`); await sleep(150);
        if ((await A.ev('document.body.dataset.view')) !== v) bad.push(v + ' が開かない');
        await ov(v);
        await A.ev(`document.querySelector('#v-${v} [data-nav="home"]').click()`); await sleep(120);
      }
      return bad.length ? bad.join(' / ') : true;
    });
  }
  await step('コンソールのエラー・警告が 0（すべての操作のあいだ）', async () => (errors.length ? errors.slice(0, 5).join(' / ') : true));
  A.close();
} catch (e) {
  check('検査を最後まで動かせる', false, e.message);
} finally {
  await cleanup();
}

let fail = 0;
if (RUN_MUTANTS) await runMutants();
console.log('検査対象: ' + target + '（Chrome: ' + path.basename(CHROME) + '）\n');
for (const r of results) { if (!r.ok) fail++; console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` + (r.ok ? '' : '\n        ' + r.detail)); }
console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${results.length}項目  (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
if (FAIL_OUT) fs.writeFileSync(FAIL_OUT, JSON.stringify(results.filter((r) => !r.ok).map((r) => r.name)));
process.exit(fail || mutantMiss ? 1 : 0);

/* ---------- わざとバグを入れた写し（--mutants） ----------
 * 画面のコードを1か所ずつ書き換えた写しを一時フォルダに作り、この検査にかける（3本ずつ。1本1〜2分）。
 * 写しごとに、狙った検査項目が FAIL すること（＝この検査がその不具合を見つけられること）を確かめる。 */
var mutantMiss = false;
async function runMutants() {
  const M = [
    ['裏に回っても効果音を鳴らす（document.hidden を見ない）', [['if (!S.settings.sound || document.hidden) return;\n    const ac', 'if (!S.settings.sound) return;\n    const ac'], ['if (!S.settings.sound || document.hidden) return null;', 'if (!S.settings.sound) return null;']], '効果音'],
    ['動きを減らす設定でもメーターを数え下げる（「1つに絞れた」がすぐ出ない）', [['const anim = o.from != null && o.from !== n && !reduceMotion();', 'const anim = o.from != null && o.from !== n;']], '動きを減らす設定'],
    ['別のタブで先に進んだ問題を開き直さない', [['if (moved) { startCase(spec, P.pz);', 'if (false) { startCase(spec, P.pz);']], '別のタブ'],
    ['iframe で遅れて来たコピーの返事も使う（両方の表示が出る）', [['navigator.clipboard.writeText(text).then(() => { if (settled) return; settled = true; if (fb) fb.hidden = true;', 'navigator.clipboard.writeText(text).then(() => { settled = true;']], 'iframe'],
    ['3時になっても「昨日の No.n」を描き直さない', [['if (d === lastDay && behind === lastBehind && pend === lastPend) return;', 'if (d === lastDay && behind === lastBehind) return;']], '3時'],
    ['候補が1つでも判定前に確かめる', [['if (leftOf(P) > 0 && candCount(P) > 1 && !P.confirm)', 'if (leftOf(P) > 0 && !P.confirm)']], '今日のルール: ［調査を続ける］'],
    ['role=radio の矢印キーを受けない', [["if (!t || !t.getAttribute || t.getAttribute('role') !== 'radio') return;", 'return;']], 'role=radio'],
    ['過去の日のコピーに今日の連続を書く', [["copyText(P, P.mode === 'daily' && P.rec && P.rec.solvedOnDay ? streakOfDay(P.date) : 0)", 'copyText(P, streakNow())']], '連続'],
    ['調査の画面の下の余白を固定（確かめの帯で台の下が隠れる）', [['body[data-view="play"] #app{padding-bottom:calc(var(--bar-h, 170px) + 20px)}', 'body[data-view="play"] #app{padding-bottom:calc(112px + env(safe-area-inset-bottom))}']], '今日のルール: 調べて'],
    ['描き直したあとに焦点を戻さない', [['    if (had) refocus(sel, fallback);\n', '\n']], '調べる（キーボード）'],
    ['設定のスイッチのつまみを地の色にする（ダークで見えにくい）', [['background:var(--knob);', 'background:var(--paper);']], '設定'],
  ];
  const SRC = fs.readFileSync(target, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosoku-ui-mutants-'));
  console.log('\nわざとバグを入れた写しの検査（' + M.length + '種。3本ずつ）:');
  const runOne = (m, k) => new Promise((resolve) => {
    let src = SRC;
    for (const [from, to] of m[1]) { const n = src.split(from).length - 1; if (n !== 1) { resolve({ m, skip: '書き換える場所が ' + n + ' か所: ' + from.slice(0, 40) }); return; } src = src.replace(from, to); }
    const file = path.join(dir, 'mutant' + k + '.html'), out = path.join(dir, 'fail' + k + '.json');
    fs.writeFileSync(file, src);
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), file, '--fail-out', out, '--root', ROOT].concat(opt('--chrome', null) ? ['--chrome', opt('--chrome', null)] : []), { stdio: 'ignore' });
    ch.on('close', (code) => { let failed = []; try { failed = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { failed = ['（結果なし）']; } resolve({ m, code, failed }); });
  });
  try {
    const res = new Array(M.length); let next = 0;
    await Promise.all([0, 1, 2].map(async () => { while (next < M.length) { const k = next++; res[k] = await runOne(M[k], k); } }));
    for (const r of res) {
      if (r.skip) { console.log('  SKIP    ' + r.m[0] + '（' + r.skip + '）'); mutantMiss = true; continue; }
      const hit = r.code === 1 && r.failed.some((f) => f.startsWith(r.m[2]));
      if (!hit) mutantMiss = true;
      console.log('  ' + (hit ? '見つけた' : '見逃した') + '  ' + r.m[0] + '  → FAIL ' + r.failed.length + '項目（' + r.failed.slice(0, 2).join(' / ') + '）');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(mutantMiss ? '  見逃した写しがある（検査を強くする）' : '  すべての写しで、狙った検査項目が FAIL を出した\n');
}
