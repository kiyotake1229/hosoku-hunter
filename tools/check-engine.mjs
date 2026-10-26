#!/usr/bin/env node
// 法則ハンター — エンジン検査
// 使い方: node tools/check-engine.mjs [index.html | engine.js] [--count 200] [--days 365] [--no-golden] [--no-perf] [--mutants]
// .html なら「// ==ENGINE START==」〜「// ==ENGINE END==」の間を取り出して評価する。.js ならそのまま評価する。
// 検算はエンジンの関数を使わず、ここで独立に書く（カード45枚・部品・ルールの全数の書き出しと○×の表のまとめ・
// いちばん簡単な言い方（level → cost）・文を読み直した○×の表・候補の数え方・最善手（同点の選び方まで）・最善手の流れと公平さ
// （同点のどれを選んでも届くこと＝sure）・
// 判定の5枚の性質（候補が2つ以上なら答えによらず同じ5枚）・結果の★・ふり返りと調査力・答えの集まり（= 候補の範囲）・日替わりの★と間隔）。
// --count = ★ごとの練習の問題数、--days = 日替わりの日数（2026-10-20 から）、--no-golden = 回帰ハッシュを見ない、
// --mutants = わざとバグを入れた写しを作って、この検査が FAIL を出すことを確かめる（写しは OS の一時フォルダに作って消す）。
// 外部パッケージは使わない（Node.js だけで動く）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const OPT_NAMES = ['--count', '--days', '--fail-out'];
const optIdx = new Set(OPT_NAMES.map((n) => argv.indexOf(n)).filter((i) => i >= 0).map((i) => i + 1));
const target = path.resolve(argv.find((a, i) => !a.startsWith('--') && !optIdx.has(i)) || path.join(here, '..', 'index.html'));
const COUNT = parseInt(opt('--count', '200'), 10);
const DAYS = parseInt(opt('--days', '365'), 10);
const NO_GOLDEN = argv.includes('--no-golden');
const RUN_MUTANTS = argv.includes('--mutants');
const NO_PERF = argv.includes('--no-perf');   // 時間の検査をしない（写しを同時に何本も検査するとき。時間は当てにならない）
const FAIL_OUT = opt('--fail-out', null);   // 写しの検査で、FAIL した項目の名前を書き出す先（--mutants が使う）

/* ---------- 回帰テストの基準（問題が変わっていないか） ----------
 * VERSION ごとに、次の3つの SHA-256（先頭32文字）を持つ。
 *   daily365    = 2026-10-20 から365日分の JSON.stringify(Engine.daily(日付)) + '\n' をつないだもの
 *   practice120 = ★1〜3 × seed 'r0'〜'r39' の JSON.stringify(Engine.generate({seed, star})) + '\n' をつないだもの
 *   fixed4      = はじめての調査 1〜3 と遊び方の例の JSON.stringify(...) + '\n' をつないだもの
 * 値が変わったら、全員の日替わり・練習・はじめての調査の問題が変わったということ。
 * 意図した変更なら、エンジンの VERSION を上げて docs に書き、ここに新しい VERSION の値を足す。 */
const GOLDEN = {
  // 1: 最初の版（ルール350通り・候補の範囲 21/99/350・上限 3/4/5・公平さ ★1★2 sure=1・★3 sure≥0.8）
  1: { daily365: '7ced5eb2f95a809cf8c2c6e73b78c07d', practice120: 'b81a1aea52a8cf8615c6390ffdcbad51', fixed4: 'c3be03e16ecadc875b8d6f5814fdc336' },
  // 2: ★3 の上限を 5 → 6 回・どの★も sure = 1（★3 の日替わり・練習が変わる）
  2: { daily365: '94a61ad359dec754da5c08a0cd68e7f3', practice120: 'bd4a797e78fb109c40e4dfef2e0a5d86', fixed4: 'b533c0bfede556fdbd96289ca77c7761' },
  // 3: 答えの集まり = 候補の範囲（★1 21・★2 99・★3 350）・判定の5枚は候補が2つ以上なら答えを使わない・結果の★と調査力の決まり・
  //    日替わりの並べ方（週ごと・2つの組）・はじめての調査の案内と遊び方の例（すべての問題が変わる）
  3: { daily365: 'e043f2e67a941e45f9e95fbe9872ccd7', practice120: 'df36876bfe3f9c5786d6fd3c2b359d0e', fixed4: '7b992706172291017b92af57f07ef9e3' },
};

/* ---------- 決まり（エンジンとは別にここで持つ。仕様書と、エンジンを作るときに決めた値） ---------- */
const DAY1 = '2026-10-20';
const WEEK = { 0: 3, 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3 };   // 曜日（0 = 日曜）→ ★。月火 ★1・水木金 ★2・土日 ★3
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const BUDGET = { 1: 3, 2: 4, 3: 6 };                         // 調べる上限（★3 は VERSION 2 で 5 → 6）
const MIN_START = { 1: 3, 2: 8, 3: 16 };                     // 例の2枚のあとに残る候補の下限（調べる前から分かってしまわない）
const SURE_MIN = { 1: 1, 2: 1, 3: 1 };                       // 最善手の同点をでたらめに選んでも上限の中で候補が1つになる確率の下限（VERSION 1 の★3 は 0.8）
const NEAR_DAYS = 7;                                         // 日替わりで、同じルールはこの日数以内に出さない
const PERF = { avg: 50, max: 300, call: 20 };                // 生成の平均・最大、bestQuestion・judgeCards 1回（ms。Node。スマホは4〜6倍遅い）
const BAD = /undefined|NaN|null|\[object|Infinity/;
const COLORS = ['red', 'blue', 'green'];
const SHAPES = ['circle', 'triangle', 'square'];
const CW = { 赤: 'red', 青: 'blue', 緑: 'green' };
const SW = { 丸: 'circle', 三角: 'triangle', 四角: 'square' };

/* ---------- 読み込み ---------- */
if (!fs.existsSync(target)) {
  console.log('検査対象: ' + target + '\n\nFAIL  検査対象がありません（ファイルが無い）: ' + target);
  process.exit(1);
}
const SRC = fs.readFileSync(target, 'utf8');
function extractCode(file) {
  if (!file.endsWith('.html')) return SRC;
  const lines = SRC.split('\n');
  const s = lines.findIndex((l) => l.includes('// ==ENGINE START=='));
  const e = lines.findIndex((l) => l.includes('// ==ENGINE END=='));
  if (s < 0 || e < 0 || e <= s) throw new Error('ENGINE START/END の目印が見つかりません: ' + file);
  return lines.slice(s + 1, e).join('\n');
}
function loadEngine(code) {
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;module.exports = (typeof Engine !== "undefined") ? Engine : module.exports;', sandbox, { filename: path.basename(target) });
  const E = sandbox.module.exports;
  for (const fn of ['generate', 'daily', 'dailyConfig', 'test', 'candidates', 'bestQuestion', 'judgeCards', 'review', 'grade', 'tutorial', 'example', 'cardIndex', 'cardText', 'ruleById', 'table']) {
    if (typeof E[fn] !== 'function') throw new Error('Engine.' + fn + ' がありません');
  }
  return E;
}
// Web Worker と同じ条件で読む: window・document・module が無く、self（= グローバル）だけがある
function loadAsWorker(code) {
  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.postMessage = () => {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(target) + ' (worker)' });
  return sandbox.self.Engine;
}
const code = extractCode(target);
const E = loadEngine(code);
const E2 = loadEngine(code); // 再現性の確認用（キャッシュを共有しない別インスタンス）
const fresh = () => loadEngine(code);

/* ---------- 結果の記録 ---------- */
process.on('uncaughtException', (e) => {
  console.log('\nFAIL  検査の途中でエンジンが例外を出しました: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e));
  if (FAIL_OUT) fs.writeFileSync(FAIL_OUT, JSON.stringify(['例外']));
  process.exit(1);
});
const results = [];
const failures = {};
function record(name, ok, detail) {
  let r = results.find((x) => x.name === name);
  if (!r) { r = { name, pass: 0, fail: 0 }; results.push(r); }
  if (ok) r.pass++;
  else {
    r.fail++;
    failures[name] = failures[name] || [];
    if (failures[name].length < 5) failures[name].push(detail);
  }
  return ok;
}
function hasUndefined(o) {
  if (o === undefined) return true;
  if (typeof o === 'number' && !Number.isFinite(o)) return true;
  if (o && typeof o === 'object') return Object.values(o).some(hasUndefined);
  return false;
}

/* ===================== 独立した決まり ===================== */
// カード: 番号 = 色*15 + 形*5 + (数-1)
const CARDS = [];
for (const c of COLORS) for (const s of SHAPES) for (let n = 1; n <= 5; n++) CARDS.push({ c, s, n });
const NC = 45;
const idxOf = (x) => (x && COLORS.includes(x.c) && SHAPES.includes(x.s) && Number.isInteger(x.n) && x.n >= 1 && x.n <= 5 ? COLORS.indexOf(x.c) * 15 + SHAPES.indexOf(x.s) * 5 + x.n - 1 : -1);
const sameCard = (a, b) => !!a && !!b && a.c === b.c && a.s === b.s && a.n === b.n;
const cardKeys = (o) => (o && typeof o === 'object' ? Object.keys(o).sort().join(',') : '');

// 部品（22個）。cost: 色・形が◯ 1、ではない 2、数 2
const PARTS = [];
for (const v of COLORS) PARTS.push({ k: 'color', v, not: false });
for (const v of SHAPES) PARTS.push({ k: 'shape', v, not: false });
for (const v of COLORS) PARTS.push({ k: 'color', v, not: true });
for (const v of SHAPES) PARTS.push({ k: 'shape', v, not: true });
for (let v = 2; v <= 5; v++) PARTS.push({ k: 'num', op: 'ge', v });
for (let v = 1; v <= 4; v++) PARTS.push({ k: 'num', op: 'le', v });
PARTS.push({ k: 'num', op: 'even' }, { k: 'num', op: 'odd' });
function partValid(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.k === 'color') return COLORS.includes(p.v) && typeof p.not === 'boolean' && cardKeys(p) === 'k,not,v';
  if (p.k === 'shape') return SHAPES.includes(p.v) && typeof p.not === 'boolean' && cardKeys(p) === 'k,not,v';
  if (p.k === 'num') {
    if (p.op === 'ge') return Number.isInteger(p.v) && p.v >= 2 && p.v <= 5;
    if (p.op === 'le') return Number.isInteger(p.v) && p.v >= 1 && p.v <= 4;
    return p.op === 'even' || p.op === 'odd';
  }
  return false;
}
function partHolds(p, x) {
  if (p.k === 'color') return (x.c === p.v) !== p.not;
  if (p.k === 'shape') return (x.s === p.v) !== p.not;
  if (p.op === 'ge') return x.n >= p.v;
  if (p.op === 'le') return x.n <= p.v;
  if (p.op === 'even') return x.n % 2 === 0;
  return x.n % 2 === 1;
}
const partCost = (p) => (p.k === 'num' ? 2 : p.not ? 2 : 1);
const repCost = (op, ps) => ps.reduce((s, p) => s + partCost(p), 0) + (op === 'and' ? 1 : op === 'or' ? 2 : 0);
// level 1 = 色か形が◯、2 = ではない・数の部品1つと、ではないを使わないかつ、3 = それ以外
function repLevel(op, ps) {
  if (op === 'one') return ps[0].k !== 'num' && !ps[0].not ? 1 : 2;
  if (op === 'and') return ps.every((p) => !p.not) ? 2 : 3;
  return 3;
}
function repTable(op, ps) {
  let s = '';
  for (const x of CARDS) {
    const v = op === 'one' ? partHolds(ps[0], x) : op === 'and' ? partHolds(ps[0], x) && partHolds(ps[1], x) : partHolds(ps[0], x) || partHolds(ps[1], x);
    s += v ? '1' : '0';
  }
  return s;
}
const ALL0 = '0'.repeat(NC), ALL1 = '1'.repeat(NC);
// 全部の言い方を書き出し、表ごとに最も簡単な (level, cost) を求める
const MIN_REP = new Map();
{
  const reps = PARTS.map((p) => ['one', [p]]);
  for (let i = 0; i < PARTS.length; i++) for (let j = i + 1; j < PARTS.length; j++) for (const op of ['and', 'or']) reps.push([op, [PARTS[i], PARTS[j]]]);
  for (const [op, ps] of reps) {
    const t = repTable(op, ps);
    if (t === ALL0 || t === ALL1) continue;
    const lv = repLevel(op, ps), c = repCost(op, ps);
    const o = MIN_REP.get(t);
    if (!o || lv < o.level || (lv === o.level && c < o.cost)) MIN_REP.set(t, { level: lv, cost: c });
  }
}
// mask（45bit の数）→ 表
const maskTable = (m) => { let s = ''; for (let i = 0; i < NC; i++) s += Math.floor(m / 2 ** i) % 2 === 1 ? '1' : '0'; return s; };

/* ---------- 文を読み直す（決めた言い回しだけを読む。読めない・意味が違うなら FAIL） ---------- */
function numPred(s) {
  let m;
  if (s === '数が偶数') return (n) => n % 2 === 0;
  if (s === '数が奇数') return (n) => n % 2 === 1;
  if ((m = /^数が([1-5])以上$/.exec(s))) return (n) => n >= +m[1];
  if ((m = /^数が([1-5])以下$/.exec(s))) return (n) => n <= +m[1];
  if ((m = /^数が([1-5])ではない$/.exec(s))) return (n) => n !== +m[1];
  if ((m = /^数が([1-5])$/.exec(s))) return (n) => n === +m[1];
  if ((m = /^数が([1-5])か([1-5])$/.exec(s))) return (n) => n === +m[1] || n === +m[2];
  if ((m = /^数が([1-5])〜([1-5])$/.exec(s))) return (n) => n >= +m[1] && n <= +m[2];
  if ((m = /^数が([1-5](?:・[1-5])+)のどれか$/.exec(s))) { const L = m[1].split('・').map(Number); return (n) => L.includes(n); }
  return null;
}
const colorOf = (w) => CW[w], shapeOf = (w) => SW[w];
function attrPred(w) {   // 「赤」「丸」
  if (CW[w]) return (x) => x.c === CW[w];
  if (SW[w]) return (x) => x.s === SW[w];
  return null;
}
function shortPred(s) {   // または の片方
  let m;
  if ((m = /^(赤|青|緑|丸|三角|四角)$/.exec(s))) return attrPred(m[1]);
  if ((m = /^(赤|青|緑|丸|三角|四角)ではない$/.exec(s))) { const f = attrPred(m[1]); return (x) => !f(x); }
  const np = numPred(s);
  return np ? (x) => np(x.n) : null;
}
const TE = { 赤くて: 'red', 青くて: 'blue', 緑で: 'green' };
const ADJ = { 赤い: 'red', 青い: 'blue', 緑の: 'green' };
function parseText(t) {
  let m;
  if (t.includes('ないで、')) return null;   // 「〜ではないで、」は日本語として不自然
  if ((m = /^(.+)、または(.+)$/.exec(t))) { const a = shortPred(m[1]), b = shortPred(m[2]); return a && b ? (x) => a(x) || b(x) : null; }
  if ((m = /^(赤い|青い|緑の)(丸|三角|四角)以外$/.exec(t))) return (x) => !(x.c === ADJ[m[1]] && x.s === SW[m[2]]);
  if ((m = /^(赤い|青い|緑の)カード$/.exec(t))) return (x) => x.c === ADJ[m[1]];
  if ((m = /^(丸|三角|四角)のカード$/.exec(t))) return (x) => x.s === SW[m[1]];
  if ((m = /^(赤|青|緑|丸|三角|四角)ではない$/.exec(t))) { const f = attrPred(m[1]); return (x) => !f(x); }
  if ((m = /^(赤くて|青くて|緑で)(丸|三角|四角)$/.exec(t))) return (x) => x.c === TE[m[1]] && x.s === SW[m[2]];
  if ((m = /^(赤くて|青くて|緑で)、(丸|三角|四角)ではない$/.exec(t))) return (x) => x.c === TE[m[1]] && x.s !== SW[m[2]];
  if ((m = /^(丸|三角|四角)で、(赤|青|緑)ではない$/.exec(t))) return (x) => x.s === SW[m[1]] && x.c !== CW[m[2]];
  if ((m = /^(赤|青|緑)ではなく、(丸|三角|四角)でもない$/.exec(t))) return (x) => x.c !== CW[m[1]] && x.s !== SW[m[2]];
  if ((m = /^(赤くて|青くて|緑で)、(数が.+)$/.exec(t))) { const np = numPred(m[2]); return np ? (x) => x.c === TE[m[1]] && np(x.n) : null; }
  if ((m = /^(丸|三角|四角)で、(数が.+)$/.exec(t))) { const np = numPred(m[2]); return np ? (x) => x.s === SW[m[1]] && np(x.n) : null; }
  if ((m = /^(数が.+)で、(赤|青|緑|丸|三角|四角)ではない$/.exec(t))) { const np = numPred(m[1]), f = attrPred(m[2]); return np ? (x) => np(x.n) && !f(x) : null; }
  const np = numPred(t);
  return np ? (x) => np(x.n) : null;
}
const predTable = (f) => CARDS.map((x) => (f(x) ? '1' : '0')).join('');

/* ===================== ルールの表 ===================== */
const RULES = E.RULES;
const NR = RULES.length;
const TB = [];          // TB[r][i] = 1 なら○（mask から読む。mask が parts と合うかは下で確かめる）
const COST = [], LVL = [], SCP = [];
const ID2R = new Map();
{
  const tables = new Set(), texts = new Set(), ids = new Set();
  let order = true;
  RULES.forEach((r, i) => {
    const tag = `[ルール ${i} ${r.id} ${r.text}]`;
    const shapeOk = r && typeof r.id === 'string' && typeof r.text === 'string' && ['one', 'and', 'or'].includes(r.op) && Array.isArray(r.parts) &&
      r.parts.length === (r.op === 'one' ? 1 : 2) && r.parts.every(partValid) && Number.isInteger(r.mask) && r.mask >= 0 && r.mask < 2 ** 45;
    record('ルール表: 形（id・文・op・部品・mask）', shapeOk, tag + ' ' + JSON.stringify(r));
    if (!shapeOk) { TB.push(new Uint8Array(NC)); COST.push(99); LVL.push(9); SCP.push(9); return; }
    const t = maskTable(r.mask);
    const tp = repTable(r.op, r.parts);
    record('ルール表: mask は部品から計算した○×の表と同じ', t === tp, tag + ` mask=${t} 部品=${tp}`);
    record('ルール表: 全部○・全部×のルールは無い', t !== ALL0 && t !== ALL1, tag);
    record('ルール表: ○×の表が同じルールは1つにまとめる（表の重複なし）', !tables.has(t), tag);
    tables.add(t);
    const lv = repLevel(r.op, r.parts), c = repCost(r.op, r.parts), mn = MIN_REP.get(t);
    record('ルール表: level・cost が部品の決まりどおり', r.level === lv && r.cost === c, tag + ` level ${r.level}/${lv} cost ${r.cost}/${c}`);
    record('ルール表: 残した言い方がいちばん簡単（同じ表の言い方の中で level → cost が最小）', !!mn && lv === mn.level && c === mn.cost, tag + ` 残した ${lv}/${c} 最小 ${mn && mn.level}/${mn && mn.cost}`);
    const sc = lv === 3 ? 3 : r.parts.some((p) => p.k === 'num') ? 2 : 1;
    record('ルール表: 候補の範囲 scope（1 = 色と形だけの level≤2、2 = level≤2、3 = すべて）', r.scope === sc, tag + ` scope ${r.scope}/${sc}`);
    record('ルール表: size = ○の枚数', r.size === t.split('1').length - 1, tag);
    record('ルール表: 文の重複なし', !texts.has(r.text), tag);
    texts.add(r.text);
    record('ルール表: id の重複なし', !ids.has(r.id), tag);
    ids.add(r.id);
    record('ルール表: 文に機械的な文字列が無い', !BAD.test(r.text) && r.text.length >= 3 && r.text.length <= 22, tag);
    const f = parseText(r.text);
    record('ルール表: 文を読み直すと同じ○×の表になる（読み違いのない言い回し）', !!f && predTable(f) === t, tag + (f ? ' 読み直し ' + predTable(f) + ' / 表 ' + t : ' 読めない言い回し'));
    if (i > 0 && (RULES[i - 1].level > r.level || (RULES[i - 1].level === r.level && RULES[i - 1].cost > r.cost))) order = false;
    const tb = new Uint8Array(NC);
    for (let k = 0; k < NC; k++) tb[k] = t[k] === '1' ? 1 : 0;
    TB.push(tb); COST.push(c); LVL.push(lv); SCP.push(sc); ID2R.set(r.id, i);
    const back = E.ruleById(r.id), tab = E.table(r.id);
    record('ルール表: ruleById・table が表と同じ', !!back && back.text === r.text && Array.isArray(tab) && tab.map((b) => (b ? '1' : '0')).join('') === t, tag);
  });
  record('ルール表: 全部の言い方の表が1つずつある（数が書き出しと同じ）', NR === MIN_REP.size && tables.size === MIN_REP.size && [...MIN_REP.keys()].every((t) => tables.has(t)), `RULES ${NR} / 書き出し ${MIN_REP.size}`);
  record('ルール表: RULES は簡単な順（level → cost）', order, '');
  record('ルール表: 仕様の文の例が同じ意味で入っている（赤いカード・丸ではない・数が3以上・数が偶数・赤くて丸・赤、または数が4以上・数が2以下で、三角ではない）',
    ['赤いカード', '丸ではない', '数が3以上', '数が偶数', '赤くて丸', '赤、または数が4以上', '数が2以下で、三角ではない'].every((s) => texts.has(s)), [...texts].slice(0, 5).join(','));
  record('ルール表: ruleById・table は無い id に null', E.ruleById('nope') === null && E.table('nope') === null, '');
}
const SCOPE_RULES = { 1: [], 2: [], 3: [] };
for (let r = 0; r < NR; r++) for (let s = SCP[r]; s <= 3; s++) if (s >= 1) SCOPE_RULES[s].push(r);
const LEVEL_COUNT = [1, 2, 3].map((l) => LVL.filter((x) => x === l).length);
record('候補の範囲: Engine.SCOPES の数が表と同じ', [1, 2, 3].every((s) => E.SCOPES && E.SCOPES[s] && E.SCOPES[s].size === SCOPE_RULES[s].length && typeof E.SCOPES[s].label === 'string'), JSON.stringify(E.SCOPES));
record('カード: Engine.CARDS は45枚・番号の決まりどおり', Array.isArray(E.CARDS) && E.CARDS.length === NC && E.CARDS.every((x, i) => sameCard(x, CARDS[i]) && cardKeys(x) === 'c,n,s'), '');
{
  let ok = true;
  for (let i = 0; i < NC; i++) if (E.cardIndex(CARDS[i]) !== i || E.cardIndex(i) !== i) ok = false;
  for (const bad of [null, undefined, {}, { c: 'red', s: 'circle', n: 6 }, { c: 'pink', s: 'circle', n: 1 }, { c: 'red', s: 'circle', n: 1.5 }, 45, -1, 2.5, '3']) if (E.cardIndex(bad) !== -1) ok = false;
  record('カード: cardIndex（番号・変なカードは -1）', ok, '');
  const tx = CARDS.map((x) => E.cardText(x));
  record('カード: cardText は45枚で違う・機械的な文字列なし', new Set(tx).size === NC && tx.every((s) => s.length > 0 && !BAD.test(s)) && E.cardText(null) === '', tx.slice(0, 3).join(','));
}

/* ===================== 独立した候補・最善手・判定の検算 ===================== */
function knownOf(ruleR, examples, obs) {
  const k = new Uint8Array(NC);
  for (const o of [...(examples || []), ...(obs || [])]) { const i = idxOf(o && o.card); if (i >= 0) k[i] = TB[ruleR][i] ? 1 : 2; }
  return k;
}
function candIdx(scope, known) {
  const out = [];
  for (const r of SCOPE_RULES[scope]) {
    let ok = true;
    for (let i = 0; i < NC && ok; i++) if (known[i] && TB[r][i] !== (known[i] === 1 ? 1 : 0)) ok = false;
    if (ok) out.push(r);
  }
  return out;
}
// 最善手: 最悪で残る数 → 重み（2^(8-cost)）の重い側 → カード番号
function bestIdx(C, known) {
  if (C.length <= 1) return { x: -1, worst: C.length };
  const w = (r) => 2 ** (8 - COST[r]);
  const wTot = C.reduce((s, r) => s + w(r), 0);
  let best = null;
  for (let x = 0; x < NC; x++) {
    if (known[x]) continue;
    const yes = C.filter((r) => TB[r][x]);
    const worst = Math.max(yes.length, C.length - yes.length);
    const wy = yes.reduce((s, r) => s + w(r), 0);
    const w2 = Math.max(wy, wTot - wy);
    if (!best || worst < best.worst || (worst === best.worst && w2 < best.w2)) best = { x, worst, w2 };
  }
  return best;
}
function greedy(t, scope, known0, cap) {
  const known = known0.slice();
  let C = candIdx(scope, known);
  const counts = [C.length], cards = [];
  while (C.length > 1 && cards.length < cap) {
    const b = bestIdx(C, known);
    known[b.x] = TB[t][b.x] ? 1 : 2;
    C = C.filter((r) => TB[r][b.x] === TB[t][b.x]);
    counts.push(C.length); cards.push(b.x);
  }
  return { counts, cards, done: C.length === 1 };
}
// 最善手（最悪で残る数が最小。候補を分けないカードは除く）の同点を、どれも同じ確率で選ぶときに steps 回の中で候補が1つになる確率 p と、回数の最大 d
function sureIdx(t, C, steps, memo) {
  if (C.length === 1) return { p: 1, d: 0 };
  if (steps === 0) return { p: 0, d: Infinity };
  const key = C.join(',') + '|' + steps;
  if (memo.has(key)) return memo.get(key);
  const opts = [];
  for (let x = 0; x < NC; x++) {
    const k = C.filter((r) => TB[r][x]).length;
    if (k === 0 || k === C.length) continue;
    opts.push({ x, w: Math.max(k, C.length - k) });
  }
  const bw = Math.min(...opts.map((o) => o.w));
  const xs = opts.filter((o) => o.w === bw).map((o) => o.x);
  let p = 0, d = 0;
  for (const x of xs) { const r = sureIdx(t, C.filter((q) => TB[q][x] === TB[t][x]), steps - 1, memo); p += r.p; d = Math.max(d, r.d + 1); }
  const res = { p: p / xs.length, d };
  memo.set(key, res);
  return res;
}
const ham = (a, b) => { let h = 0; for (let i = 0; i < NC; i++) if (TB[a][i] !== TB[b][i]) h++; return h; };
const rid = (C) => C.map((r) => RULES[r].id);

/* ---------- 判定の5枚の性質 ---------- */
// 候補が2つ以上のときの選び方の検算（仕様: 答えのルールを使わず、候補と分かっていないカードだけで1枚ずつ。
// 割れる → 見分けられるまとまりの数 → ○と×の両方が入る候補の数 → 割れ方が半々に近い → 色・形・数がまだ出ていない → key が小さい。並びは key の順）
function hash32(str) {
  str = String(str);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function judgeOpenIdx(C, known, salt) {
  const key = (x) => hash32(salt + '|' + x);
  const free = []; for (let x = 0; x < NC; x++) if (!known[x]) free.push(x);
  const chosen = [];
  const sig = (r, xs) => xs.map((x) => TB[r][x]).join('');
  while (chosen.length < 5) {
    let best = null;
    for (const x of free) {
      if (chosen.includes(x)) continue;
      const xs = chosen.concat([x]);
      const yes = C.filter((r) => TB[r][x]).length;
      const classes = new Set(C.map((r) => sig(r, xs))).size;
      const mixed = C.filter((r) => { const v = xs.map((y) => TB[r][y]); return v.includes(1) && v.includes(0); }).length;
      const used = { c: new Set(chosen.map((y) => CARDS[y].c)), s: new Set(chosen.map((y) => CARDS[y].s)), n: new Set(chosen.map((y) => CARDS[y].n)) };
      const nov = (used.c.has(CARDS[x].c) ? 0 : 1) + (used.s.has(CARDS[x].s) ? 0 : 1) + (used.n.has(CARDS[x].n) ? 0 : 1);
      const sc = [yes > 0 && yes < C.length ? 1 : 0, classes, mixed, Math.min(yes, C.length - yes), nov, -key(x)];
      if (!best || sc.some((v, i) => sc.slice(0, i).every((u, j) => u === best.sc[j]) && v > best.sc[i])) best = { x, sc };
    }
    if (!best) break;
    chosen.push(best.x);
  }
  return chosen.sort((x, y) => key(x) - key(y) || x - y);
}
const judgeStats = { states: 0, single: 0, open: 0, twin: 0, allSplit: 0, sepAll: 0, sepN: 0 };
function inspectJudge(pz, t, obs, tag) {
  const scope = pz.scope;
  const known = knownOf(t, pz.examples, obs);
  const C = candIdx(scope, known);
  let J;
  try { J = E.judgeCards(pz, obs); } catch (e) { record('判定: 例外なく5枚を返す', false, tag + ' ' + e.message); return; }
  const idx = Array.isArray(J) ? J.map(idxOf) : [];
  const shapeOk = Array.isArray(J) && J.length === 5 && idx.every((i) => i >= 0) && new Set(idx).size === 5 && J.every((x) => cardKeys(x) === 'c,n,s');
  record('判定: 5枚・違うカード・正しい形', shapeOk, tag + ' ' + JSON.stringify(J));
  if (!shapeOk) return;
  judgeStats.states++;
  record('判定: 例の2枚・調べたカードは出さない', idx.every((i) => !known[i]), tag + ' ' + idx.join(','));
  const again = E2.judgeCards(JSON.parse(JSON.stringify(pz)), JSON.parse(JSON.stringify(obs)));
  record('判定: 同じ入力なら同じ5枚・同じ順（別インスタンス）', JSON.stringify(again) === JSON.stringify(J), tag);
  if (C.length >= 2) {
    judgeStats.open++;
    // 答えが候補のどれでも、同じ5枚・同じ順（5枚の顔ぶれから答えを推し量れない）。候補の多い場面は間引いて調べる
    const step = Math.max(1, Math.floor(C.length / 24));
    const odd = [];
    for (let k = 0; k < C.length; k += step) {
      const r = C[k];
      if (r === t) continue;
      const q = JSON.parse(JSON.stringify(pz)); q.ruleId = RULES[r].id;
      if (JSON.stringify(E2.judgeCards(q, obs)) !== JSON.stringify(J)) odd.push(RULES[r].text);
      judgeStats.twin++;
    }
    record('判定: 候補が2つ以上なら、答えが候補のどれでも同じ5枚・同じ順（5枚から答えを推し量れない）', odd.length === 0, tag + ' 違う5枚になる候補 ' + odd.slice(0, 3).join(' / '));
    // 候補どうしで答えが割れるカードを優先する
    const split = [];
    for (let x = 0; x < NC; x++) if (!known[x]) { const y = C.filter((r) => TB[r][x]).length; if (y > 0 && y < C.length) split.push(x); }
    const nSplit = idx.filter((i) => split.includes(i)).length;
    if (nSplit === Math.min(5, split.length)) judgeStats.allSplit++;
    record('判定: 候補が2つ以上なら、候補どうしで答えが割れるカードを優先する（割れるカードが5枚以上あれば5枚とも）', nSplit === Math.min(5, split.length), tag + ` 割れるカード ${nSplit}/${Math.min(5, split.length)}`);
    // 検算と同じ5枚
    let salt = 'J|' + String(pz.seed) + '|'; for (let x = 0; x < NC; x++) salt += known[x];
    const want = judgeOpenIdx(C, known, salt);
    record('判定: 候補が2つ以上のときの5枚が検算（候補と分かっていないカードだけで選ぶ）と一致', JSON.stringify(want) === JSON.stringify(idx), tag + ` engine ${idx.join(',')} 検算 ${want.join(',')}`);
    const pats = new Set(C.map((r) => idx.map((i) => TB[r][i]).join('')));
    judgeStats.sepN++; if (pats.size === C.length) judgeStats.sepAll++;
  } else {
    // 候補が1つなら、5枚の答えは1通り。○と×の両方を入れる（残りのカードにあれば）
    judgeStats.single++;
    const freeOk = [0, 1].map((v) => { for (let i = 0; i < NC; i++) if (!known[i] && TB[t][i] === v) return true; return false; });
    const has = [0, 1].map((v) => idx.some((i) => TB[t][i] === v));
    record('判定: 候補が1つなら○と×の両方が入る（残りのカードにあれば）', (has[0] || !freeOk[0]) && (has[1] || !freeOk[1]), tag);
  }
}

/* ---------- 問題の検査 ---------- */
const puzzleStats = { 1: { n: 0, best: {}, start: {}, rules: new Map() }, 2: { n: 0, best: {}, start: {}, rules: new Map() }, 3: { n: 0, best: {}, start: {}, rules: new Map() } };
const callTimes = { best: [], judge: [] };
const sure3 = [];
function rnd32(seed) { let a = seed >>> 0; return () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4294967296; }; }
function inspectPuzzle(pz, tag, kind) {
  const okJson = !hasUndefined(pz) && JSON.stringify(JSON.parse(JSON.stringify(pz))) === JSON.stringify(pz);
  record('問題: JSON 化できる・undefined や NaN が無い', okJson, tag);
  const t = ID2R.get(pz.ruleId);
  const shape = t != null && pz.v === E.VERSION && [1, 2, 3].includes(pz.star) && [1, 2, 3].includes(pz.scope) && pz.ruleText === RULES[t].text &&
    Array.isArray(pz.examples) && pz.examples.length === 2 && Number.isInteger(pz.budget) && Number.isInteger(pz.best) && pz.stats && typeof pz.stats === 'object';
  record('問題: 形（v・seed・star・scope・ruleId・ruleText・examples・budget・best・stats）', shape, tag + ' ' + JSON.stringify(pz).slice(0, 200));
  if (!shape) return;
  if (kind === 'practice' || kind === 'daily') {
    record('問題: 答えのルールは★の候補の範囲の中（答えの集まり = 範囲）、候補の範囲 = ★、上限 = ★1:3・★2:4・★3:6', SCP[t] <= pz.star && pz.scope === pz.star && pz.budget === BUDGET[pz.star], tag + ` ルールの範囲 ${SCP[t]} scope ${pz.scope} budget ${pz.budget}`);
  }
  const [e1, e2] = pz.examples;
  const i1 = idxOf(e1 && e1.card), i2 = idxOf(e2 && e2.card);
  record('問題: 例の2枚は ○1枚（1枚目）・×1枚（2枚目）で、答えのルールと合う', i1 >= 0 && i2 >= 0 && e1.ok === true && e2.ok === false && TB[t][i1] === 1 && TB[t][i2] === 0 &&
    cardKeys(e1.card) === 'c,n,s' && cardKeys(e2.card) === 'c,n,s', tag + ' ' + JSON.stringify(pz.examples));
  const known0 = knownOf(t, pz.examples, []);
  const C0 = candIdx(pz.scope, known0);
  if (kind === 'practice' || kind === 'daily') record('問題: 例の2枚のあとに候補が下限以上残る（★1:3・★2:8・★3:16）', C0.length >= MIN_START[pz.star], tag + ` 候補 ${C0.length}`);
  // 最善手の流れ（独立に計算）と公平さ
  const G = greedy(t, pz.scope, known0, 50);
  const st = pz.stats;
  record('問題: stats（範囲の数・最初の候補・最善手の流れ・カード・size・level・cost）が検算と一致',
    st.universe === SCOPE_RULES[pz.scope].length && st.start === C0.length && JSON.stringify(st.path) === JSON.stringify(G.counts) &&
    Array.isArray(st.bestCards) && st.bestCards.length === G.cards.length && st.bestCards.every((c, k) => idxOf(c) === G.cards[k]) &&
    st.size === RULES[t].size && st.level === LVL[t] && st.cost === COST[t],
    tag + ` path ${JSON.stringify(st.path)}/${JSON.stringify(G.counts)} start ${st.start}/${C0.length}`);
  record('公平さ: 最善手を続けると、上限の回数の中で候補が1つになる（判定5枚の答えが1通りに決まる）', G.done && G.cards.length <= pz.budget && pz.best === G.cards.length,
    tag + ` 最善手 ${G.cards.length}回（候補 ${G.counts.join('→')}）上限 ${pz.budget} best ${pz.best}`);
  const SV = sureIdx(t, C0, pz.budget, new Map());
  record('公平さ: stats.sure（同点をでたらめに選ぶ最善手で届く確率）・stats.bestMax（同点の選び方での回数の最大）が検算と一致',
    typeof st.sure === 'number' && Math.abs(st.sure - SV.p) < 0.0006 && st.bestMax === (SV.d <= pz.budget ? SV.d : null), tag + ` sure ${st.sure}/${SV.p.toFixed(4)} bestMax ${st.bestMax}/${SV.d}`);
  if (kind !== 'tutorial') {
    record(`公平さ（★${pz.star}）: 最善手の同点をどれを選んでも、上限の中で候補が1つになる（sure ≥ ${SURE_MIN[pz.star]}）`, SV.p >= SURE_MIN[pz.star] - 1e-12 && (SURE_MIN[pz.star] < 1 || SV.d <= pz.budget), tag + ` sure ${SV.p.toFixed(3)} 回数の最大 ${SV.d}`);
  }
  if (kind === 'tutorial') record('公平さ（はじめての調査・例）: 最善手の同点をどれを選んでも、上限より1回以上少なく解ける', SV.p === 1 && SV.d <= pz.budget - 1, tag + ` sure ${SV.p} 回数の最大 ${SV.d}`);
  if (pz.star === 3 && kind !== 'tutorial') sure3.push(SV.p);
  if (kind === 'practice' || kind === 'daily') {
    const S = puzzleStats[pz.star];
    S.n++; S.best[pz.best] = (S.best[pz.best] || 0) + 1; S.start[C0.length] = (S.start[C0.length] || 0) + 1; S.rules.set(pz.ruleId, (S.rules.get(pz.ruleId) || 0) + 1);
  }
  // 最善手の流れの途中・終わりでの API
  const obs = [];
  for (let k = 0; k <= G.cards.length; k++) {
    const known = knownOf(t, pz.examples, obs);
    const C = candIdx(pz.scope, known);
    const ctag = tag + ` 最善手${k}回`;
    record('候補: candidates が検算と一致（順番も表の順）', JSON.stringify(E.candidates(pz, obs)) === JSON.stringify(rid(C)), ctag);
    const a = performance.now();
    const bq = E.bestQuestion(pz, obs);
    callTimes.best.push(performance.now() - a);
    const b = bestIdx(C, known);
    record('最善手: bestQuestion が検算と一致（最悪で残る数・同点の選び方）', b.x < 0 ? bq.card === null && bq.worstLeft === C.length : idxOf(bq.card) === b.x && bq.worstLeft === b.worst && cardKeys(bq.card) === 'c,n,s',
      ctag + ` engine ${JSON.stringify(bq)} 検算 ${b.x}/${b.worst}`);
    const a2 = performance.now();
    E.judgeCards(pz, obs);
    callTimes.judge.push(performance.now() - a2);
    inspectJudge(pz, t, obs, ctag);
    if (k === G.cards.length) {
      // 公平さ: 最善手のあとの判定5枚は、残った候補のどれでも同じ答え
      const J = E.judgeCards(pz, obs).map(idxOf);
      record('公平さ: 最善手のあとの判定5枚は、残った候補のどれでも答えが同じ', J.every((i) => i >= 0 && C.every((r) => TB[r][i] === TB[t][i])), ctag + ` 候補 ${C.length}`);
    }
    if (k < G.cards.length) obs.push({ card: CARDS[G.cards[k]], ok: TB[t][G.cards[k]] === 1 });
  }
  // でたらめに調べた場合（下手な調べ方）でも、候補・最善手・判定・ふり返りが正しい
  const r = rnd32(crypto.createHash('md5').update(tag).digest().readUInt32LE(0));
  const robs = [];
  const nq = 1 + Math.floor(r() * pz.budget);
  for (let k = 0; k < nq; k++) { const i = Math.floor(r() * NC); robs.push({ card: CARDS[i], ok: r() < 0.5 }); }   // ok はでたらめ（エンジンは答えで決め直す）
  {
    const known = knownOf(t, pz.examples, robs);
    const C = candIdx(pz.scope, known);
    record('候補: でたらめな観察（ok がうそ・同じカード）でも検算と一致し、答えが残る', JSON.stringify(E.candidates(pz, robs)) === JSON.stringify(rid(C)) && C.includes(t), tag);
    const bq = E.bestQuestion(pz, robs), b = bestIdx(C, known);
    record('最善手: bestQuestion が検算と一致（最悪で残る数・同点の選び方）', b.x < 0 ? bq.card === null : idxOf(bq.card) === b.x && bq.worstLeft === b.worst, tag + ' でたらめ');
    inspectJudge(pz, t, robs, tag + ' でたらめ');
    // 壊れた観察が混ざっても落ちない（変なカードは飛ばす）
    const junk = robs.concat([{ card: { c: 'pink', s: 'circle', n: 1 } }, null, { card: null }, { card: { c: 'red', s: 'circle', n: 9 } }]);
    let jOk = true;
    try { jOk = JSON.stringify(E.candidates(pz, junk)) === JSON.stringify(rid(C)) && E.judgeCards(pz, junk).length === 5 && E.review(pz, junk).steps.length === robs.length; } catch (e) { jOk = false; }
    record('壊れた観察（変なカード・null）は飛ばして落ちない', jOk, tag);
    // ふり返り
    const rv = E.review(pz, robs);
    const kn = knownOf(t, pz.examples, []);
    let Cr = candIdx(pz.scope, kn);
    const counts = [Cr.length], steps = [];
    for (const o of robs) {
      const i = idxOf(o.card), before = Cr.length, bb = bestIdx(Cr, kn);
      if (!kn[i]) { kn[i] = TB[t][i] ? 1 : 2; Cr = Cr.filter((q) => TB[q][i] === TB[t][i]); }
      counts.push(Cr.length);
      const k1 = Cr.length;
      steps.push({ i, ok: TB[t][i] === 1, before, after: Cr.length, cut: before ? (before - Cr.length) / before : 0, bx: bb.x, bw: bb.worst });
      void k1;
    }
    // 調査力: cut の平均。調べ終わったとき候補が2つ以上なら「減らせなかった1回」（0）を足す
    const power = steps.reduce((s, x) => s + x.cut, 0) / (steps.length + (Cr.length > 1 ? 1 : 0));
    // 各回の「最悪で残る数」と「最善手と同じくらい良いか」（調べる前の候補で数え直す）
    {
      const kn2 = knownOf(t, pz.examples, []);
      let C2 = candIdx(pz.scope, kn2);
      steps.forEach((x) => {
        const yes = C2.filter((q) => TB[q][x.i]).length;
        x.worst = kn2[x.i] ? C2.length : Math.max(yes, C2.length - yes);
        x.optimal = C2.length > 1 && x.worst === bestIdx(C2, kn2).worst;
        x.other = kn2[x.i] ? C2.length : C2.length - x.after;
        x.lucky = !kn2[x.i] && C2.length > 1 && x.after < bestIdx(C2, kn2).worst;
        if (!kn2[x.i]) { kn2[x.i] = TB[t][x.i] ? 1 : 2; C2 = C2.filter((q) => TB[q][x.i] === TB[t][x.i]); }
      });
    }
    // 最善手で解いたときの調査力（この答えの流れ）
    const bc = []; for (let k = 1; k < G.counts.length; k++) bc.push((G.counts[k - 1] - G.counts[k]) / G.counts[k - 1]);
    const bestPower = bc.length ? bc.reduce((a, x) => a + x, 0) / bc.length : null;
    const rvOk = rv && JSON.stringify(rv.counts) === JSON.stringify(counts) && rv.steps.length === steps.length && rv.left === Cr.length && rv.best === pz.best &&
      rv.steps.every((s, k) => idxOf(s.card) === steps[k].i && s.ok === steps[k].ok && s.before === steps[k].before && s.after === steps[k].after &&
        Math.abs(s.cut - steps[k].cut) < 1e-9 && (steps[k].bx < 0 ? s.best.card === null : idxOf(s.best.card) === steps[k].bx) && s.best.worstLeft === steps[k].bw &&
        s.worst === steps[k].worst && s.optimal === steps[k].optimal && s.other === steps[k].other && s.lucky === steps[k].lucky) &&
      Math.abs(rv.power - power) < 1e-9 && rv.allOptimal === steps.every((x) => x.optimal) &&
      (bestPower === null ? rv.bestPower === null : Math.abs(rv.bestPower - bestPower) < 1e-9);
    record('ふり返り: 候補の数・各回の最善手・減らした割合・最悪で残る数・逆の答えなら残った数・運よく減ったか・最善と同じくらいか・調査力（判定に進んだときの残りも数える）・最善なら何%が検算と一致', rvOk, tag + ' ' + JSON.stringify(rv && [rv.counts, rv.power, rv.bestPower]) + ' / ' + JSON.stringify([counts, power, bestPower]));
    // 結果の★: ★3 は判定に進んだ時点で候補が1つ・判定1回・回数が best 以下か毎回が最善と同じくらい良い
    const bestObs = (pz.stats.bestCards || []).map((c) => ({ card: c, ok: TB[t][idxOf(c)] === 1 }));
    const allOpt = steps.every((x) => x.optimal);
    const g1 = E.grade(pz, bestObs, 1), g2 = E.grade(pz, robs, 1), g0 = E.grade(pz, [], 1), gHalf = E.grade(pz, bestObs.slice(0, -1), 1), gRetry = E.grade(pz, bestObs, 2);
    const want2 = Cr.length > 1 ? 2 : (steps.length <= pz.best || allOpt ? 3 : 2);
    record('結果の★: 最善手で絞って判定1回なら★3・でたらめな調べ方は「判定に進んだ時点で候補が1つか」と回数で決まる・やり直しは★1', (bestObs.length === 0 || g1 === 3) && g2 === want2 && gRetry === 1, tag + ` ${g1} ${g2}/${want2} ${gRetry}`);
    record('結果の★: 調べずに判定へ進んで通過しても★3 にならない・候補が2つ以上のまま判定に進んで通過したら★2', g0 === 2 && (bestObs.length === 0 || gHalf === 2), tag + ` 調べ0回 ★${g0} / 1回手前 ★${gHalf}`);
  }
  // test() は45枚とも表どおり
  record('test: 45枚の○×が答えのルールの表と同じ', CARDS.every((x, i) => E.test(pz, x) === (TB[t][i] === 1)) && E.test(pz, { c: 'red', s: 'x', n: 1 }) === false, tag);
}

/* ===================== 生成時間 ===================== */
const times = [];
function timedGen(F, o) {
  const a = performance.now();
  const p = F.generate(o);
  return [p, performance.now() - a];
}

/* ===================== 本体 ===================== */
const t0 = Date.now();
// 練習 ★1〜3
{
  const F = fresh();
  for (const star of [1, 2, 3]) {
    for (let i = 0; i < COUNT; i++) {
      const seed = 'p' + i;
      const tag = `[練習 ★${star} ${seed}]`;
      let pz, ms;
      try { [pz, ms] = timedGen(F, { seed, star }); } catch (e) { record('練習: 生成できる', false, tag + ' ' + e.message); continue; }
      times.push(ms);
      record('練習: 生成できる（seed・★がそのまま）', pz.seed === seed && pz.star === star, tag);
      inspectPuzzle(pz, tag, 'practice');
      if (i % 10 === 0) record('同じ seed で同じ JSON（別インスタンス）', JSON.stringify(E2.generate({ seed, star })) === JSON.stringify(pz), tag);
    }
  }
}
// 答えの集まり（= 候補の範囲）の全部のルールで、★ごとに、そのルールを指定して公平な問題が作れる
const poolCount = { 1: 0, 2: 0, 3: 0 };
const poolUsable = { 1: 0, 2: 0, 3: 0 };
{
  const P = E._internal && E._internal.POOL;
  const same = !!P && [1, 2, 3].every((s) => Array.isArray(P[s]) && P[s].length === SCOPE_RULES[s].length && P[s].every((r, k) => r === SCOPE_RULES[s][k]));
  record('答えの集まり: ★ごとの答えの集まりが候補メーターの範囲と同じ（★1 21・★2 99・★3 350。メーターの数 = 本当にありうる答えの数）', same && SCOPE_RULES[1].length === 21 && SCOPE_RULES[2].length === 99 && SCOPE_RULES[3].length === 350,
    P ? [1, 2, 3].map((s) => (P[s] ? P[s].length : '-') + '/' + SCOPE_RULES[s].length).join(' ') : 'POOL が無い');
  const F = fresh();
  for (const star of [1, 2, 3]) {
    for (const r of SCOPE_RULES[star]) {
      poolCount[star]++;
      let pz, ms;
      try { [pz, ms] = timedGen(F, { seed: 'rule-' + star + '-' + r, star, ruleId: RULES[r].id }); } catch (e) { record('全部のルール: 指定して公平な問題が作れる', false, RULES[r].id + ' ' + e.message); continue; }
      times.push(ms);
      const t = ID2R.get(pz.ruleId);
      const known = knownOf(t, pz.examples, []);
      const G = greedy(t, pz.scope, known, 50);
      const SV = sureIdx(t, candIdx(pz.scope, known), pz.budget, new Map());
      const ok = pz.ruleId === RULES[r].id && pz.star === star && pz.scope === star && G.done && G.cards.length <= pz.budget && pz.best === G.cards.length && SV.p >= SURE_MIN[star] - 1e-12 && SV.d <= pz.budget &&
        candIdx(pz.scope, known).length >= MIN_START[star];
      if (ok) poolUsable[star]++;
      record('全部のルール: ★ごとに、答えの集まりのどのルールでも公平な問題が作れる（★・候補の下限・最善手で届く・同点のどれでも届く）', ok, `★${star} ${RULES[r].id} best ${pz.best} 検算 ${G.cards.length} sure ${SV.p.toFixed(3)}`);
    }
  }
}
// 日替わり
const dayStr = (i) => new Date(Date.UTC(2026, 9, 20) + i * 86400000).toISOString().slice(0, 10);
const dTimes = [];
const dRules = [];
const dGap = { 1: 1e9, 2: 1e9, 3: 1e9 };
{
  const F = fresh();
  for (let i = 0; i < DAYS; i++) {
    const ds = dayStr(i);
    const tag = `[日替わり ${ds}]`;
    const wd = new Date(ds + 'T00:00:00Z').getUTCDay();
    let cfg;
    try { cfg = F.dailyConfig(ds); } catch (e) { record('日替わり: 設定', false, tag + ' ' + e.message); continue; }
    record('日替わり: 設定（No.・日付・曜日・★・seed・ルール）', cfg.no === i + 1 && cfg.date === ds && cfg.weekday === wd && cfg.weekdayLabel === WD[wd] && cfg.star === WEEK[wd] &&
      cfg.seed === 'hosoku-' + ds.replace(/-/g, '') && ID2R.has(cfg.ruleId) && SCP[ID2R.get(cfg.ruleId)] <= cfg.star, tag + ' ' + JSON.stringify(cfg));
    let pz, ms;
    try { const a = performance.now(); pz = F.daily(ds); ms = performance.now() - a; } catch (e) { record('日替わり: 生成できる', false, tag + ' ' + e.message); continue; }
    times.push(ms); dTimes.push(ms);
    record('日替わり: 生成できる（No.・日付・曜日・seed・★・ルールが設定と同じ）', pz.no === cfg.no && pz.date === ds && pz.weekday === wd && pz.weekdayLabel === WD[wd] && pz.seed === cfg.seed &&
      pz.star === cfg.star && pz.ruleId === cfg.ruleId, tag);
    inspectPuzzle(pz, tag, 'daily');
    for (let j = Math.max(0, i - NEAR_DAYS); j < i; j++) {
      if (dRules[j] === pz.ruleId) record(`日替わり: 同じルールが${NEAR_DAYS}日以内に続かない`, false, tag + ` ${dayStr(j)} と同じ ${pz.ruleId}`);
    }
    record(`日替わり: 同じルールが${NEAR_DAYS}日以内に続かない`, true, '');
    for (let j = i - 1; j >= 0; j--) if (dRules[j] === pz.ruleId) { dGap[pz.star] = Math.min(dGap[pz.star], i - j); break; }
    dRules.push(pz.ruleId);
    if (i % 15 === 0) record('日替わり: 同じ日付で同じ問題（別インスタンス）', JSON.stringify(E2.daily(ds)) === JSON.stringify(pz), tag);
  }
  // No.1 より前・遠い先
  let ok = true, detail = '';
  try {
    const c0 = F.dailyConfig('2026-10-19'), c1 = F.dailyConfig('2026-01-01');
    const p0 = F.daily('2026-10-19');
    ok = c0.no === 0 && c1.no < 0 && p0.no === 0 && SCP[ID2R.get(p0.ruleId)] <= WEEK[1];
    detail = `2026-10-19 No.${c0.no} / 2026-01-01 No.${c1.no}`;
  } catch (e) { ok = false; detail = e.message; }
  record('日替わり: No.1 より前の日付も計算できる（No. は 0 以下。丸めは画面で）', ok, detail);
  const Ff = fresh();
  let a = performance.now();
  let far = null;
  try { far = Ff.dailyConfig('2036-10-20'); } catch (e) { far = null; }
  let ms = performance.now() - a;
  record('日替わり: 10年先の dailyConfig も軽い（初回 50ms 以下）', !!far && far.no === 3654 && (NO_PERF || ms <= 50), far ? `No.${far.no} ${ms.toFixed(1)}ms` : 'エラー');
  a = performance.now();
  let far2 = null;
  try { far2 = Ff.dailyConfig('9999-12-31'); Ff.daily('9999-12-31'); } catch (e) { far2 = null; }
  ms = performance.now() - a;
  record('日替わり: 遠い先（9999-12-31）の dailyConfig・daily も軽い（初回 100ms 以下）', !!far2 && far2.no > 0 && (NO_PERF || ms <= 100), far2 ? `No.${far2.no} ${ms.toFixed(1)}ms` : 'エラー');
  record('Engine.DAY1 は 2026-10-20', E.DAY1 === DAY1, String(E.DAY1));
  record('Engine.WEEK が曜日の決まりと同じ', JSON.stringify(E.WEEK) === JSON.stringify(WEEK), JSON.stringify(E.WEEK));
  record('Engine.BUDGET が★の上限と同じ（★1 3・★2 4・★3 6）', JSON.stringify(E.BUDGET) === JSON.stringify(BUDGET), JSON.stringify(E.BUDGET));
  // 遊び方の★の説明: 1行ずつ・候補の範囲の数と上限が入る・答えの型（ではない・または・かつ・以外・部品）を書かない
  const G = E.STAR_GUIDE || {};
  const gBad = [1, 2, 3].filter((k) => typeof G[k] !== 'string' || !G[k].includes(String(SCOPE_RULES[k].length) + '通り') || !G[k].includes(BUDGET[k] + '回') ||
    /\n|ではない|または|かつ|以外|部品/.test(G[k]) || BAD.test(G[k]) || G[k].length > 40);
  record('Engine.STAR_GUIDE: ★ごとの説明1行（候補の範囲の数と上限。答えの型は書かない）', gBad.length === 0 && Object.isFrozen(G), JSON.stringify(G));
  // 長い期間（3年）で、★ごとに同じルールの間隔
  const longGap = { 1: 1e9, 2: 1e9, 3: 1e9 };
  const last = new Map();
  for (let i = 0; i < 365 * 3; i++) {
    const c = Ff.dailyConfig(dayStr(i));
    if (last.has(c.ruleId)) longGap[c.star] = Math.min(longGap[c.star], i - last.get(c.ruleId));
    last.set(c.ruleId, i);
  }
  record(`日替わり: 3年分でも同じルールが${NEAR_DAYS}日以内に続かない（★をまたいでも）`, Object.values(longGap).every((g) => g > NEAR_DAYS), JSON.stringify(longGap));
  dGap.long = longGap;
  // 答えの型が★で決まらない: ★1 の日にも「◯ではない」「◯くて◯」、★2 の日にも色と形だけのルール、★3 の日にも部品1つ・ではないを使わないかつが出る
  const kinds = { 1: new Set(), 2: new Set(), 3: new Set() };
  for (let i = 0; i < 365 * 3; i++) { const c = Ff.dailyConfig(dayStr(i)); kinds[c.star].add(SCP[ID2R.get(c.ruleId)] + ':' + LVL[ID2R.get(c.ruleId)]); }
  record('日替わり: 答えの型が★で決まらない（3年分で、★1 の日に level 1・2、★2 の日に範囲1 と範囲2、★3 の日に範囲1〜3 のルールが出る）',
    kinds[1].has('1:1') && kinds[1].has('1:2') && [...kinds[2]].some((k) => k.startsWith('1:')) && [...kinds[2]].some((k) => k.startsWith('2:')) && [1, 2, 3].every((sc) => [...kinds[3]].some((k) => k.startsWith(sc + ':'))),
    JSON.stringify({ 1: [...kinds[1]], 2: [...kinds[2]], 3: [...kinds[3]] }));
}
// はじめての調査・遊び方の例
const ANSWER_WORDS = ['赤', '青', '緑', '丸', '三角', '四角'];
{
  for (let k = 1; k <= 3; k++) {
    const tag = `[はじめての調査 ${k}]`;
    let pz;
    try { pz = E.tutorial(k); } catch (e) { record('はじめての調査: 作れる', false, tag + ' ' + e.message); continue; }
    inspectPuzzle(pz, tag, 'tutorial');
    const t = ID2R.get(pz.ruleId);
    const L = pz.lesson || {};
    const keys = ['title', 'intro', 'make', 'first', 'ask', 'hit', 'miss', 'flat', 'judge', 'out', 'done'];
    record('はじめての調査: 案内の文（題・始め・作り方・初めて調べる前・調べる前・予想どおり・発見・減らない・絞れた・回数を使い切った・解決）', pz.tutorial === k && L.no === k && keys.every((x) => typeof L[x] === 'string' && L[x].length > 0 && !BAD.test(L[x])), tag + ' ' + Object.keys(L).join(','));
    const nums = RULES[t].parts.filter((p) => p.k === 'num' && p.v != null).map((p) => String(p.v));
    const leak = keys.filter((x) => typeof L[x] === 'string' && (ANSWER_WORDS.some((w) => L[x].includes(w)) || nums.some((d) => L[x].includes(d)) || L[x].includes(RULES[t].text)));
    record('はじめての調査: 案内で答えのルールを言わない（色・形の名前・ルールの数を書かない）', leak.length === 0, tag + ' ' + leak.join(','));
    record('はじめての調査: 最善手なら上限より1回以上少なく解ける', pz.best <= pz.budget - 1, tag + ` best ${pz.best} 上限 ${pz.budget}`);
    record('はじめての調査: 同じものを返す（別インスタンス）', JSON.stringify(E2.tutorial(k)) === JSON.stringify(pz), tag);
    const known = knownOf(t, pz.examples, []);
    const C = candIdx(pz.scope, known);
    let lesson = false, why = '';
    if (k === 1) { lesson = RULES[t].op === 'one' && RULES[t].parts[0].k === 'color' && LVL[t] === 1; why = '★1 の色のルール'; }
    if (k === 2) {
      // 2-4-6: いちばん簡単な候補（答えではない）は答えより狭い。それが○と言うカードを調べても候補が減らないものがあり、最善手は「その候補なら×・答えは○」の発見になる
      const simple = C.find((r) => r !== t);
      const narrower = simple != null && C.indexOf(simple) < C.indexOf(t) && TB[simple].every((v, i) => !v || TB[t][i]);
      const flat = CARDS.some((x, i) => !known[i] && TB[simple][i] && C.every((r) => TB[r][i] === 1));
      const b = bestIdx(C, known);
      const surprise = b.x >= 0 && TB[simple][b.x] === 0 && TB[t][b.x] === 1;
      lesson = narrower && flat && surprise;
      why = `狭い候補 ${simple != null ? RULES[simple].text : '-'} ${narrower} / 減らない○のカード ${flat} / 最善手で発見 ${surprise}`;
    }
    if (k === 3) { lesson = RULES[t].op === 'and'; why = '「かつ」のルール'; }
    record('はじめての調査: 1話に1つずつの考え方（予想して調べる／外れそうなカード（2-4-6）／2つの条件）', lesson, tag + ' ' + why);
  }
  // はじめての調査・遊び方の例で答えを先に知ってしまわないように、日替わりの最初の4週（No.1〜28）に同じルールを出さない
  {
    const early = new Set(); for (let i = 0; i < 28; i++) early.add(E.dailyConfig(dayStr(i)).ruleId);
    const used = [1, 2, 3].map((k) => E.tutorial(k).ruleId).concat([E.example().ruleId]);
    record('はじめての調査・遊び方の例: ルールが日替わりの最初の4週（No.1〜28）に出ない・4つとも違う', used.every((id) => !early.has(id)) && new Set(used).size === 4, used.filter((id) => early.has(id)).join(','));
  }
  let ok = true;
  try { ok = JSON.stringify(E.tutorial(0)) === JSON.stringify(E.tutorial(1)) && JSON.stringify(E.tutorial(9)) === JSON.stringify(E.tutorial(3)) && JSON.stringify(E.tutorial('x')) === JSON.stringify(E.tutorial(1)); } catch (e) { ok = false; }
  record('はじめての調査: 範囲外の番号は1〜3に丸める', ok, '');
  const ex = E.example();
  inspectPuzzle(ex, '[遊び方の例]', 'tutorial');
  const t = ID2R.get(ex.ruleId);
  const G = greedy(t, ex.scope, knownOf(t, ex.examples, []), 50);
  record('遊び方の例: demo は最善手の流れ（カード・○×・残る候補）、judge は5枚と答え',
    Array.isArray(ex.demo) && ex.demo.length === G.cards.length && ex.demo.every((d, k) => idxOf(d.card) === G.cards[k] && d.ok === (TB[t][G.cards[k]] === 1) && d.left === G.counts[k + 1]) &&
    Array.isArray(ex.judge) && ex.judge.length === 5 && ex.judge.every((j) => idxOf(j.card) >= 0 && j.ok === (TB[t][idxOf(j.card)] === 1)), JSON.stringify(ex.demo));
}

/* ---------- API の細かい約束 ---------- */
{
  const F1 = fresh(), F2 = fresh();
  const a = F1.generate({ seed: '7', star: 2 }), b = F1.generate({ seed: 7, star: 2 }), c = F2.generate({ seed: 7, star: 2 });
  record('API: seed の型をそのまま返す', a.seed === '7' && b.seed === 7 && JSON.stringify(b) === JSON.stringify(c), JSON.stringify([a.seed, b.seed, c.seed]));
  const nf = [];
  for (const sd of [NaN, Infinity, -Infinity]) {
    try {
      const p = E.generate({ seed: sd, star: 3 });
      const back = JSON.parse(JSON.stringify(p)).seed;
      const p2 = fresh().generate({ seed: back, star: 3 });
      if (JSON.stringify(p2) !== JSON.stringify(p)) nf.push(String(sd) + ' → ' + JSON.stringify(back));
    } catch (e) { nf.push(String(sd) + ' 例外 ' + e.message); }
  }
  record('API: NaN・Infinity の seed でも、保存した seed で同じ問題を作り直せる', nf.length === 0, nf.join(' / '));
  const norm = [];
  for (const [o, ws] of [[{ seed: 'n', star: '2' }, 2], [{ seed: 'n', star: 9 }, 3], [{ seed: 'n', star: 0 }, 1], [{ seed: 'n' }, 1], [{}, 1], [undefined, 1], [{ seed: 'n', star: 2.4 }, 2]]) {
    try { const p = E.generate(o); if (p.star !== ws) norm.push(JSON.stringify(o) + ' → ★' + p.star); } catch (e) { norm.push(JSON.stringify(o) + ' 例外 ' + e.message); }
  }
  record('API: ★は1〜3に丸める', norm.length === 0, norm.join(' / '));
  let rOk = true;
  try {
    const p = E.generate({ seed: 'x', star: 1, ruleId: 'red|n>=4' });
    const q = E.generate({ seed: 'x', star: 3, ruleId: 'nope' });
    const r3 = E.generate({ seed: 'x', star: 3, ruleId: 'red' });
    const r1 = E.generate({ seed: 'x', ruleId: 'red' });
    rOk = p.ruleId === 'red|n>=4' && p.star === 3 && q.star === 3 && ID2R.has(q.ruleId) && r3.ruleId === 'red' && r3.star === 3 && r3.scope === 3 && r1.star === 1;
  } catch (e) { rOk = false; }
  record('API: ruleId を指定するとそのルール（★は star。ルールが範囲に無ければ、入るいちばん小さい★）。無い id は無視', rOk, '');
  for (const d of ['2026-02-30', '2026-13-01', '2027-02-29', '2026-00-10', '2026-1-1', '', null]) {
    let threw = false;
    try { E.dailyConfig(d); } catch (e) { threw = true; }
    record('API: 存在しない日付は受け付けない', threw, String(d));
  }
  let leap = null;
  try { leap = E.dailyConfig('2028-02-29'); } catch (e) { leap = null; }
  record('API: うるう日は受け付ける', !!leap && leap.weekdayLabel === '火' && leap.weekday === 2 && leap.star === 1, JSON.stringify(leap));
  // grade(pz, obs, tries)
  let gOk = true;
  for (const p of [E.daily(DAY1), E.generate({ seed: 'g', star: 3 }), E.tutorial(3)]) {
    const ob = p.stats.bestCards.map((card) => ({ card }));
    if (E.grade(p, ob, 1) !== 3 || E.grade(p, [], 1) !== 2 || E.grade(p, ob.slice(0, -1), 1) !== 2 || E.grade(p, ob, 2) !== 1 || E.grade(p, [], 5) !== 1) gOk = false;
  }
  record('API: 結果の★（判定1回で通過・判定に進んだ時点で候補が1つ・回数が最善の範囲 ★3／判定1回 ★2／やり直し ★1。調べずに通過は★2）', gOk, '');
  // 返した問題を書き換えても、次に影響しない
  const F3 = fresh();
  const p1 = F3.generate({ seed: 'mut', star: 3 });
  const keep = JSON.stringify(p1);
  p1.examples[0].card.c = 'pink'; p1.stats.path.length = 0; p1.ruleId = 'red';
  const d1 = F3.daily('2026-10-24'); d1.ruleId = 'red'; d1.examples.length = 0;
  const tt = F3.tutorial(1); tt.lesson.title = 'x';
  record('API: 返した問題を書き換えても、次の生成は同じ', JSON.stringify(F3.generate({ seed: 'mut', star: 3 })) === keep && F3.daily('2026-10-24').ruleId !== 'red' && F3.tutorial(1).lesson.title !== 'x', '');
  // 表や決まりを外から変えられない
  const F4 = fresh(), F5 = fresh();
  try { F4.RULES[0].text = 'x'; F4.RULES[0].parts[0].v = 'blue'; F4.CARDS[0].c = 'blue'; F4.BUDGET[1] = 9; F4.WEEK[1] = 3; } catch (e) { /* 凍結されていれば例外でもよい */ }
  try { F4._internal.POOL[1].length = 0; F4._internal.MIN_START[1] = 0; } catch (e) { /* 同上 */ }
  const p4 = F4.generate({ seed: 'api', star: 1 }), p5 = F5.generate({ seed: 'api', star: 1 });
  const hooks = Object.keys(F4).filter((k) => k.startsWith('_') && k !== '_internal');
  record('API: 生成の決まりを外から変えられない（表は凍結）', hooks.length === 0 && JSON.stringify(p4) === JSON.stringify(p5) && Object.isFrozen(F4) && Object.isFrozen(F4.RULES) && Object.isFrozen(F4.RULES[0].parts[0]) &&
    Object.isFrozen(F4.CARDS) && F4.RULES[0].text === F5.RULES[0].text && F4.BUDGET[1] === 3 && Object.isFrozen(F4.STAR_GUIDE), JSON.stringify(hooks));
  // 問題が壊れていたら例外（画面は seed から作り直す）
  let threw = false;
  try { E.candidates({ ruleId: 'nope', examples: [] }, []); } catch (e) { threw = true; }
  record('API: 知らないルールの問題は例外（黙って間違えない）', threw, '');
}

/* ---------- 文に機械的な文字列が無い ---------- */
{
  const texts = [];
  for (const r of RULES) texts.push(r.text);
  for (let k = 1; k <= 3; k++) { const p = E.tutorial(k); texts.push(p.ruleText, ...Object.values(p.lesson).filter((x) => typeof x === 'string')); }
  for (const s of Object.values(E.SCOPES)) texts.push(s.label);
  for (const s of Object.values(E.STAR_GUIDE || {})) texts.push(s);
  for (const x of CARDS) texts.push(E.cardText(x));
  const bad = texts.filter((s) => typeof s !== 'string' || BAD.test(s));
  record('文: undefined・NaN・null・[object・Infinity が無い（ルール・案内・範囲・★の説明・カード）', bad.length === 0, bad.slice(0, 3).join(' / '));
}

/* ---------- Web Worker の中でも動くか ---------- */
{
  let W = null, err = '';
  try { W = loadAsWorker(code); } catch (e) { err = e.message; }
  record('Worker: window・document なしで読める（self.Engine）', !err && !!W && typeof W.generate === 'function', err || 'self.Engine が無い');
  if (W) {
    let ok = false, detail = '';
    try {
      const a = W.generate({ seed: 'worker', star: 3 }), b = E.generate({ seed: 'worker', star: 3 });
      const obs = [{ card: a.stats.bestCards[0], ok: true }];
      ok = JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(W.daily(DAY1)) === JSON.stringify(E.daily(DAY1)) &&
        JSON.stringify(W.judgeCards(a, obs)) === JSON.stringify(E.judgeCards(b, obs)) && JSON.stringify(W.bestQuestion(a, obs)) === JSON.stringify(E.bestQuestion(b, obs));
    } catch (e) { detail = e.message; }
    record('Worker: 同じ問題を作れる・判定や最善手も同じ', ok, detail);
  }
}
if (target.endsWith('.html')) {
  const A = '// ==ENGINE ' + 'START==', B = '// ==ENGINE ' + 'END==';
  const nA = SRC.split(A).length - 1, nB = SRC.split(B).length - 1;
  record('目印（ENGINE START / END）は index.html に1回ずつ', nA === 1 && nB === 1, `START ${nA}回 / END ${nB}回`);
}
record('エンジンは Math.random・Date.now を使わない', !/Math\.random\s*\(|Date\.now\s*\(/.test(code), '');

/* ---------- 回帰: 問題が前と同じか ---------- */
function goldenHashes(Eng) {
  const h1 = crypto.createHash('sha256');
  for (let i = 0; i < 365; i++) h1.update(JSON.stringify(Eng.daily(dayStr(i))) + '\n');
  const h2 = crypto.createHash('sha256');
  for (const star of [1, 2, 3]) for (let i = 0; i < 40; i++) h2.update(JSON.stringify(Eng.generate({ seed: 'r' + i, star })) + '\n');
  const h3 = crypto.createHash('sha256');
  for (let k = 1; k <= 3; k++) h3.update(JSON.stringify(Eng.tutorial(k)) + '\n');
  h3.update(JSON.stringify(Eng.example()) + '\n');
  return { daily365: h1.digest('hex').slice(0, 32), practice120: h2.digest('hex').slice(0, 32), fixed4: h3.digest('hex').slice(0, 32) };
}
let regressMsg = '';
const REG = [['daily365', '回帰: 日替わり365日が基準と同じ'], ['practice120', '回帰: 練習120問が基準と同じ'], ['fixed4', '回帰: はじめての調査3問と遊び方の例が基準と同じ']];
let nowHash = null;
if (!NO_GOLDEN) {
  try { nowHash = goldenHashes(fresh()); } catch (e) { nowHash = { daily365: 'error', practice120: 'error', fixed4: 'error' }; record('回帰: ハッシュを計算できる', false, e.message); }
  const g = GOLDEN[E.VERSION];
  if (!g) {
    regressMsg = `VERSION ${E.VERSION} の基準ハッシュがありません。docs に変更を書いてから、tools/check-engine.mjs の GOLDEN に ${E.VERSION}: { daily365: '${nowHash.daily365}', practice120: '${nowHash.practice120}', fixed4: '${nowHash.fixed4}' } を足してください。`;
    for (const [, name] of REG) record(name, false, regressMsg);
  } else {
    const msg = (k) => `ハッシュ ${g[k]} → ${nowHash[k]}。問題が変わりました。意図した変更なら、エンジンの VERSION を上げて docs に書き、GOLDEN に新しい VERSION の値を足してください。`;
    for (const [k, name] of REG) if (!record(name, nowHash[k] === g[k], msg(k))) regressMsg = regressMsg || msg(k);
  }
}

/* ---------- 公平さの通過率（表示だけ）: 例の2枚をでたらめに選んだとき、最善手で上限の中に候補が1つになる割合 ---------- */
const passRate = {};
{
  const r = rnd32(20261020);
  for (const star of [1, 2, 3]) {
    const pool = [];
    for (let i = 0; i < NR; i++) if (LVL[i] === star) pool.push(i);
    let n = 0, pass = 0, passSlack = 0, enough = 0, robust = 0;
    for (let k = 0; k < 600; k++) {
      const t = pool[Math.floor(r() * pool.length)];
      const P = [], N = [];
      for (let i = 0; i < NC; i++) (TB[t][i] ? P : N).push(i);
      const known = new Uint8Array(NC);
      known[P[Math.floor(r() * P.length)]] = 1; known[N[Math.floor(r() * N.length)]] = 2;
      const C = candIdx(star, known);
      n++;
      if (C.length < MIN_START[star]) continue;
      enough++;
      const G = greedy(t, star, known, BUDGET[star]);
      if (G.done) { pass++; if (G.cards.length <= BUDGET[star] - 1) passSlack++; }
      if (sureIdx(t, C, BUDGET[star], new Map()).p === 1) robust++;
    }
    passRate[star] = { n, enough, pass, passSlack, robust };
  }
}

/* ---------- 表示 ---------- */
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
const dist = (o) => Object.keys(o).map(Number).sort((a, b) => a - b).map((k) => `${k}:${o[k]}`).join(' ');
console.log(`ルールの表: ${NR}通り（level 1: ${LEVEL_COUNT[0]} / level 2: ${LEVEL_COUNT[1]} / level 3: ${LEVEL_COUNT[2]}）  候補の範囲: ★1 ${SCOPE_RULES[1].length} / ★2 ${SCOPE_RULES[2].length} / ★3 ${SCOPE_RULES[3].length}`);
console.log(`答えにできるルール（指定して公平な問題が作れたもの）: ★1 ${poolUsable[1]}/${poolCount[1]}  ★2 ${poolUsable[2]}/${poolCount[2]}  ★3 ${poolUsable[3]}/${poolCount[3]}`);
console.log('\n★ごとの問題（練習＋日替わり）: best（最善手で候補が1つになる回数）の分布 / 例の2枚のあとの候補の数 / 出たルールの種類');
for (const star of [1, 2, 3]) {
  const S = puzzleStats[star];
  console.log(`  ★${star}（上限${BUDGET[star]}）${S.n}問: best ${dist(S.best)}  候補 ${dist(S.start)}  ルール ${S.rules.size}種`);
}
console.log('\n公平さの通過率（例の2枚をでたらめに選び、下限以上の候補が残ったもののうち、最善手で上限の中に候補が1つになる割合。生成はこれを満たす組だけを使う）');
for (const star of [1, 2, 3]) {
  const p = passRate[star];
  console.log(`  ★${star}: エンジンの最善手で ${pct(p.pass, p.enough)}（上限より1回以上少なく ${pct(p.passSlack, p.enough)}）  同点のどれでも ${pct(p.robust, p.enough)}  候補が下限未満で捨てた組 ${pct(p.n - p.enough, p.n)}`);
}
{
  const a = sure3.slice().sort((x, y) => x - y);
  if (a.length) console.log(`★3 の sure（同点をでたらめに選ぶ最善手で上限の中に候補が1つになる確率）${a.length}問: 平均 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)} 下から1割 ${a[Math.floor(a.length * 0.1)].toFixed(3)} 最小 ${a[0].toFixed(3)} 1のもの ${pct(a.filter((x) => x === 1).length, a.length)}`);
}
console.log(`\n判定の5枚: 調べた ${judgeStats.states} 場面  候補が2つ以上 ${judgeStats.open} 場面（答えを入れ替えて同じ5枚か ${judgeStats.twin} 回確かめた・割れるカードを優先 ${judgeStats.allSplit}・5枚で候補を全部見分けられた ${judgeStats.sepAll}/${judgeStats.sepN}）  候補が1つ ${judgeStats.single} 場面`);
console.log(`日替わり ${DAYS}日: 同じルールの最短の間隔 ★1 ${dGap[1]}日 ★2 ${dGap[2] > 1e8 ? '-' : dGap[2] + '日'} ★3 ${dGap[3] > 1e8 ? '-' : dGap[3] + '日'}  （3年分: ${JSON.stringify(dGap.long)}）`);
const avgAll = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length);
const maxAll = Math.max(0, ...times);
const bMax = Math.max(0, ...callTimes.best), jMax = Math.max(0, ...callTimes.judge);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`\n生成時間（練習＋日替わり ${times.length}問）: 平均 ${f2(avgAll)}ms / 最大 ${f1(maxAll)}ms（日替わり 平均 ${f2(mean(dTimes))}ms）`);
console.log(`bestQuestion ${callTimes.best.length}回: 平均 ${f2(mean(callTimes.best))}ms 最大 ${f1(bMax)}ms / judgeCards ${callTimes.judge.length}回: 平均 ${f2(mean(callTimes.judge))}ms 最大 ${f1(jMax)}ms`);
{
  const F = fresh();
  const a = performance.now();
  F.daily(DAY1);
  console.log(`冷えた状態（読み込み直後）の日替わり1問: ${f1(performance.now() - a)}ms`);
}
if (nowHash) console.log(`回帰ハッシュ（VERSION ${E.VERSION}）: daily365 ${nowHash.daily365} / practice120 ${nowHash.practice120} / fixed4 ${nowHash.fixed4}`);

if (!NO_PERF) {
  record(`性能: 生成の平均 ${PERF.avg}ms 以下`, avgAll <= PERF.avg, `平均 ${f2(avgAll)}ms`);
  record(`性能: 生成の最大 ${PERF.max}ms 以下`, maxAll <= PERF.max, `最大 ${f1(maxAll)}ms`);
  record(`性能: bestQuestion・judgeCards は1回 ${PERF.call}ms 以下`, bMax <= PERF.call && jMax <= PERF.call, `最大 ${f1(bMax)}ms / ${f1(jMax)}ms`);
}

console.log('\n検査項目:');
let anyFail = false;
for (const r of results) {
  const ok = r.fail === 0;
  if (!ok) anyFail = true;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.pass}/${r.pass + r.fail})`);
  if (!ok) for (const d of failures[r.name]) console.log('        ' + d);
}
if (regressMsg) console.log('\n*** ' + (GOLDEN[E.VERSION] ? '問題が基準と違います。VERSION を上げて docs に書いてください。' : 'VERSION ' + E.VERSION + ' の基準ハッシュを GOLDEN に足してください。') + ' ***\n    ' + regressMsg);
if (FAIL_OUT) fs.writeFileSync(FAIL_OUT, JSON.stringify(results.filter((r) => r.fail > 0).map((r) => r.name)));
console.log(`\n${anyFail ? 'FAIL' : 'PASS'}  ${results.length}項目  (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);

/* ---------- わざとバグを入れた写し（--mutants） ----------
 * エンジンの文字列を1か所ずつ書き換えた写しを一時フォルダに作り、この検査（回帰ハッシュは見ない・問題の数は少なめ）にかける。
 * 写しごとに、狙った検査項目が FAIL すること（＝この検査がそのバグを見つけられること）を確かめる。 */
const MUTANTS = [
  { name: '最善手の同点の選び方を変える（後ろのカードを選ぶ）', edits: [['(worst === bw && w2 < bw2)', '(worst === bw && w2 <= bw2)']], expect: '最善手:' },
  { name: 'ルール表で簡単でない言い方を残す（cost の大きいほう）', edits: [['x.level - y.level || x.cost - y.cost', 'x.level - y.level || y.cost - x.cost']], expect: 'ルール表: 残した言い方がいちばん簡単' },
  { name: '候補を数えるとき×の手がかりを無視する（candidates）', edits: [['return candOf(scopeOf(pz), knownOf(pz, t, obs)).map((r) => RULES[r].id);', 'return candOf(scopeOf(pz), knownOf(pz, t, obs).map((v) => (v === 2 ? 0 : v))).map((r) => RULES[r].id);']], expect: '候補:' },
  { name: '公平さを確かめずに例の2枚を選ぶ', edits: [['const path = pathOf(t, scope, known, budget);\n    if (!path) return null;\n    const sv = sureOf(t, C, budget, new Map());\n    if (sv.p < SURE_MIN[star]) return null;',
    'const path = pathOf(t, scope, known, 99);\n    const sv = sureOf(t, C, budget, new Map());'],
    ['const goodEnough = (ev, star, budget) => ev.sure === 1 && ev.path.depth <= budget - SLACK[star];', 'const goodEnough = () => true;']], expect: '公平さ' },
  { name: '★2 で同点のどれでも届くことを求めず、sure も見ない', edits: [['const SURE_MIN = { 1: 1, 2: 1, 3: 1 };', 'const SURE_MIN = { 1: 1, 2: 0, 3: 1 };'],
    ['const goodEnough = (ev, star, budget) => ev.sure === 1 && ev.path.depth', 'const goodEnough = (ev, star, budget) => ev.path.depth'],
    ['if (a.sure !== b.sure) return a.sure > b.sure;', 'if (false) return a.sure > b.sure;']], expect: '公平さ（★2）' },
  { name: '★3 で同点のどれでも届くことを求めず、sure も見ない', edits: [['const SURE_MIN = { 1: 1, 2: 1, 3: 1 };', 'const SURE_MIN = { 1: 1, 2: 1, 3: 0 };'],
    ['const goodEnough = (ev, star, budget) => ev.sure === 1 && ev.path.depth', 'const goodEnough = (ev, star, budget) => ev.path.depth'],
    ['if (a.sure !== b.sure) return a.sure > b.sure;', 'if (false) return a.sure > b.sure;']], expect: '公平さ（★3）' },
  // 上限を 5 回に戻す写しは、公平な例の2枚が見つからないルールで生成が全数探索になり、検査が何時間も終わらないので、上限を広げる側で確かめる
  { name: '★3 の上限を 6 → 7 回に変える', edits: [['const BUDGET = { 1: 3, 2: 4, 3: 6 };', 'const BUDGET = { 1: 3, 2: 4, 3: 7 };']], expect: '問題: 答えのルールは' },
  { name: 'sure を同点の数でなく1で割る', edits: [['res = { p: p / xs.length, d };', 'res = { p: Math.min(1, p), d };']], expect: '公平さ: stats.sure' },
  { name: '判定に、もう答えの分かっているカードを出す', edits: [['for (let x = 0; x < NC; x++) if (!known[x]) free.push(x);', 'for (let x = 0; x < NC; x++) free.push(x);']], expect: '判定: 例の2枚・調べたカードは出さない' },
  { name: '判定で、候補が2つ以上でも答えのルールで5枚を選ぶ（VERSION 2 の選び方）', edits: [['const chosen = C.length >= 2 ? judgeOpen(C, free, key) : judgeOne(t, known, free);', 'const chosen = judgeOne(t, known, free);']], expect: '判定: 候補が2つ以上なら、答えが候補のどれでも同じ' },
  { name: '判定で、候補どうしで割れるカードを優先しない', edits: [['const sc = [yes > 0 && yes < n ? 1 : 0, classes, mixed,', 'const sc = [0, 0, mixed,']], expect: '判定: 候補が2つ以上' },
  { name: '判定で、候補が2つ以上のとき答えの○×で並べ替える', edits: [['return chosen.slice().sort((x, y) => key(x) - key(y) || x - y);', 'return chosen.slice().sort((x, y) => RB[t * NC + x] - RB[t * NC + y] || key(x) - key(y) || x - y);']], expect: '判定: 候補が2つ以上なら、答えが候補のどれでも同じ' },
  { name: '判定の埋めるカードを×だけにする（○と×の両方を入れない）', edits: [['        if (used[x]) continue;\n        let s = 0;\n        for (const a of pool)', '        if (used[x] || RB[t * NC + x]) continue;\n        let s = 0;\n        for (const a of pool)'],
    ['for (const want of [1, 0]) {', 'for (const want of []) {']], expect: '判定: 候補が1つなら○と×の両方' },
  { name: '文で「以上」と「以下」を取り違える', edits: [["if (hi === 5) return '数が' + lo + '以上';", "if (hi === 5) return '数が' + lo + '以下';"]], expect: 'ルール表: 文を読み直すと同じ' },
  { name: '文で「緑で丸」を「緑くて丸」と書く', edits: [["const CTE = { red: '赤くて', blue: '青くて', green: '緑で' };", "const CTE = { red: '赤くて', blue: '青くて', green: '緑くて' };"]], expect: 'ルール表: 文を読み直すと同じ' },
  { name: '日替わりで★の日の位置をずらす（★3 のルールを金曜から）', edits: [['const CNT = { 1: 2, 2: 3, 3: 2 }, OFF = { 1: 0, 2: 2, 3: 5 };', 'const CNT = { 1: 2, 2: 3, 3: 2 }, OFF = { 1: 0, 2: 2, 3: 4 };']], expect: '日替わり:' },
  { name: '日替わりで、となりの週も同じ組のルールを使う', edits: [['const h = ((w % 2) + 2) % 2, k = (w - h) / 2;', 'const h = 0, k = w;']], expect: '日替わり: ' },
  { name: '日替わりで、同じ週にもう出たルールを避けない', edits: [['for (let m = 0; usedW.has(r) && m < L; m++)', 'for (let m = 0; false && m < L; m++)']], expect: '日替わり: ' },
  { name: '答えの集まりを level ごとに戻す（VERSION 2）', edits: [['for (const s of [1, 2, 3]) for (const r of SCOPE_RULES[s]) if (!UNFAIR.has(RULES[r].id)) POOL[s].push(r);', 'for (let r = 0; r < NR; r++) if (!UNFAIR.has(RULES[r].id)) POOL[LEVEL[r]].push(r);']], expect: '答えの集まり' },
  { name: '結果の★で、判定に進んだ時点の候補の数を見ない（調べずに★3 が取れる）', edits: [['    if (rv.left > 1) return 2;\n', '']], expect: '結果の★' },
  { name: '調査力で、判定に進んだときの残りを数えない', edits: [['const n = cuts.length + (rest > 1 ? 1 : 0);', 'const n = cuts.length;']], expect: 'ふり返り:' },
  { name: 'ふり返りで、逆の答えなら残った数を出さない（調べる前の数にする）', edits: [['other: was ? before : before - after,', 'other: before,']], expect: 'ふり返り:' },
  { name: '生成に Math.random を使う', edits: [["const rng = makeRng(hash32('hosoku|' + star + '|' + typeof seed + '|' + String(seed)));", 'const rng = makeRng(Math.floor(Math.random() * 4294967296));']], expect: '同じ seed で同じ JSON' },
  { name: '調査力を「残った割合」で計算する', edits: [['cut: before > 0 ? (before - after) / before : 0', 'cut: before > 0 ? after / before : 0']], expect: 'ふり返り:' },
  { name: '結果の★で、判定のやり直しを見ない', edits: [['    if (tries !== 1) return 1;\n', '']], expect: 'API: 結果の★' },
];
if (RUN_MUTANTS) {
  console.log('\nわざとバグを入れた写しの検査（' + MUTANTS.length + '種。同時に ' + Math.max(1, Math.min(8, os.cpus().length - 1)) + ' 本ずつ）:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosoku-mutants-'));
  let caughtAll = true;
  const runOne = (m, k) => new Promise((resolve) => {
    let src = SRC;
    for (const [from, to] of m.edits) {
      const n = src.split(from).length - 1;
      if (n !== 1) { resolve({ m, skip: `書き換える場所が ${n} か所（エンジンが変わったので MUTANTS を直す）: ${from.slice(0, 40)}` }); return; }
      src = src.replace(from, to);
    }
    const file = path.join(dir, 'mutant' + k + path.extname(target));
    fs.writeFileSync(file, src);
    const out = path.join(dir, 'fail' + k + '.json');
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), file, '--count', '40', '--days', '365', '--no-golden', '--no-perf', '--fail-out', out], { stdio: 'ignore' });
    const timer = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) { /* 止まっている */ } }, 60 * 60 * 1000);
    ch.on('close', (code) => {
      clearTimeout(timer);
      let failed = [];
      try { failed = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { failed = [code === null ? '（60分で打ち切り）' : '（結果なし）']; }
      resolve({ m, code, failed });
    });
  });
  try {
    const res = new Array(MUTANTS.length);
    let next = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(8, os.cpus().length - 1)) }, async () => {
      while (next < MUTANTS.length) { const k = next++; res[k] = await runOne(MUTANTS[k], k); }
    });
    await Promise.all(lanes);
    for (const r of res) {
      if (r.skip) { console.log(`  SKIP    ${r.m.name}（${r.skip}）`); caughtAll = false; continue; }
      const hit = r.failed.some((f) => f.startsWith(r.m.expect) || f === '例外');
      const ok = r.code === 1 && hit;
      if (!ok) caughtAll = false;
      console.log(`  ${ok ? '見つけた' : '見逃した'}  ${r.m.name}  → FAIL ${r.failed.length}項目（${r.failed.slice(0, 3).join(' / ')}${r.failed.length > 3 ? ' ほか' : ''}）`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(caughtAll ? '  すべての写しで、狙った検査項目が FAIL を出した（検査はこれらのバグを見つけられる）' : '  見逃した写しがある（検査を強くする）');
  if (!caughtAll) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
