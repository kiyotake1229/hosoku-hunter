#!/usr/bin/env node
// 法則ハンター — 画面の決まりの検査（日付と No.・連続日数・記録帳の並び・保存・図鑑・はじめての調査・答えが漏れないか・別のタブ）
// 使い方: node tools/check-app.mjs [index.html] [--mutants]
//   --mutants = わざと不具合を入れた写し（答えの漏れ・連続日数・別のタブ・案内・読み上げ・ネイティブ連携・sw.js など）でも動かし、狙った項目が FAIL することを確かめる
// index.html の「// ==DAYRULES START==」〜「// ==DAYRULES END==」（日付・連続日数・記録帳の並び）、
// 「// ==STORE START==」〜「// ==STORE END==」（保存の読み書き）、「// ==VIEW START==」〜「// ==VIEW END==」（調査・判定の画面・下の帯・案内・コピー文）を取り出し、
// エンジン（ENGINE START〜END）と一緒に動かして確かめる。
//   - No.1 より前の時計（少し遅れた時計・時差・遠い過去）は、日付ごと No.1 の日に丸める（10-19 の別のルールを「No.1」として出さない）
//   - 連続日数は日替わりの記録（その日のうちに解決した日）から数え直す: 0時をまたぐ・3時まで・0〜3時に「今日 → 昨日」の順で解く・日付が戻る・先へ進めて戻す
//   - 記録帳の全日の並び（新しい順・月の見出し・No.1 で止まる・もっと見る・遠い先の時計でも軽い）
//   - 保存: 壊れた JSON・読めない1件・型違い・古い形・新しい版の保存・別のタブの記録・別のタブで記録を消した場合・書き込めない環境
//   - 画面の関数（途中の保存・解決の記録・図鑑・調査力の推移と合計・はじめての調査の進み具合・練習の続き・保存した途中の当てはめ）
//   - 別のタブ: 同じ練習・はじめての調査を2つのタブで解いても二重に数えない・別のタブが判定に進んだ記録を、調べる途中のタブが消さない
//   - 答えが漏れないか: 答えだけが違う同じ形の問題（twin）で、解決する前の画面（メーター・手がかり・台・判定・下の帯・案内）の HTML が同じになる。
//     まだ調べていないカードの○×・最善手のカード・最善手の流れ（path）を、aria-label・title・隠した要素に入れても見つける。あわせて答えの文が入らない
//   - はじめての調査の案内（第2話は「候補が減らなかった」のあとにだけ×のカードを勧める・回数を使い切ったときの文・調べたあとは下の帯）
//   - ソース: alert/confirm/prompt を使わない・外から読むのは Google Fonts だけ・テーマのトークン・動きを減らす設定・絵文字を使わない
// #0004 で入れた仕組み（PWA とネイティブ連携）も、偽の window.Capacitor・偽のプラグイン・偽の Service Worker の環境で動かして確かめる:
//   iOS アプリかどうかの判定（NATIVE・FRAMED・plug）、Service Worker を登録する条件（registerSW）、
//   Preferences への二重の保存と起動時の戻し方・戻す順（nativeRestore・persistIfEmpty）、触覚（buzz → Haptics）、
//   状態バーの色（applyTheme → StatusBar）、毎朝の通知（morningList・syncNow・toggleNotify → LocalNotifications。通知の文に答えを書かない）、
//   設定の通知の行（Web では出さない）、結果のコピー文の公開 URL、<head> のタグ、
//   sw.js（消すキャッシュは hosoku- だけ・ほかのアプリの場所には触らない・消された分の入れ直し）、manifest・画像の大きさ、
//   サポートページの曜日の表・候補の範囲（Engine.WEEK・SCOPES・BUDGET と同じか）。
// 画面を実際に動かす検査（クリック・焦点・読み上げ・小さい画面）は tools/check-ui.mjs（Chrome の画面なしモード）。
// 外部パッケージは使わない（Node.js だけで動く）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const RUN_MUTANTS = ARGS.includes('--mutants');
const FAIL_OUT = ARGS.includes('--fail-out') ? ARGS[ARGS.indexOf('--fail-out') + 1] : null;
const target = path.resolve(ARGS.find((a, i) => !a.startsWith('--') && ARGS[i - 1] !== '--fail-out') || path.join(here, '..', 'index.html'));
if (!fs.existsSync(target)) {
  console.log('検査対象: ' + target + '\n\nFAIL  検査対象がありません（ファイルが無い）: ' + target);
  process.exit(1);
}
const SRC = fs.readFileSync(target, 'utf8');
const between = (a, b) => {
  const lines = SRC.split('\n');
  const s = lines.findIndex((l) => l.includes(a)), e = lines.findIndex((l) => l.includes(b));
  if (s < 0 || e < 0 || e <= s) throw new Error(a + ' 〜 ' + b + ' の目印が見つかりません: ' + target);
  return lines.slice(s + 1, e).join('\n');
};
const fnSrc = (name) => {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' が見つかりません');
  const e = SRC.indexOf('\n  }\n', i);
  return (i >= 6 && SRC.slice(i - 6, i) === 'async ' ? 'async ' : '') + SRC.slice(i, e) + '\n  }';
};
const lineOf = (head) => { const l = SRC.split('\n').find((x) => x.trim().startsWith(head)); if (!l) throw new Error(head + ' が見つかりません'); return l; };

// 1つのタブ（localStorage は Map。2つのタブは同じ Map を渡す）。setItem を失敗させる切り替えつき
let lsFail = false;
// iOS アプリ（Capacitor）の代わり。プラグインは FAKE に入れたり消したりして切り替える（初めは何も無い = Web と同じ動き）
const FAKE = {};
const WIN = { Capacitor: { isNativePlatform: () => true, Plugins: FAKE }, origin: 'https://kiyotake1229.github.io', isSecureContext: true };
WIN.self = WIN; WIN.top = WIN;
const VIB = [];   // navigator.vibrate に渡したもの
const NAV = { vibrate: (p) => { VIB.push(p); return true; }, userActivation: { hasBeenActive: true } };
const HTML = { attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
const DOC = { documentElement: HTML, hidden: false };
function makeTab(LS) {
  const ctx = { module: { exports: {} }, console, window: WIN, navigator: NAV, document: DOC };
  ctx.localStorage = {
    getItem: (k) => (LS.has(k) ? LS.get(k) : null),
    setItem: (k, v) => { if (lsFail) throw new Error('QuotaExceededError'); LS.set(k, String(v)); },
    removeItem: (k) => { LS.delete(k); },
  };
  vm.createContext(ctx);
  vm.runInContext(between('// ==ENGINE START==', '// ==ENGINE END==') + '\n;this.Engine = (typeof Engine !== "undefined") ? Engine : module.exports;', ctx);
  // ネイティブ連携の判定（保存の persist が Preferences に書くのに使う）と、一般公開の場所（コピー文の最後）
  vm.runInContext(between('// ==NATIVE START==', '// ==NATIVE END==') + '\n' + lineOf('const SITE_URL = ') + '\n;this.NV = { NATIVE, FRAMED, plug, quiet, SITE_URL };', ctx);
  vm.runInContext(between('// ==DAYRULES START==', '// ==DAYRULES END==') +
    '\n;this.R = { DAY1, clampDay, clockBehind, dailyOf, TZ_SLACK, openedOnDayOf, countsOnDay, pendingDay, solvedOn, streakAt, runOf, recountStreak, shownStreak, bookCount, bookDayAt, bookDays, bookRows, monthOf };', ctx);
  // 保存の読み書き（起動時の let S = readStore() || defaults() も、この中で動く）
  vm.runInContext(between('// ==STORE START==', '// ==STORE END==') +
    '\n;this.ST = { KEY, defaults, sanitize, readStore, persist, update, addZukan, addLog, nativeRestore, getS: () => S, setS: (v) => { S = v; }, newer: () => newerStore, ok: () => storeOK, reset: () => { newerStore = false; storeOK = true; } };', ctx);
  // 調査・判定の画面・帯・案内とコピー文、画面の関数（途中の保存・解決の記録・はじめての調査の入口・練習の続き・保存した途中の当てはめ・結果の文）
  vm.runInContext(lineOf('const WD = ') + '\n' + between('// ==VIEW START==', '// ==VIEW END==') + '\nlet P = null;\n' +
    'const today = () => clampDay(Engine.localDateStr(new Date()));\n' +
    [fnSrc('playRec'), fnSrc('aheadOf'), fnSrc('saveProgress'), fnSrc('onSolve'), fnSrc('showTutCard'), fnSrc('practiceResume'), fnSrc('restore'), fnSrc('gradeMsg')].join('\n') +
    '\n;this.V = { metaHTML, titleOf, meterHTML, cluesHTML, benchHTML, judgeHTML, barHTML, guideOf, guideHTML, guideInBar, flatSeen, copyText, clueList, knownObs, engineObs, candCount, leftOf, canAsk, canGuess, cardOf, idxOf, starsHTML, diffHTML, sentence };' +
    '\n;this.UI = { playRec, saveProgress, onSolve, showTutCard, practiceResume, restore, gradeMsg, setP: (p) => { P = p; }, getP: () => P };', ctx);
  return ctx;
}
const LS = new Map();
let ctx;
try { ctx = makeTab(LS); } catch (e) {
  console.log('検査対象: ' + target + '\n\nFAIL  読み込めません: ' + e.message);
  if (FAIL_OUT) fs.writeFileSync(FAIL_OUT, JSON.stringify(['読み込めません']));
  process.exit(1);
}
const { Engine, R, ST, V, UI } = ctx;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const localDay = (y, m, d, h, mi) => Engine.localDateStr(new Date(y, m - 1, d, h, mi || 0));
const J = (o) => JSON.stringify(o);
// その日のうちに解決した日の記録（連続日数の検査用）
const solvedDays = (from, n, extra) => { const d = {}; for (let i = 0; i < n; i++) d[Engine.addDays(from, i)] = { state: 'done', solvedOnDay: true }; return Object.assign(d, extra || {}); };
const sv = (daily, stats) => ({ daily, stats: Object.assign({ streak: 0, bestStreak: 0, lastDailyDate: null }, stats || {}) });

/* ---------- No. と日付の丸め ---------- */
{
  check('DAY1 はエンジンの No.1 の日（2026-10-20）', R.DAY1 === '2026-10-20' && Engine.dailyConfig(R.DAY1).no === 1, R.DAY1);
  const behind = ['2026-10-19', '2026-10-01', '2026-01-01', '1970-01-01', '2000-02-29'];
  const day1 = J(Engine.daily('2026-10-20'));
  const bad = behind.filter((d) => {
    const c = R.dailyOf(d);
    return R.clampDay(d) !== R.DAY1 || c.no !== 1 || c.date !== '2026-10-20' || c.seed !== 'hosoku-20261020' || c.star !== 1 || J(Engine.daily(R.clampDay(d))) !== day1;
  });
  check('No.1 より前の日付は、日付ごと No.1 の日に丸める（10-19 の別のルールを No.1 として出さない）', bad.length === 0 && Engine.dailyConfig('2026-10-19').ruleId !== undefined, bad.join(' '));
  check('No.1 より前の日付のときは「日付を確かめて」を出す', behind.every((d) => R.clockBehind(d)) && !R.clockBehind('2026-10-20') && !R.clockBehind('2027-03-01') && R.clockBehind(null) && R.clockBehind(undefined), '');
  const raw = localDay(2026, 10, 19, 23, 55);
  const c = R.dailyOf(R.clampDay(raw));
  check('時計が10分遅れた端末（10-19 23:55）でも、今日のルールは No.1・2026-10-20 の問題', raw === '2026-10-19' && c.no === 1 && c.seed === 'hosoku-20261020', raw + ' ' + J(c));
  const edges = [[localDay(2026, 10, 20, 0, 0), 1], [localDay(2026, 10, 20, 23, 59), 1], [localDay(2026, 10, 21, 0, 0), 2], [localDay(2026, 10, 26, 12, 0), 7], [localDay(2027, 10, 20, 0, 0), 366]];
  const eb = edges.filter(([d, no]) => R.dailyOf(R.clampDay(d)).no !== no);
  check('0時の前後・1年後の No. が正しい', eb.length === 0, J(eb));
  let threw = '';
  for (const x of ['2026-10-20T00:00', '', null, undefined, 20261020, '2026-13-01', '2026-02-30', 'abc']) {
    try { const k = R.dailyOf(x); if (!(k.no >= 1) || !k.seed) threw += String(x) + ' '; } catch (e) { threw += String(x) + '(例外) '; }
  }
  check('形の違う日付を渡しても例外を出さず、No.1 以降の設定を返す', threw === '', threw);
  let nb = 0, wb = 0;
  for (let i = 0; i < 365; i++) {
    const d = Engine.addDays('2026-10-20', i), k = R.dailyOf(d);
    if (k.no !== i + 1 || k.date !== d) nb++;
    if (k.star !== Engine.WEEK[new Date(d + 'T00:00:00Z').getUTCDay()]) wb++;
  }
  check('2026-10-20 から365日分の No. が通し番号で、★は曜日の決まり（月火★1・水木金★2・土日★3）どおり', nb === 0 && wb === 0, nb + '日 No. 違い / ' + wb + '日 ★違い');
}

/* ---------- 連続日数（日替わりの記録から数える） ---------- */
{
  check('0時をまたいでも、開いた日のルールを3時までに解決すれば数える（3時を過ぎた・前の日に開いていないものは数えない）',
    R.countsOnDay('2026-10-22', true, '2026-10-23', 0) && R.countsOnDay('2026-10-22', true, '2026-10-23', 2) && !R.countsOnDay('2026-10-22', true, '2026-10-23', 3) &&
    !R.countsOnDay('2026-10-22', false, '2026-10-23', 0) && R.countsOnDay('2026-10-23', false, '2026-10-23', 12), '');
  const s1 = sv(solvedDays('2026-10-18', 4, { '2026-10-22': { state: 'done', solvedOnDay: true } }), { bestStreak: 4 });
  R.recountStreak(s1, '2026-10-22');
  check('解決した日を足すと、記録から数え直す（10-18〜22 で連続5日・最高5日）', s1.stats.streak === 5 && s1.stats.lastDailyDate === '2026-10-22' && s1.stats.bestStreak === 5 && s1.daily['2026-10-22'].streak === 5, J(s1.stats));
  check('翌日のホームでも連続が続いている・最後に解決した日が一昨日なら0', R.shownStreak(s1.daily, '2026-10-23') === 5 && R.shownStreak(s1.daily, '2026-10-24') === 0, '');
  const s2 = sv(solvedDays('2026-10-19', 2, { '2026-10-22': { state: 'done', solvedOnDay: true } }), { bestStreak: 7 });
  R.recountStreak(s2, '2026-10-22');
  check('1日あくと連続は1から（最高は残る）', s2.stats.streak === 1 && s2.stats.bestStreak === 7, J(s2.stats));
  const daily = { '2026-10-22': { state: 'playing', openedOnDay: true } };
  check('0〜3時のホームに、前の日に開いたルールがまだ間に合うと出す（3時で消える）', R.pendingDay(daily, '2026-10-23', 1) === '2026-10-22' && R.pendingDay(daily, '2026-10-23', 3) === null, '');
  check('0〜3時は、前の日のルールが間に合ううちは連続を切らない', R.shownStreak(solvedDays('2026-10-20', 2), '2026-10-23', true) === 2 && R.shownStreak(solvedDays('2026-10-20', 2), '2026-10-23', false) === 0, '');
  check('解決済み・前の日に開いていないルールはお知らせに出さない', R.pendingDay({ '2026-10-22': { state: 'done', openedOnDay: true } }, '2026-10-23', 1) === null && R.pendingDay({ '2026-10-22': { state: 'playing' } }, '2026-10-23', 1) === null, '');
  check('その日のうちに解決していない日（過去のルールを後から解いた）は連続に数えない', R.streakAt({ '2026-10-21': { state: 'done' }, '2026-10-22': { state: 'done', solvedOnDay: true } }, '2026-10-22') === 1, '');
  const tz = solvedDays('2026-12-22', 13);
  check('日付が2日以内で戻っても（時差）連続をそのまま見せる', R.shownStreak(tz, '2027-01-02') === 13 && R.shownStreak(tz, '2027-01-01') === 13, '');
  check('時計を大きく戻したホームでは連続0、戻せば連続が残る', R.shownStreak(tz, '2026-12-01') === 0 && R.shownStreak(tz, '2027-01-04') === 13, '');
  // 東へ移動して 01-02 を飛ばして 01-03 を解き、西へ戻って 01-02 を解いた: つながる
  const gap = sv(solvedDays('2026-12-22', 11, { '2027-01-03': { state: 'done', solvedOnDay: true }, '2027-01-02': { state: 'done', solvedOnDay: true } }));
  R.recountStreak(gap, '2027-01-02');
  check('日付が戻った日に、抜けていた日を解決すると、前後の連続がつながる（巻き戻さない）', gap.stats.streak === 13 && gap.stats.lastDailyDate === '2027-01-03' && gap.daily['2027-01-03'].streak === 13 && gap.daily['2027-01-02'].streak === 12, J(gap.stats));
  // 先の日付（時計のずれ）で1日解いてから、本当の日付に戻して毎日解く: 本当のつながりで数える
  const fut = sv(solvedDays('2026-10-17', 5, { '2027-01-01': { state: 'done', solvedOnDay: true } }), { bestStreak: 5 });
  let okF = R.shownStreak(fut.daily, '2026-10-22') === 5;
  for (let i = 0; i < 3; i++) { const d = Engine.addDays('2026-10-22', i); fut.daily[d] = { state: 'done', solvedOnDay: true }; R.recountStreak(fut, d); if (fut.stats.streak !== 6 + i || R.shownStreak(fut.daily, d) !== 6 + i) okF = false; }
  check('先の日付で解決（時計のずれ）しても、本当の日付で毎日解決すれば連続が続く', okF && fut.stats.bestStreak === 8, J(fut.stats));
}

/* ---------- 記録帳の並び ---------- */
{
  check('記録帳: 初日は No.1 の1行', J(R.bookDays('2026-10-20')) === '["2026-10-20"]', '');
  check('記録帳: 時計が No.1 より前でも No.1 の1行（空にならない・No.0 を出さない）', J(R.bookDays('2026-10-01')) === '["2026-10-20"]', '');
  const L = R.bookDays('2026-12-01');
  check('記録帳: 今日から No.1 まで新しい順（12-01 は43行）', L.length === 43 && L[0] === '2026-12-01' && L[42] === '2026-10-20' && L.every((d, i) => i === 0 || d < L[i - 1]), L.length);
  const a = R.bookRows('2026-12-01', 0, 30, R.monthOf), b = R.bookRows('2026-12-01', 30, 60, R.monthOf);
  const heads = a.concat(b).filter((x) => x.head).map((x) => x.head);
  check('記録帳: 月の見出しは月ごとに1回（もっと見るで足しても重ならない）', J(heads) === '["2026-12","2026-11","2026-10"]' && a.concat(b).filter((x) => !x.head).length === 43, J(heads));
  check('記録帳: i 番目の日付と日数（一覧を作らずに出す）が一覧と同じ', R.bookCount('2026-12-01') === 43 && L.every((d, i) => R.bookDayAt('2026-12-01', i) === d), '');
  const t0 = performance.now();
  const far = '9999-12-31', nFar = R.bookCount(far), rowsFar = R.bookRows(far, 0, 30, R.monthOf).filter((x) => !x.head);
  const msFar = performance.now() - t0;
  check('記録帳: 端末の時計が 9999-12-31 でも、最初の30行と残りの日数を100ms以内に出す', nFar === Engine.diffDays('2026-10-20', far) + 1 && rowsFar.length === 30 && rowsFar[0].item === far && msFar < 100, `${nFar}日 ${msFar.toFixed(1)}ms`);
}

/* ---------- 保存 ---------- */
const KEY = ST.KEY;
{
  const base = () => ({
    v: 1, t: 5, epoch: '', settings: { sound: false, haptics: true, theme: 'dark' },
    daily: { '2026-10-21': { state: 'done', obs: [3, 30], guess: [true, false], fails: [], tries: 1, judging: false, grade: 3, power: 0.6, rule: 'red', v: Engine.VERSION, openedOnDay: true, solvedOnDay: true, streak: 2 } },
    practice: { cur: { 1: null, 2: { seed: 'p1', star: 2, state: 'playing', obs: [1], guess: [true], fails: [], tries: 0, v: Engine.VERSION }, 3: null }, solved: 3, top: 1, byStar: { 1: 1, 2: 2, 3: 0 } },
    tutorial: { done: 2, dismissed: false, cur: null },
    zukan: { red: { d: '2026-10-21', m: 'daily', no: 2, n: 1 }, 'blue|n>=4': { d: '2026-10-21', m: 'practice', no: null, n: 2 } },
    stats: { streak: 2, bestStreak: 5, lastDailyDate: '2026-10-21', totalSolved: 6, top: 4, found: 3, powerSum: 3.5, powerN: 7 },
    log: [{ d: '2026-10-21', m: 'd', s: 2, p: 0.6, g: 3 }],
  });
  const kept = (r) => !!r && r.stats.totalSolved === 6 && r.stats.bestStreak === 5 && !!r.daily['2026-10-21'] && r.daily['2026-10-21'].grade === 3 && r.daily['2026-10-21'].rule === 'red' &&
    r.practice.cur[2] && r.practice.cur[2].seed === 'p1' && r.tutorial.done === 2 && r.settings.sound === false && r.settings.theme === 'dark' && r.zukan.red && r.zukan['blue|n>=4'].n === 2 && r.log.length === 1 &&
    r.stats.powerN === 7 && r.stats.powerSum === 3.5;
  LS.clear(); ST.reset();
  const d0 = ST.readStore();
  check('保存: 何も無いときは既定の形（v:1）', d0 && d0.v === 1 && Object.keys(d0.daily).length === 0 && d0.tutorial.done === 0 && Object.keys(d0.zukan).length === 0 && d0.stats.powerN === 0, '');
  LS.set(KEY, J(base()));
  check('保存: 正しい保存はそのまま読める（調査力の合計も）', kept(ST.readStore()), '');
  const badKeys = ['2026-10-32', '2026-13-01', '2026-02-30', '2026-10-19', '2026-1-05', 'abc', '__proto__', 'constructor'];
  const failed = [];
  badKeys.forEach((k) => {
    LS.set(KEY, J(base()).replace('"daily":{', '"daily":{' + J(k) + ':{"state":"playing","obs":[1]},'));
    let r = null; try { r = ST.readStore(); } catch (e) { r = null; }
    if (!kept(r) || Object.prototype.hasOwnProperty.call(r.daily, k)) failed.push(k);
  });
  check('保存: 読めない日付のキー（10-32・13月・2-30・No.1 より前・形違い・__proto__）があっても、ほかの記録は全部読める', failed.length === 0, failed.join(' '));
  const o4 = base();
  o4.daily['2026-10-22'] = { state: 'done', obs: [1, 1, 99, -1, 2.5, '3', 0], guess: ['x', true], fails: [[5, 5, 6], 'x', [100]], tries: 'abc', grade: 7, power: 'NaN', rule: 'red<script>', v: 'x' };
  o4.daily['2026-10-23'] = 'broken';
  o4.daily['2026-10-24'] = { state: 'weird' };
  o4.daily['2026-10-25'] = { state: 'playing', obs: [4], rule: 'blue', grade: 3, power: 0.5 };
  o4.stats.streak = 'x'; o4.stats.found = -9; o4.stats.lastDailyDate = '2026-99-99'; o4.stats.top = 99; o4.stats.powerSum = 'x'; o4.stats.powerN = -3;
  o4.practice.cur = { 1: { seed: { x: 1 }, star: 1, state: 'playing' }, 2: { seed: 'p2', star: 3, state: 'playing' }, 3: 'x' };
  o4.tutorial = { done: 99, dismissed: 'yes', cur: { ep: 7 } };
  o4.settings = { sound: 'no', theme: 'purple' };
  o4.zukan = { red: { d: 'x', m: 'zzz', no: -1, n: 'many' }, constructor: { d: '2026-10-21', n: 1 }, '__proto__': { n: 1 }, 'red;drop': { n: 1 }, nosuch: 'x' };
  o4.log = [{ d: '2026-10-21', p: 2 }, { d: 'x', p: 0.5 }, 'x', { d: '2026-10-22', m: 'p', s: 9, p: 0.25, g: 0 }];
  LS.set(KEY, J(o4));
  const r4 = ST.readStore();
  const x22 = r4 && r4.daily['2026-10-22'], x25 = r4 && r4.daily['2026-10-25'];
  const noNaN = (o) => !/NaN|undefined|Infinity/.test(J(o));
  check('保存: 型違い・壊れた中身でも例外を出さず、決まった形に収める（NaN を出さない）',
    !!r4 && noNaN(r4) && x22 && J(x22.obs) === '[1,0]' && J(x22.guess) === '[null,true]' && J(x22.fails) === '[[5,6]]' && x22.tries === 1 && x22.grade === 0 && x22.power === null && !('rule' in x22) &&
    !r4.daily['2026-10-23'] && !r4.daily['2026-10-24'] && r4.stats.streak === 0 && r4.stats.found === 0 && r4.stats.lastDailyDate === null && r4.stats.top === r4.stats.totalSolved &&
    r4.practice.cur[1] === null && r4.practice.cur[2] === null && r4.practice.cur[3] === null && r4.practice.solved === 3 && r4.tutorial.done === 3 && r4.tutorial.dismissed === false && r4.tutorial.cur === null &&
    r4.settings.sound === true && r4.settings.theme === 'auto' && !!r4.daily['2026-10-21'] && r4.stats.powerN === 1 && r4.stats.powerSum === 0.25, J(x22) + ' ' + J(r4 && r4.stats));
  check('保存: 途中（playing）の記録には、答えのルール・結果の★・調査力を残さない', x25 && !('rule' in x25) && x25.grade === 0 && x25.power === null && J(x25.obs) === '[4]', J(x25));
  check('保存: エンジンのルールの id はすべて図鑑のキーとして読める', Engine.RULES.every((x) => { const o = ST.sanitize({ v: 1, zukan: { [x.id]: { d: '2026-10-21', n: 1 } } }); return !!o.zukan[x.id]; }), '');
  check('保存: 図鑑は形の正しいルールの id だけ読む（constructor・__proto__・記号まじりは捨てる。中身は既定の値に直す）',
    J(Object.keys(r4.zukan)) === '["red"]' && r4.zukan.red.d === null && r4.zukan.red.m === 'daily' && r4.zukan.red.no === null && r4.zukan.red.n === 1 && !Object.prototype.hasOwnProperty.call(r4.zukan, 'constructor'), J(r4.zukan));
  check('保存: 調査力の推移は日付と 0〜1 の値がある件だけ読む（★・結果の★は1〜3に直す。合計が無い保存は推移から作る）', r4.log.length === 1 && r4.log[0].p === 0.25 && r4.log[0].m === 'p' && r4.log[0].s === 1 && r4.log[0].g === 1, J(r4.log));
  LS.clear(); ST.reset();
  LS.set(KEY, '{"v":1,"daily":{"2026-10-21"');
  const r5 = ST.readStore();
  check('保存: 壊れた JSON は null を返し、元の文字列を別のキー（.broken）に控える', r5 === null && LS.get(KEY + '.broken') === '{"v":1,"daily":{"2026-10-21"', String(LS.get(KEY + '.broken')));
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  const sv5 = JSON.parse(LS.get(KEY));
  check('保存: 壊れた保存のあとも遊べて、次の保存で正しい形になる（控えは残る）', sv5.v === 1 && sv5.settings.sound === false && LS.has(KEY + '.broken'), '');
  const r6 = ST.sanitize({ v: 1, stats: { totalSolved: 4 } });
  const r6b = ST.sanitize({ v: 1, practice: { solved: 2 }, daily: { '2026-10-21': { state: 'done' } } });
  check('保存: 古い形（daily・practice・tutorial・zukan・log・settings が無い、記録の項目が足りない）も読め、足りない所は既定の値',
    r6.v === 1 && r6.stats.totalSolved === 4 && r6.practice.cur[1] === null && r6.tutorial.done === 0 && r6.settings.theme === 'auto' && Array.isArray(r6.log) && J(r6.zukan) === '{}' &&
    r6b.practice.solved === 2 && r6b.practice.byStar[1] === 0 && r6b.daily['2026-10-21'].tries === 1 && Array.isArray(r6b.daily['2026-10-21'].obs), J(r6b.daily));
  LS.clear(); ST.reset();
  const newer = J({ v: 2, something: 'new', stats: { totalSolved: 40 } });
  LS.set(KEY, newer);
  const r7 = ST.readStore();
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  check('保存: 新しい版の保存（v:2）は読まず、上書きもしない', r7 === null && ST.newer() === true && LS.get(KEY) === newer, LS.get(KEY));
  ST.reset();
  LS.clear();
  ST.setS(ST.sanitize(base()));
  const other = base();
  other.daily['2026-10-22'] = { state: 'done', obs: [0], guess: [true], fails: [], tries: 1, grade: 2, power: 0.5, rule: 'blue', v: Engine.VERSION, openedOnDay: true, solvedOnDay: true, streak: 3 };
  other.stats.totalSolved = 7; other.stats.streak = 3; other.stats.lastDailyDate = '2026-10-22';
  other.zukan.blue = { d: '2026-10-22', m: 'daily', no: 3, n: 1 };
  LS.set(KEY, J(other));
  ST.update((s) => { s.settings.haptics = false; });
  const sv8 = JSON.parse(LS.get(KEY));
  check('保存: 別のタブで付けた記録（解決・連続・図鑑）を、このタブの保存で消さない', !!sv8.daily['2026-10-22'] && sv8.stats.totalSolved === 7 && sv8.stats.streak === 3 && !!sv8.zukan.blue && sv8.settings.haptics === false, J(sv8.stats));
  ST.setS(ST.sanitize(base()));
  LS.delete(KEY);
  ST.update((s) => { s.settings.sound = true; });
  const sv9 = JSON.parse(LS.get(KEY));
  check('保存: 保存が丸ごと消えていたら、手元の記録を書き戻す（空で上書きしない）', sv9.stats.totalSolved === 6 && !!sv9.zukan.red && sv9.settings.sound === true, '');
  lsFail = true;
  let ok10 = true;
  try { ST.update((s) => { s.settings.sound = false; }); } catch (e) { ok10 = false; }
  lsFail = false;
  check('保存: 書き込めない環境（容量・プライベート）でも例外を出さず、保存できないことを覚える', ok10 && ST.ok() === false, '');
  ST.reset();
}

/* ---------- 画面の関数: 途中の保存・解決の記録 ---------- */
function mkP(pz, o, tab) {
  const T = tab || ctx;
  return Object.assign({
    mode: 'daily', pz, date: pz.date || null, no: pz.no || null, ep: null, star: pz.star, seed: null,
    obs: [], fails: [], tries: 0, phase: 'look', pick: { c: null, s: null, n: null }, guess: null, shown: null, flipPending: false,
    jcards: null, jans: null, jres: null, confirm: false, grade: 0, power: null, epoch: T.ST.getS().epoch || '', openedOnDay: true, isToday: true, tutDone0: 0, rec: null, legacy: false,
  }, o || {});
}
const addObs = (P, card, guess) => { P.obs.push({ card, ok: Engine.test(P.pz, card), guess }); };
// 最善手で調べ、判定1回で解決した状態にする
function solveBest(P) {
  P.obs = [];
  for (const c of P.pz.stats.bestCards) addObs(P, c, Engine.test(P.pz, c));
  P.tries = 1;
  P.grade = Engine.grade(P.pz, V.engineObs(P), P.tries);
  P.power = Engine.review(P.pz, V.engineObs(P)).power;
  P.phase = 'done';
}
{
  LS.clear(); ST.reset(); ST.setS(ST.defaults()); ST.persist();
  const pz = Engine.daily('2026-10-21');
  const P1 = mkP(pz);
  addObs(P1, pz.stats.bestCards[0], !Engine.test(pz, pz.stats.bestCards[0]));
  UI.setP(P1); UI.saveProgress();
  let s = JSON.parse(LS.get(KEY)), r = s.daily['2026-10-21'];
  check('途中: 調べたカード・予想・その日のうちに開いた、を保存する（state は playing）', r.state === 'playing' && J(r.obs) === J([Engine.cardIndex(pz.stats.bestCards[0])]) && r.guess[0] === !Engine.test(pz, pz.stats.bestCards[0]) && r.openedOnDay === true && r.v === Engine.VERSION, J(r));
  check('途中: 保存に答えのルール（id・文）を書かない', !('rule' in r) && !LS.get(KEY).includes(pz.ruleText) && !LS.get(KEY).includes('"' + pz.ruleId + '"'), LS.get(KEY));
  P1.phase = 'judge'; P1.jcards = Engine.judgeCards(pz, V.knownObs(P1)); P1.tries = 1; P1.fails.push(P1.jcards.slice());
  UI.saveProgress();
  r = JSON.parse(LS.get(KEY)).daily['2026-10-21'];
  check('途中: 判定に進んだこと・外れた判定の5枚・判定の回数を保存する', r.judging === true && r.fails.length === 1 && r.fails[0].length === P1.jcards.length && r.tries === 1 && r.state === 'playing', J(r));
  const Q = mkP(pz); UI.restore(Q, ST.sanitize(JSON.parse(LS.get(KEY))).daily['2026-10-21']);
  check('開き直し: 保存した調べ・予想・外れた判定・判定の回数・判定の途中が戻る（○×はエンジンで決め直す）', Q.obs.length === 1 && Q.obs[0].ok === Engine.test(pz, Q.obs[0].card) && Q.obs[0].guess === P1.obs[0].guess && Q.fails.length === 1 && Q.tries === 1 && Q.phase === 'judge', J({ obs: Q.obs, tries: Q.tries, phase: Q.phase }));
  const Q2 = mkP(pz);
  UI.restore(Q2, { obs: [Engine.cardIndex(pz.examples[0].card), 0, 1, 2, 3, 4, 5, 6, 7, 8], guess: [], fails: [], tries: 0, judging: false });
  check('開き直し: 例のカード・上限を超える調べは捨てる', Q2.obs.length === pz.budget && Q2.obs.every((o) => !V.clueList(Q2).some((x) => x.kind === 'ex' && Engine.cardIndex(x.card) === Engine.cardIndex(o.card))), Q2.obs.length);
  check('開き直し: 前の版（VERSION）の途中は使わない（保存した版と同じときだけ当てはめる）', /const same = !!rec && rec\.v === Engine\.VERSION/.test(fnSrc('startCase')) && /if \(same && rec\.state === 'playing'\) restore\(P, rec\)/.test(fnSrc('startCase')), '');
  const P2 = mkP(pz); solveBest(P2); UI.setP(P2);
  UI.onSolve(new Date(2026, 9, 21, 20, 0));
  s = JSON.parse(LS.get(KEY)); r = s.daily['2026-10-21'];
  check('解決: 記録（state done・見抜いたルール・結果の★・調査力・判定の回数）と、解決数・★3の数・連続1日', r.state === 'done' && r.rule === pz.ruleId && r.grade === 3 && r.tries === 1 && typeof r.power === 'number' && r.judging === false &&
    s.stats.totalSolved === 1 && s.stats.top === 1 && s.stats.streak === 1 && s.stats.lastDailyDate === '2026-10-21' && r.solvedOnDay === true && r.streak === 1, J({ r, st: s.stats }));
  check('解決: ルール図鑑に登録する（初めての日・今日のルール・No.・1回）と調査力の推移に1件・合計に1問', s.zukan[pz.ruleId] && s.zukan[pz.ruleId].d === '2026-10-21' && s.zukan[pz.ruleId].m === 'daily' && s.zukan[pz.ruleId].no === 2 && s.zukan[pz.ruleId].n === 1 &&
    s.log.length === 1 && s.log[0].m === 'd' && s.log[0].s === pz.star && s.log[0].g === 3 && s.stats.powerN === 1 && Math.abs(s.stats.powerSum - s.log[0].p) < 1e-9, J({ z: s.zukan, log: s.log }));
  UI.onSolve(new Date(2026, 9, 21, 21, 0));
  s = JSON.parse(LS.get(KEY));
  check('解決: もう解決した日（別のタブで先に解決した）をもう一度記録しても、数え直さない', s.stats.totalSolved === 1 && s.zukan[pz.ruleId].n === 1 && s.log.length === 1 && s.stats.powerN === 1, J(s.stats));
  const pz22 = Engine.daily('2026-10-22');
  const P3 = mkP(pz22, { openedOnDay: true }); solveBest(P3); UI.setP(P3);
  UI.onSolve(new Date(2026, 9, 23, 1, 0));
  s = JSON.parse(LS.get(KEY));
  check('解決: 夜に開いたルールを0時過ぎ（3時まで）に解決すると、開いた日の分として連続に数える', s.stats.streak === 2 && s.stats.lastDailyDate === '2026-10-22' && s.daily['2026-10-22'].solvedOnDay === true, J(s.stats));
  const pz20 = Engine.daily('2026-10-20');
  const P4 = mkP(pz20, { openedOnDay: false }); solveBest(P4); UI.setP(P4);
  UI.onSolve(new Date(2026, 9, 23, 12, 0));
  s = JSON.parse(LS.get(KEY));
  check('解決: 過去の日のルールを後から解決しても、連続には数えない（解決数・図鑑には数える）', s.stats.streak === 2 && s.stats.totalSolved === 3 && !s.daily['2026-10-20'].solvedOnDay && !!s.zukan[pz20.ruleId] && R.shownStreak(s.daily, '2026-10-23') === 2, J(s.stats));
  // 0〜3時の猶予に「今日 → 昨日」の順で解く（10-20・21 は解決済み、10-22 は夜に開いた）
  for (const order of ['today-first', 'yesterday-first']) {
    LS.clear(); ST.reset();
    const s0 = ST.defaults();
    for (const d of ['2026-10-20', '2026-10-21']) s0.daily[d] = { state: 'done', obs: [], guess: [], fails: [], tries: 1, judging: false, grade: 2, power: 0.5, rule: 'red', v: Engine.VERSION, openedOnDay: true, solvedOnDay: true };
    s0.stats = Object.assign(s0.stats, { streak: 2, bestStreak: 2, lastDailyDate: '2026-10-21', totalSolved: 2 });
    ST.setS(s0); ST.persist();
    const A22 = mkP(Engine.daily('2026-10-22'), { openedOnDay: true }); UI.setP(A22); UI.saveProgress();
    const A23 = mkP(Engine.daily('2026-10-23'), { openedOnDay: true });
    const steps = order === 'today-first' ? [[A23, new Date(2026, 9, 23, 0, 30)], [A22, new Date(2026, 9, 23, 1, 0)]] : [[A22, new Date(2026, 9, 23, 0, 30)], [A23, new Date(2026, 9, 23, 1, 0)]];
    for (const [P, when] of steps) { solveBest(P); UI.setP(P); UI.onSolve(when); }
    s = JSON.parse(LS.get(KEY));
    check('連続: 0〜3時の猶予に「' + (order === 'today-first' ? '今日 → 昨日' : '昨日 → 今日') + '」の順で解いても、連続4日（最高4日・ホームも4日）', s.stats.streak === 4 && s.stats.bestStreak === 4 && s.stats.lastDailyDate === '2026-10-23' &&
      s.daily['2026-10-22'].streak === 3 && s.daily['2026-10-23'].streak === 4 && R.shownStreak(s.daily, '2026-10-23', false) === 4, J({ st: s.stats, d22: s.daily['2026-10-22'].streak, d23: s.daily['2026-10-23'].streak }));
  }
  // 判定のやり直しで解決: ★1
  LS.clear(); ST.reset(); ST.setS(ST.defaults()); ST.persist();
  const P5 = mkP(pz); addObs(P5, pz.stats.bestCards[0], true); P5.tries = 3; P5.grade = Engine.grade(pz, V.engineObs(P5), 3); P5.power = Engine.review(pz, V.engineObs(P5)).power; P5.phase = 'done'; UI.setP(P5);
  UI.onSolve(new Date(2026, 9, 21, 9, 0));
  s = JSON.parse(LS.get(KEY));
  check('解決: 判定をやり直して解決したら結果は★1・★3の数は増えない', s.daily['2026-10-21'].grade === 1 && s.daily['2026-10-21'].tries === 3 && s.stats.top === 0, J(s.daily['2026-10-21']));
  // 調べずに判定へ進んで通過: ★2・「見事な調査」と言わない・調査力は 0（判定に進んだときの残りを数える）
  const P0 = mkP(pz); P0.tries = 1; P0.grade = Engine.grade(pz, [], 1); P0.power = Engine.review(pz, []).power; P0.phase = 'done'; UI.setP(P0);
  const msg0 = UI.gradeMsg(Engine.review(pz, []));
  check('結果: 調べずに判定へ進んで通過しても★3 にならず（★2）、「見事な調査」などの文を出さない。調査力は 0%', P0.grade === 2 && !/見事|調べで候補を1つに絞り/.test(msg0) && /調べずに/.test(msg0) && P0.power === 0, P0.grade + ' ' + msg0 + ' ' + P0.power);
  const P0b = mkP(pz); addObs(P0b, pz.stats.bestCards[0], true); P0b.tries = 1; P0b.grade = Engine.grade(pz, V.engineObs(P0b), 1); UI.setP(P0b);
  const rvb = Engine.review(pz, V.engineObs(P0b));
  check('結果: 候補が2つ以上のまま判定に進んで当てたら★2（文に残っていた候補の数）', rvb.left > 1 && P0b.grade === 2 && UI.gradeMsg(rvb).includes(rvb.left + '通り'), P0b.grade + ' ' + UI.gradeMsg(rvb));
  // 別のタブで記録を消した（epoch が変わった）
  LS.clear(); ST.reset(); ST.setS(ST.defaults()); ST.persist();
  const P6 = mkP(pz, { epoch: '' }); addObs(P6, pz.stats.bestCards[0], true); UI.setP(P6);
  const wiped = ST.defaults(); wiped.epoch = 'k2x9'; wiped.t = 99;
  LS.set(KEY, J(wiped));
  UI.saveProgress();
  s = JSON.parse(LS.get(KEY));
  check('別のタブで記録を消したあとは、開いていた問題の途中を書き戻さない', s.epoch === 'k2x9' && Object.keys(s.daily).length === 0, J(s.daily));
  solveBest(P6);
  UI.onSolve(new Date(2026, 9, 21, 10, 0));
  s = JSON.parse(LS.get(KEY));
  check('別のタブで記録を消したあとに解決すると、新しい記録として数える', s.epoch === 'k2x9' && s.stats.totalSolved === 1 && s.stats.streak === 1 && UI.getP().epoch === 'k2x9' && !!s.daily['2026-10-21'], J(s.stats));
  // 練習
  LS.clear(); ST.setS(ST.defaults()); ST.persist();
  const pp = Engine.generate({ seed: 'app-check', star: 2 });
  const P7 = mkP(pp, { mode: 'practice', date: null, no: null, star: 2, seed: 'app-check', openedOnDay: false });
  addObs(P7, pp.stats.bestCards[0], true); UI.setP(P7); UI.saveProgress();
  s = JSON.parse(LS.get(KEY));
  const midOK = s.practice.cur[2] && s.practice.cur[2].seed === 'app-check' && s.practice.cur[2].state === 'playing' && UI.practiceResume(ST.sanitize(s).practice.cur[2], 2) && !UI.practiceResume(ST.sanitize(s).practice.cur[2], 3);
  solveBest(P7); UI.onSolve(new Date(2026, 9, 21, 10, 0)); UI.onSolve(new Date(2026, 9, 21, 10, 5));
  s = JSON.parse(LS.get(KEY));
  check('練習: ★ごとに途中を保存して続きから開ける。解決は1問として数える（連続・解決した日は変えない）', midOK && s.practice.solved === 1 && s.practice.byStar[2] === 1 && s.practice.top === (P7.grade === 3 ? 1 : 0) && s.practice.cur[2].state === 'done' &&
    !UI.practiceResume(ST.sanitize(s).practice.cur[2], 2) && s.stats.totalSolved === 0 && s.stats.streak === 0 && s.zukan[pp.ruleId].m === 'practice' && s.log.length === 1 && s.log[0].m === 'p', J(s.practice));
  check('練習: 前の版の途中からは続けない', !UI.practiceResume(Object.assign({}, s.practice.cur[2], { state: 'playing', v: Engine.VERSION - 1 }), 2), '');
  const pq = Engine.generate({ seed: 'app-check-2', star: 2, ruleId: pp.ruleId });
  const P8 = mkP(pq, { mode: 'practice', date: null, no: null, star: pq.star, seed: 'app-check-2', openedOnDay: false }); solveBest(P8); UI.setP(P8);
  UI.onSolve(new Date(2026, 9, 25, 10, 0));
  s = JSON.parse(LS.get(KEY));
  check('図鑑: 同じルールをもう一度見抜くと回数が増え、初めての日は変わらない', s.zukan[pp.ruleId].n === 2 && s.zukan[pp.ruleId].d === '2026-10-21', J(s.zukan));
  const s60 = ST.defaults();
  for (let i = 0; i < 70; i++) ST.addLog(s60, { d: '2026-10-21', m: 'p', s: 1, p: i / 100, g: 2 });
  ST.addLog(s60, { d: '2026-10-21', m: 'p', s: 1, p: null, g: 2 });
  const sum70 = Array.from({ length: 70 }, (_, i) => i / 100).reduce((a, x) => a + x, 0);
  check('調査力: 推移は新しい60件だけ残し、これまでの平均は全部の合計から出す（60件で切れない・調査力の無い問題は足さない）', s60.log.length === 60 && s60.log[0].p === 0.1 && s60.log[59].p === 0.69 && s60.stats.powerN === 70 && Math.abs(s60.stats.powerSum - sum70) < 1e-9, s60.stats.powerN);
  // はじめての調査
  LS.clear(); ST.setS(ST.defaults()); ST.persist();
  const t2 = Engine.tutorial(2);
  const P9 = mkP(t2, { mode: 'tutorial', date: null, no: null, ep: 2, openedOnDay: false });
  addObs(P9, t2.stats.bestCards[0], false); UI.setP(P9); UI.saveProgress();
  s = JSON.parse(LS.get(KEY));
  const tmid = s.tutorial.cur && s.tutorial.cur.ep === 2 && s.tutorial.done === 0;
  solveBest(P9); UI.onSolve(new Date(2026, 9, 21, 10, 0));
  s = JSON.parse(LS.get(KEY));
  check('はじめての調査: 途中を保存し、解決したら次の話へ進む。記録（解決数・練習・図鑑・調査力の推移）には数えない', tmid && s.tutorial.done === 2 && s.tutorial.cur === null && s.stats.totalSolved === 0 && s.practice.solved === 0 && J(s.zukan) === '{}' && s.log.length === 0 && s.stats.powerN === 0, J(s.tutorial));
}

/* ---------- 別のタブ（同じ localStorage を2つのタブで） ---------- */
{
  const LS2 = new Map();
  const A = makeTab(LS2), B = makeTab(LS2);
  A.ST.setS(A.ST.defaults()); A.ST.persist(); B.ST.setS(B.ST.readStore());
  const sb = (T, P) => { P.obs = []; for (const c of P.pz.stats.bestCards) P.obs.push({ card: c, ok: Engine.test(P.pz, c), guess: true }); P.tries = 1; P.grade = Engine.grade(P.pz, T.V.engineObs(P), 1); P.power = Engine.review(P.pz, T.V.engineObs(P)).power; P.phase = 'done'; };
  // 同じ練習を A・B で開き、A で解決、そのあと B で1回調べて保存（裏に回した）→ B でも解決
  const pz = Engine.generate({ seed: 'multi', star: 2 });
  const PA = mkP(pz, { mode: 'practice', date: null, no: null, star: 2, seed: 'multi', openedOnDay: false }, A);
  const PB = mkP(JSON.parse(J(pz)), { mode: 'practice', date: null, no: null, star: 2, seed: 'multi', openedOnDay: false }, B);
  A.UI.setP(PA); A.UI.saveProgress();
  sb(A, PA); A.UI.onSolve(new Date(2026, 9, 21, 10, 0));
  B.UI.setP(PB); PB.obs.push({ card: pz.stats.bestCards[0], ok: Engine.test(pz, pz.stats.bestCards[0]), guess: true }); B.UI.saveProgress();
  sb(B, PB); B.UI.onSolve(new Date(2026, 9, 21, 10, 5));
  let s = JSON.parse(LS2.get(KEY));
  check('別のタブ: 同じ練習を2つのタブで解いても1問として数える（解決数・図鑑・調査力の推移）', s.practice.solved === 1 && s.practice.byStar[2] === 1 && s.zukan[pz.ruleId].n === 1 && s.log.length === 1 && s.practice.cur[2].state === 'done', J({ solved: s.practice.solved, z: s.zukan[pz.ruleId], log: s.log.length }));
  // はじめての調査 第2話を A で解決したあと、B（同じ話の途中）が保存しても「続きから」を作り直さない
  const t2 = Engine.tutorial(2);
  const TA = mkP(t2, { mode: 'tutorial', date: null, no: null, ep: 2, openedOnDay: false, tutDone0: 1 }, A), TB = mkP(JSON.parse(J(t2)), { mode: 'tutorial', date: null, no: null, ep: 2, openedOnDay: false, tutDone0: 1 }, B);
  A.UI.setP(TA); sb(A, TA); A.UI.onSolve(new Date(2026, 9, 21, 11, 0));
  B.UI.setP(TB); TB.obs.push({ card: t2.stats.bestCards[0], ok: Engine.test(t2, t2.stats.bestCards[0]), guess: true }); B.UI.saveProgress();
  s = JSON.parse(LS2.get(KEY));
  check('別のタブ: はじめての調査の話を別のタブで解決したあと、途中の保存で「続きから」を作り直さない', s.tutorial.done === 2 && s.tutorial.cur === null, J(s.tutorial));
  // 日替わり: B が判定に進んだあと、A（調べる途中のまま）が保存しても judging を消さない
  const dz = Engine.daily('2026-10-21');
  const DA = mkP(dz, {}, A), DB = mkP(JSON.parse(J(dz)), {}, B);
  B.UI.setP(DB); DB.phase = 'judge'; DB.jcards = Engine.judgeCards(dz, B.V.knownObs(DB)); B.UI.saveProgress();
  A.UI.setP(DA); DA.obs.push({ card: dz.stats.bestCards[0], ok: Engine.test(dz, dz.stats.bestCards[0]), guess: true }); A.UI.saveProgress();
  let r = JSON.parse(LS2.get(KEY)).daily['2026-10-21'];
  check('別のタブ: 別のタブが判定に進んだ記録を、調べる途中のタブの保存で消さない（また調べられるようにしない）', r.judging === true && r.obs.length === 0, J(r));
  // 判定をやり直した（外れた判定が増えた）記録も、前の段階のタブで消さない
  DB.fails.push(DB.jcards.slice()); DB.tries = 1; B.UI.saveProgress();
  DA.phase = 'judge'; DA.obs = []; DA.jcards = Engine.judgeCards(dz, []); A.UI.saveProgress();
  r = JSON.parse(LS2.get(KEY)).daily['2026-10-21'];
  check('別のタブ: 外れた判定が増えた記録を、前の段階のタブの保存で消さない', r.fails.length === 1 && r.tries === 1, J(r));
  check('別のタブ: 別のタブで先に進んだ（解決・判定・やり直し）ら、保存から開き直す（storage）', /rec\.state === 'done' \|\| \(rec\.judging && P\.phase === 'look'\) \|\| rec\.fails\.length > P\.fails\.length/.test(SRC) && /startCase\(spec, P\.pz\)/.test(SRC), '');
}

/* ---------- ホームの「はじめての調査」の入口 ---------- */
{
  const at = (f) => { const s = ST.defaults(); f(s); ST.setS(s); return UI.showTutCard(); };
  const cases = [
    ['記録が何も無い（初回）', () => {}, true],
    ['日替わりを1つ解決した', (s) => { s.stats.totalSolved = 1; }, false],
    ['練習を1問解決した', (s) => { s.practice.solved = 1; }, false],
    ['日替わりを解決したが、はじめての調査を進めている', (s) => { s.stats.totalSolved = 1; s.tutorial.done = 1; }, true],
    ['第2話の途中', (s) => { s.stats.totalSolved = 1; s.tutorial.cur = { ep: 2 }; }, true],
    ['×で閉じた', (s) => { s.tutorial.dismissed = true; }, false],
    ['3話とも済んだ', (s) => { s.tutorial.done = 3; }, false],
  ];
  const bad = cases.filter((c) => at(c[1]) !== c[2]).map((c) => c[0]);
  check('ホーム: はじめての調査の入口は、初回と進めている人に出し、閉じた・3話済んだ・ほかを解決した人には出さない', bad.length === 0, bad.join(' / '));
  ST.setS(ST.defaults());
  check('はじめての調査: 閉じても「遊び方」から始められる（途中なら続きから、3話済んだら第1話から遊び直せる）', /case 'howTut': openTutorial\(S\.tutorial\.cur \? S\.tutorial\.cur\.ep : S\.tutorial\.done >= 3 \? 1 : tutNext\(\)\)/.test(SRC) && /id="howTut"/.test(fnSrc('renderHowto')) && /続きから/.test(fnSrc('tutGoLabel')), '');
}

/* ---------- はじめての調査の案内（guideOf） ---------- */
{
  const t1 = Engine.tutorial(1), t2 = Engine.tutorial(2), t3 = Engine.tutorial(3);
  const L1 = t1.lesson, L2 = t2.lesson;
  const T = (pz, ep) => mkP(pz, { mode: 'tutorial', date: null, no: null, ep, openedOnDay: false });
  const free = (P, pred) => Engine.CARDS.map((x) => ({ c: x.c, s: x.s, n: x.n })).find((c) => !V.clueList(P).some((y) => V.idxOf(y.card) === V.idxOf(c)) && pred(c));
  // 第2話: 最初にカードを作ったときは「×になるカードも試そう」を出さない
  const A = T(t2, 2);
  const c0 = free(A, () => true); A.pick = { c: c0.c, s: c0.s, n: c0.n };
  const gA = V.guideOf(A);
  // ○だと思ったカードが○で、候補が減らなかった
  const B = T(t2, 2);
  const flatCard = free(B, (c) => { const n0 = V.candCount(B); const ok = Engine.test(t2, c); B.obs.push({ card: c, ok, guess: true }); const n1 = V.candCount(B); B.obs.pop(); return ok && n0 === n1; });
  let gB1 = null, gB2 = null;
  if (flatCard) {
    const before = V.candCount(B);
    B.obs.push({ card: flatCard, ok: true, guess: true }); B.pick = { c: flatCard.c, s: flatCard.s, n: flatCard.n };
    B.shown = { i: V.idxOf(flatCard), ok: true, guess: true, before, after: V.candCount(B), found: false };
    gB1 = V.guideOf(B);
    const c1 = free(B, () => true); B.shown = null; B.pick = { c: c1.c, s: c1.s, n: c1.n };
    gB2 = V.guideOf(B);
  }
  check('はじめての調査 第2話: 「×になりそうなカードも試そう」は、○のカードで「候補が減らなかった」のあとにだけ出す', gA.main === L2.first && gA.main !== L2.ask && !!gB1 && gB1.main === L2.flat && gB1.sub === L2.ask && gB2.main === L2.ask && V.flatSeen(B),
    J({ gA, gB1, gB2 }));
  // 回数を使い切った（候補は2つ以上）・候補が1つ
  const C = T(t3, 3);
  const bad = Engine.CARDS.filter((x) => !V.clueList(C).some((y) => V.idxOf(y.card) === V.idxOf(x))).slice(0, 40);
  let pickedOut = false;
  for (const x of bad) { if (C.obs.length >= C.pz.budget) break; const card = { c: x.c, s: x.s, n: x.n }; C.obs.push({ card, ok: Engine.test(t3, card), guess: true }); if (V.candCount(C) <= 1) { C.obs.pop(); } }
  if (C.obs.length >= C.pz.budget && V.candCount(C) > 1) pickedOut = true;
  const gC = V.guideOf(C);
  const D = T(t1, 1); for (const c of t1.stats.bestCards) D.obs.push({ card: c, ok: Engine.test(t1, c), guess: true });
  const gD = V.guideOf(D);
  check('はじめての調査: 回数を使い切ったら「使い切った」の文、候補が1つなら「絞れた」の文（「確かめてから判定へ」と矛盾しない）', pickedOut && gC.main === t3.lesson.out && gD.main === L1.judge, J({ gC, gD }));
  // 案内の場所: 最初の一言は上、カードを作ったら・調べたら下の帯
  const E0 = T(t1, 1), E1 = T(t1, 1); E1.pick = { c: c0.c, s: c0.s, n: c0.n };
  check('はじめての調査: 最初の一言は上、カードを作ったあと・調べたあと・判定は下の帯に案内を出す（小さい画面でも見える）',
    !V.guideInBar(E0) && V.guideHTML(E0, 'top').includes('id="guide"') && V.guideHTML(E0, 'bar') === '' && V.guideInBar(E1) && V.barHTML(E1).html.includes('bar-guide') && V.guideHTML(E1, 'top') === '' &&
    V.barHTML(D).html.includes(L1.judge), '');
}

/* ---------- 画面の部品: 帯・メーター・難しさと結果の★・読み上げ ---------- */
{
  const pz = Engine.daily('2026-10-24');
  const P = mkP(pz);
  const c0 = pz.stats.bestCards[0];
  P.pick = { c: c0.c, s: c0.s, n: c0.n };
  const bench = V.benchHTML(P), bar = V.barHTML(P).html;
  check('帯: 予想（合うと思う／合わないと思う）と［調べる］は下の帯に置く（台には予想のボタンを置かない）', !/data-guess=/.test(bench) && /data-guess="1"/.test(bar) && /data-guess="0"/.test(bar) && /id="btnAsk"/.test(bar) && /id="btnJudge"/.test(bar) && /role="radiogroup"/.test(bar), '');
  P.guess = true;
  check('帯: 予想を選ぶと［調べる］が押せる', V.canAsk(P) && !/id="btnAsk"[^>]*disabled/.test(V.barHTML(P).html), '');
  P.confirm = true;
  check('帯: 判定へ進む前の確かめ（回数と候補の数・調査を続ける・判定へ進む）', /id="btnStay"/.test(V.barHTML(P).html) && /id="btnJudgeGo"/.test(V.barHTML(P).html) && V.barHTML(P).html.includes('あと' + V.leftOf(P) + '回'), '');
  P.confirm = false;
  check('帯: 候補が1つなら判定へ進むとき確かめない（wantJudge）', /leftOf\(P\) > 0 && candCount\(P\) > 1 && !P\.confirm/.test(fnSrc('wantJudge')), '');
  check('選ぶボタン（role=radio）: 選んだもの（無ければ最初）だけ Tab で止まる（tabindex 0）', (() => { const m = bench.match(/data-pk="c"[^>]*>/g) || []; const b2 = V.benchHTML(Object.assign({}, P, { pick: { c: null, s: null, n: null } })); const z = (b2.match(/role="radio"[^>]*tabindex="0"[^>]*data-pk="c"/g) || []).length; return (bench.match(/tabindex="0"[^>]*data-pk="c"/g) || []).length === 1 && z === 1 && m.length === 3; })(), '');
  P.phase = 'judge'; P.jcards = Engine.judgeCards(pz, []); P.jans = P.jcards.map(() => null);
  const mj = V.meterHTML(P, V.candCount(P));
  check('メーター: 判定中は「調べる あとN回」を出さず「判定中」と調べた回数', /判定中/.test(mj) && !/調べる あと/.test(mj), mj.slice(-200));
  P.phase = 'look';
  const m0 = V.meterHTML(P, V.candCount(P));
  check('メーター: 「全○通り」と「例の2枚で○通り」をつなげて書く（はじめの数の意味が分かる）', m0.includes('全' + Engine.SCOPES[pz.scope].size + '通り') && m0.includes('例の2枚で' + pz.stats.start + '通り') && m0.includes('mt-one') === false, '');
  check('メーター: 1つに絞れたら「1つに絞れた」（改行で分かれない）', V.meterHTML(P, 1).includes('<span class="mt-one hl">1つに絞れた</span>') && /\.mt-one\{[^}]*white-space:nowrap/.test(SRC), '');
  check('難しさと結果の★を書き分ける（見出しは「難しさ」、コピー文は「難しさ★2」と「結果★★☆」）', V.metaHTML(P).includes('難しさ') && /難しさ★\d/.test(V.copyText(Object.assign({}, P, { grade: 2, phase: 'done', tries: 1 }), 0)) && /結果★★☆/.test(V.copyText(Object.assign({}, P, { grade: 2, phase: 'done', tries: 1 }), 0)), '');
  check('見出し: 過去の日のルールは「今日のルール」と書かない', V.titleOf(Object.assign({}, P, { isToday: false })) === 'No.' + pz.no + ' のルール' && V.titleOf(Object.assign({}, P, { isToday: true })) === '今日のルール', '');
  check('読み上げ: 文をつなぐとき「！。」「。。」にならない', V.sentence(['○ 合う', '発見！', '候補 3から2', '']) === '○ 合う。発見！候補 3から2。' && !/！。|。。/.test(V.sentence(['a。', 'b！', 'c'])) && V.sentence(['候補 3から2', '考えを直すチャンス。']) === '候補 3から2。考えを直すチャンス。', V.sentence(['○ 合う', '発見！', '候補 3から2']));
  check('読み上げ: 調べた結果・判定の結果は say() でまとめて伝え、画面の一言は live region にしない（2回読み上げない）', !/bench-res[^"]*" role="status"/.test(SRC) && !/class="jd-msg" role="status"/.test(SRC) && !/id="guide" role="status"/.test(SRC), '');
}

/* ---------- 答えが漏れないか（答えだけが違う同じ形の問題で、同じ画面になるか） ---------- */
{
  const pzs = [];
  for (let i = 0; i < 60; i++) pzs.push(['日替わり ' + Engine.addDays('2026-10-20', i), Engine.daily(Engine.addDays('2026-10-20', i)), 'daily']);
  for (const star of [1, 2, 3]) for (let i = 0; i < 20; i++) pzs.push(['練習★' + star + ' ' + i, Engine.generate({ seed: 'leak' + i, star }), 'practice']);
  for (let k = 1; k <= 3; k++) pzs.push(['はじめて第' + k + '話', Engine.tutorial(k), 'tutorial']);
  const tbl = (id) => Engine.table(id);
  // 答えだけを B に替えた問題（例の2枚・範囲・上限・はじめの候補の数は同じ。答えにつながる項目は違う値にする）
  const twin = (pz, idB) => {
    const q = JSON.parse(J(pz));
    const r = Engine.ruleById(idB);
    q.ruleId = r.id; q.ruleText = r.text;
    q.best = pz.best === 1 ? 2 : 1;
    q.stats.path = [pz.stats.start, 1]; q.stats.size = r.size; q.stats.level = r.level; q.stats.cost = r.cost; q.stats.sure = 0.5; q.stats.bestMax = null;
    q.stats.bestCards = [Engine.CARDS.map((x) => ({ c: x.c, s: x.s, n: x.n })).find((c) => !pz.stats.bestCards.some((b) => Engine.cardIndex(b) === Engine.cardIndex(c)))];
    return q;
  };
  const screens = [];
  const html = (P) => {
    const n = V.candCount(P);
    let h = V.metaHTML(P) + V.titleOf(P) + V.meterHTML(P, n) + V.cluesHTML(P, -1);
    h += P.phase === 'look' ? V.benchHTML(P) : V.judgeHTML(P);
    h += V.guideHTML(P, 'top') + V.barHTML(P).html;
    if (P.mode === 'tutorial') { const g = V.guideOf(P); h += g.main + g.sub; }
    return h;
  };
  const leaks = [], diffs = [];
  let nTwin = 0;
  for (const [name, pz, mode] of pzs) {
    const forbid = [pz.ruleText, J(pz.stats.path), 'data-rule', 'ruleId', 'ruleText'];
    const look = (label, h) => { const hit = forbid.filter((t) => h.includes(t)); if (hit.length) leaks.push(name + ' / ' + label + ': ' + hit.join(',')); };
    const mk = (q) => mkP(q, { mode, ep: mode === 'tutorial' ? q.tutorial : null, seed: mode === 'practice' ? 'leak' : null, date: q.date || null, no: q.no || null });
    const best = pz.stats.bestCards;
    for (let k = 0; k <= best.length; k++) {
      const obs = best.slice(0, k);
      const C = Engine.candidates(pz, obs.map((card) => ({ card })));
      const PA = mk(pz);
      for (const c of obs) PA.obs.push({ card: c, ok: Engine.test(pz, c), guess: !Engine.test(pz, c) });
      // 双子の答え B: 候補のうち、判定の5枚でいちばん答えが分かれるもの（無ければ答えと違う最初の候補）
      let idB = null;
      if (C.length >= 2) {
        const Jc = Engine.judgeCards(pz, V.knownObs(PA));
        let bestD = -1;
        for (const id of C) { if (id === pz.ruleId) continue; const d = Jc.filter((c) => tbl(id)[Engine.cardIndex(c)] !== tbl(pz.ruleId)[Engine.cardIndex(c)]).length; if (d > bestD) { bestD = d; idB = id; } }
      }
      const states = [];
      // はじめ／途中（何も選んでいない）
      states.push(['途中' + k, (P) => {}]);
      if (k > 0) states.push(['調べた直後' + k, (P) => { const c = obs[k - 1]; const b4 = Engine.candidates(P.pz, obs.slice(0, k - 1).map((card) => ({ card }))).length; P.shown = { i: Engine.cardIndex(c), ok: Engine.test(P.pz, c), guess: !Engine.test(P.pz, c), before: b4, after: V.candCount(P), found: true }; P.pick = { c: c.c, s: c.s, n: c.n }; }]);
      // まだ調べていないカードを作った（答えが A と B で分かれるカードを選ぶ）
      const split = idB ? Engine.CARDS.map((x) => ({ c: x.c, s: x.s, n: x.n })).find((c) => !V.clueList(PA).some((y) => V.idxOf(y.card) === V.idxOf(c)) && tbl(idB)[Engine.cardIndex(c)] !== tbl(pz.ruleId)[Engine.cardIndex(c)]) : null;
      const anyFree = Engine.CARDS.map((x) => ({ c: x.c, s: x.s, n: x.n })).find((c) => !V.clueList(PA).some((y) => V.idxOf(y.card) === V.idxOf(c)));
      const pc = split || anyFree;
      states.push(['カードを作った' + k, (P) => { P.pick = { c: pc.c, s: pc.s, n: pc.n }; P.guess = true; }]);
      states.push(['確かめ' + k, (P) => { P.pick = { c: pc.c, s: pc.s, n: pc.n }; P.guess = true; P.confirm = true; }]);
      states.push(['判定' + k, (P) => { P.phase = 'judge'; P.jcards = Engine.judgeCards(P.pz, V.knownObs(P)); P.jans = P.jcards.map(() => null); }]);
      states.push(['判定に答えた' + k, (P) => { P.phase = 'judge'; P.jcards = Engine.judgeCards(P.pz, V.knownObs(P)); P.jans = P.jcards.map((_, j) => j % 2 === 0); }]);
      for (const [label, set] of states) {
        const PA2 = mk(pz); PA2.obs = PA.obs.map((o) => Object.assign({}, o)); set(PA2); UI.setP(PA2);
        const hA = html(PA2);
        look(label, hA);
        screens.push(1);
        if (idB) {
          const qB = twin(pz, idB);
          const PB = mk(qB); PB.obs = PA.obs.map((o) => ({ card: o.card, ok: Engine.test(qB, o.card), guess: o.guess })); set(PB); UI.setP(PB);
          const hB = html(PB);
          nTwin++;
          if (hA !== hB) { let i = 0; while (i < hA.length && hA[i] === hB[i]) i++; diffs.push(name + ' / ' + label + ': …' + hA.slice(Math.max(0, i - 60), i + 40) + ' ／ …' + hB.slice(Math.max(0, i - 60), i + 40)); }
        }
      }
    }
    // 判定が外れたあとの画面（外れた5枚の答えは見せてよい）とコピー文
    const P = mk(pz);
    for (const c of best) P.obs.push({ card: c, ok: Engine.test(pz, c), guess: true });
    P.phase = 'judge'; P.jcards = Engine.judgeCards(pz, V.knownObs(P)); P.jans = P.jcards.map((c) => Engine.test(pz, c)); P.jans[0] = !P.jans[0]; P.tries = 1; P.fails.push(P.jcards.slice()); P.jres = { wrong: [0] };
    UI.setP(P); look('判定が外れた', html(P));
    P.jcards = Engine.judgeCards(pz, V.knownObs(P)); P.jans = P.jcards.map(() => null); P.jres = null;
    look('もう一度判定', html(P));
    if (mode !== 'tutorial') { P.phase = 'done'; P.tries = 2; P.grade = 1; look('コピー文', V.copyText(P, 3)); }
  }
  check('答え: 答えだけが違う同じ形の問題（候補に残っている別のルール）で、解決する前の画面（メーター・手がかり・台・判定・下の帯・案内）の HTML が同じ（' + nTwin + '組。まだ調べていないカードの○×・最善手・path を属性や隠した要素に入れても見つける）', diffs.length === 0 && nTwin > 500, diffs.slice(0, 2).join(' / ') + ' 組 ' + nTwin);
  check('答え: 解決する前の画面と案内・コピー文に、答えのルールの文・最善手の流れが入らない（日替わり60日・練習60問・はじめての3話、' + screens.length + '画面）', leaks.length === 0, leaks.slice(0, 4).join(' / '));
  // コピー文の形
  const pz = Engine.daily('2026-10-22');
  const P = mkP(pz); UI.setP(P);
  for (const c of pz.stats.bestCards) addObs(P, c, true);
  P.tries = 1; P.phase = 'done'; P.grade = 3;
  const counts = Engine.review(pz, V.engineObs(P)).counts;
  const want = '法則ハンター No.3（難しさ★' + pz.star + '）\n結果★★★ 調べ' + pz.stats.bestCards.length + '回・判定1回\n候補 ' + counts.join('→') + '\n連続2日\nhttps://kiyotake1229.github.io/hosoku-hunter/';
  check('コピー文: 決まった形（No.・難しさ・結果の★・調べと判定の回数・候補の減り方・その日の連続・最後に公開 URL）で、ルールは書かない', V.copyText(P, 2) === want && !V.copyText(P, 2).includes(pz.ruleText), J(V.copyText(P, 2)));
  const pp = Engine.generate({ seed: 'copy', star: 3 });
  const Pp = mkP(pp, { mode: 'practice', date: null, no: null }); Pp.tries = 2; Pp.phase = 'done'; Pp.grade = 1;
  check('コピー文: 練習は「練習」と難しさ、調べずに解決したら「調べ0回」、連続の行は出さない（最後に公開 URL）', V.copyText(Pp, 5) === '法則ハンター 練習（難しさ★3）\n結果★☆☆ 調べ0回・判定2回\n候補 ' + pp.stats.start + '\nhttps://kiyotake1229.github.io/hosoku-hunter/', J(V.copyText(Pp, 5)));
  check('コピー文: 過去の日の結果は、今日の連続ではなく、その日の連続（その日のうちに解決した日だけ）を書く', /copyText\(P, P\.mode === 'daily' && P\.rec && P\.rec\.solvedOnDay \? streakOfDay\(P\.date\) : 0\)/.test(fnSrc('copyFn')), '');
  check('答え: ルールの文（ruleText）を画面に出すのは結果の画面（renderResult）だけ。記録帳・ホーム・図鑑は解決した記録（rule）から出す',
    SRC.split('\n').filter((l) => /\.ruleText\b/.test(l) && !/^\s*(\/\/|\*)/.test(l)).every((l) => /rtext = P\.pz\.ruleText|ex\.ruleText/.test(l)) &&
    /rec\.state === 'done'[\s\S]*rec\.rule/.test(fnSrc('renderHome')) && /r\.state === 'done'[\s\S]*r\.rule/.test(fnSrc('dayRowHTML')), '');
  check('判定: 答え合わせの前は、判定のカードの答え（○×）を画面に書かない（外れた後だけ、その5枚の答えを出す）', !/Engine\.test/.test(fnSrc('judgeHTML')) && /if \(res\)/.test(fnSrc('judgeHTML')), '');
}

/* ---------- ネイティブ連携と PWA（#0004）: 偽の window.Capacitor・偽のプラグインで動かす ---------- */
// 画面の関数（触覚・状態バー・設定の画面・毎朝の通知）を、タブ A の文脈に足す（$・toast・cur を外から与える）
vm.runInContext('const DOM = {};\nconst $ = (sel) => DOM[sel] || null;\nlet cur = \'home\'; let confirmOpen = false;\nconst TOASTS = [];\nconst toast = (m) => { TOASTS.push(m); };\n' +
  [lineOf('let away = '), lineOf('const VIBE = '), lineOf('const HAPTIC = '), lineOf('const NOTI_BASE = '), lineOf('const NOTI_DAYS = '), lineOf('let notiDenied = '), lineOf('const isMine = ')].join('\n') + '\n' +
  [fnSrc('buzz'), fnSrc('applyTheme'), fnSrc('renderSettings'), fnSrc('morningList'), fnSrc('syncNotifications'), fnSrc('syncNow'), fnSrc('toggleNotify')].join('\n') +
  '\n;this.NU = { buzz, applyTheme, renderSettings, morningList, syncNotifications, toggleNotify, isMine, NOTI_BASE, NOTI_DAYS, DOM, TOASTS, chain: () => notiChain, denied: () => notiDenied, setDenied: (v) => { notiDenied = v; }, setCur: (v) => { cur = v; }, setAway: (v) => { away = v; } };', ctx);
const NU = ctx.NU, NV = ctx.NV;
// 別の環境（vm の文脈）を作る。ls: 開いたときの localStorage、win: window の代わり、extra: そのほかの大域（location・navigator・document）
const SRC_ENGINE = between('// ==ENGINE START==', '// ==ENGINE END==') + '\n;this.Engine = (typeof Engine !== "undefined") ? Engine : module.exports;';
const SRC_NATIVE = between('// ==NATIVE START==', '// ==NATIVE END==');
const winOf = (o) => { const w = Object.assign({ origin: 'https://kiyotake1229.github.io', isSecureContext: true }, o || {}); if (!('self' in w)) w.self = w; if (!('top' in w)) w.top = w; return w; };
function makeCtx({ ls, win, extra, store }) {
  const L = new Map(ls ? Object.entries(ls) : []);
  const c = { module: { exports: {} }, console };
  c.localStorage = { getItem: (k) => (L.has(k) ? L.get(k) : null), setItem: (k, v) => { L.set(k, String(v)); }, removeItem: (k) => { L.delete(k); } };
  c.window = win || winOf();
  Object.assign(c, extra || {});
  vm.createContext(c);
  vm.runInContext(SRC_ENGINE, c);
  vm.runInContext(SRC_NATIVE + '\n;this.NV = { NATIVE, FRAMED, plug, CAP };', c);
  if (store) {
    vm.runInContext(between('// ==DAYRULES START==', '// ==DAYRULES END==') + '\n' + between('// ==STORE START==', '// ==STORE END==') + '\n' + fnSrc('persistIfEmpty') +
      '\n;this.SX = { getS: () => S, nativeRestore, persist, persistIfEmpty, update, restoring: () => restoring, newer: () => newerStore, blank: () => blankAtStart };', c);
  }
  return { c, L };
}
const capWin = (plugins, o) => winOf(Object.assign({ Capacitor: { isNativePlatform: () => true, Plugins: plugins || {} } }, o || {}));
const tick = () => new Promise((r) => setTimeout(r, 0));

// iOS アプリかどうか・iframe の中か・プラグインの取り出し
{
  const web = makeCtx({}).c.NV;
  const capWeb = makeCtx({ win: winOf({ Capacitor: { isNativePlatform: () => false, Plugins: { Haptics: {} } } }) }).c.NV;
  const broken = makeCtx({ win: winOf({ Capacitor: { isNativePlatform: () => { throw new Error('x'); }, Plugins: { Haptics: {} } } }) }).c.NV;
  const nat = makeCtx({ win: capWin({ Haptics: { impact() {} } }) }).c.NV;
  check('ネイティブ: Web（Capacitor が無い・Web 版の Capacitor・判定が例外）では NATIVE が false で、plug はどのプラグインも返さない',
    web.NATIVE === false && web.plug('Haptics') === null && capWeb.NATIVE === false && capWeb.plug('Haptics') === null && broken.NATIVE === false && broken.plug('Haptics') === null, '');
  check('ネイティブ: iOS アプリ（isNativePlatform() が true）では window.Capacitor.Plugins のプラグインを返し、無いプラグインは null', nat.NATIVE === true && typeof nat.plug('Haptics').impact === 'function' && nat.plug('Preferences') === null, '');
  const framed = makeCtx({ win: winOf({ top: {} }) }).c.NV.FRAMED;
  const sandbox = makeCtx({ win: winOf({ origin: 'null' }) }).c.NV.FRAMED;
  const thrower = winOf(); Object.defineProperty(thrower, 'top', { get() { throw new Error('SecurityError'); } });
  const cross = makeCtx({ win: thrower }).c.NV.FRAMED;
  check('ネイティブ: FRAMED は iframe の中・origin の無い sandbox・親を読めない iframe で true、ふつうに開いたときは false', framed === true && sandbox === true && cross === true && web.FRAMED === false, '');
}

// Service Worker を登録する条件（registerSW）
{
  const swCase = (o) => {
    const regs = [], loads = [];
    const win = o.win || winOf(o.native ? { Capacitor: { isNativePlatform: () => true, Plugins: {} } } : {});
    if (o.secure === false) win.isSecureContext = false;
    win.addEventListener = (type, fn) => { if (type === 'load') loads.push(fn); };
    const nav = o.noSW ? {} : { serviceWorker: { register: (u) => { regs.push(u); return Promise.resolve(); } } };
    const { c } = makeCtx({ win, extra: { location: { protocol: o.protocol || 'https:' }, navigator: nav, document: { readyState: o.ready || 'complete' } } });
    let threw = false;
    try { vm.runInContext(fnSrc('registerSW') + '\n;registerSW();', c); } catch (e) { threw = true; }
    const before = regs.length;
    loads.forEach((f) => f());
    return { regs, before, threw };
  };
  const pub = swCase({});
  const local = swCase({ protocol: 'http:' });
  const late = swCase({ ready: 'loading' });
  check('Service Worker: https の公開の場所・ローカル（http://127.0.0.1）で開いたときは sw.js を登録する。読み込みの途中なら load のあとに登録する',
    pub.regs.join() === 'sw.js' && local.regs.join() === 'sw.js' && late.before === 0 && late.regs.join() === 'sw.js', J([pub.regs, local.regs, late]));
  const no = {
    'iOS アプリ': swCase({ native: true }), 'iframe（Artifact）': swCase({ win: winOf({ top: {} }) }), 'sandbox（origin が null）': swCase({ win: winOf({ origin: 'null' }) }),
    'file:': swCase({ protocol: 'file:' }), '安全でない接続': swCase({ protocol: 'http:', secure: false }), 'Service Worker の無いブラウザ': swCase({ noSW: true }),
  };
  const bad = Object.keys(no).filter((k) => no[k].regs.length || no[k].threw);
  check('Service Worker: iOS アプリ・iframe・sandbox・file:・安全でない接続では登録しない。Service Worker の無いブラウザでも例外を出さない', bad.length === 0, bad.join(' / '));
  check('Service Worker: 登録は起動（boot）の最後に1回', /registerSW\(\);/.test(fnSrc('boot')) && (SRC.match(/registerSW\(\)/g) || []).length === 2, '');
}

// 保存の二重化（iOS アプリでは localStorage と Preferences の両方に書く）と、起動時の戻し方・戻す順
{
  const KEY = ST.KEY;
  const prefs = (initial) => {
    const store = new Map(), log = [];
    if (initial != null) store.set(KEY, initial);
    return { store, log, fail: false,
      async get({ key }) { log.push('get'); if (this.fail) throw new Error('x'); return { value: store.has(key) ? store.get(key) : null }; },
      async set({ key, value }) { log.push('set'); store.set(key, value); } };
  };
  const rec = (t, extra) => JSON.stringify(Object.assign({ v: 1, t, epoch: '', settings: { sound: true, haptics: true, theme: 'dark', notifyMorning: true, notifyTime: '06:30' },
    daily: { '2026-10-21': { state: 'done', obs: [3, 17], guess: [true, false], fails: [], tries: 1, judging: false, grade: 3, power: 0.6, rule: 'red', v: Engine.VERSION, openedOnDay: true, solvedOnDay: true, streak: 1 } },
    zukan: { red: { d: '2026-10-21', m: 'daily', no: 2, n: 1 } },
    stats: { streak: 1, bestStreak: 4, lastDailyDate: '2026-10-21', totalSolved: 9, top: 5, found: 2, powerSum: 3, powerN: 5 } }, extra || {}));

  // persist は Preferences にも同じ JSON を書く（Web では何もしない）
  LS.clear(); ST.reset();
  const pf0 = prefs(null);
  FAKE.Preferences = pf0;
  ST.setS(ST.defaults());
  ST.update((s) => { s.settings.sound = false; });
  await tick();
  const same = pf0.store.get(KEY) === LS.get(KEY) && JSON.parse(pf0.store.get(KEY)).settings.sound === false;
  delete FAKE.Preferences;
  LS.clear(); ST.reset(); ST.setS(ST.defaults());
  check('二重の保存: iOS アプリでは、保存のたびに localStorage と Preferences（キー hosoku.v1）に同じ JSON を書く', same && pf0.log.join() === 'set', pf0.log.join());

  // 1) 開いたとき localStorage が空（OS が WebView の保存を消した）・Preferences に記録 → Preferences から戻す
  {
    const pf = prefs(rec(500));
    const { c, L } = makeCtx({ win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    const S1 = c.SX.getS();
    check('二重の保存: localStorage が空なら Preferences から戻す（記録・図鑑・設定がそのまま。localStorage にも書き戻す）',
      changed === true && S1.stats.totalSolved === 9 && S1.daily['2026-10-21'].rule === 'red' && S1.zukan.red && S1.settings.notifyTime === '06:30' && S1.settings.notifyMorning === true &&
      JSON.parse(L.get(KEY)).stats.totalSolved === 9 && c.SX.restoring() === false && pf.log.join() === 'get', pf.log.join());
  }
  // 2) localStorage のほうが新しい → localStorage のまま、Preferences を追いつかせる
  {
    const pf = prefs(rec(100, { stats: { totalSolved: 3 } }));
    const { c } = makeCtx({ ls: { [KEY]: rec(900) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    await tick();
    check('二重の保存: localStorage のほうが新しい（t が大きい）ときは localStorage のまま、Preferences に書いて追いつかせる',
      changed === false && c.SX.getS().stats.totalSolved === 9 && JSON.parse(pf.store.get(KEY)).t === 900 && pf.log.join() === 'get,set', pf.log.join());
  }
  // 3) Preferences のほうが新しい → Preferences から戻す
  {
    const pf = prefs(rec(900, { stats: { totalSolved: 12 } }));
    const { c, L } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    check('二重の保存: Preferences のほうが新しいときは Preferences から戻す', changed === true && c.SX.getS().stats.totalSolved === 12 && JSON.parse(L.get(KEY)).stats.totalSolved === 12, '');
  }
  // 4) Preferences が空・localStorage に記録 → Preferences に書く（アプリを新しく入れた直後など）
  {
    const pf = prefs(null);
    const { c } = makeCtx({ ls: { [KEY]: rec(300) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    await tick();
    check('二重の保存: Preferences が空なら localStorage の記録を Preferences に書く', changed === false && !!pf.store.get(KEY) && JSON.parse(pf.store.get(KEY)).t === 300, pf.log.join());
  }
  // 5) 起動の順: Preferences を読み終える前（restoring）は、空の記録を保存しようとしても Preferences に書かない。
  //    開いたとき localStorage が空だったら、待つ間に localStorage へ書かれた（t が新しい）空の記録より Preferences を優先する
  {
    let release;
    const pf = prefs(rec(500));
    const realGet = pf.get.bind(pf);
    pf.get = (a) => new Promise((r) => { release = () => r(realGet(a)); });
    const { c, L } = makeCtx({ win: capWin({ Preferences: pf }), store: true });
    const p = c.SX.nativeRestore();
    const during = c.SX.restoring();
    c.SX.persistIfEmpty();                         // 起動が先に来た（1.2秒たった）ときの「空なら保存」
    const lsDuring = L.get(KEY);
    c.SX.update((s) => { s.settings.sound = false; });   // 待つ間の操作（localStorage にだけ書く）
    await tick();
    const pfUntouched = pf.log.join() === '' && pf.store.get(KEY) === rec(500);
    release();
    const changed = await p;
    c.SX.persistIfEmpty();
    await tick();
    check('二重の保存（起動の順）: Preferences を読み終えるまでは「空なら保存」をせず、Preferences にも書かない',
      during === true && lsDuring == null && pfUntouched, J({ during, lsDuring, log: pf.log }));
    check('二重の保存（起動の順）: 開いたとき localStorage が空なら、待つ間に書かれた新しい空の記録より Preferences の記録を戻す。読み終えたら次の保存から Preferences にも書く',
      changed === true && c.SX.getS().stats.totalSolved === 9 && JSON.parse(L.get(KEY)).stats.totalSolved === 9 && c.SX.restoring() === false &&
      (c.SX.update((s) => { s.settings.haptics = false; }), true) && JSON.parse(pf.store.get(KEY)).settings.haptics === false, pf.log.join());
  }
  // 6) 新しい版の記録（v:2）が Preferences にある → どちらにも書かない
  {
    const newer = JSON.stringify({ v: 2, t: 999, stats: { totalSolved: 40 } });
    const pf = prefs(newer);
    const { c, L } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    c.SX.update((s) => { s.settings.sound = false; });
    await tick();
    check('二重の保存: Preferences に新しい版の記録（v:2）があれば読まず、localStorage にも Preferences にも書かない',
      changed === true && c.SX.newer() === true && pf.store.get(KEY) === newer && JSON.parse(L.get(KEY)).t === 100, pf.log.join());
  }
  // 7) Preferences が読めない → localStorage のまま。そのあとの保存は Preferences にも書く
  {
    const pf = prefs(rec(500)); pf.fail = true;
    const { c } = makeCtx({ ls: { [KEY]: rec(100) }, win: capWin({ Preferences: pf }), store: true });
    const changed = await c.SX.nativeRestore();
    c.SX.update((s) => { s.settings.sound = false; });
    await tick();
    check('二重の保存: Preferences が読めないときは localStorage のまま遊べ、次の保存から Preferences にも書く', changed === false && c.SX.restoring() === false && JSON.parse(pf.store.get(KEY)).settings.sound === false, pf.log.join());
  }
  // 8) Web（Preferences が無い）: 何もしない
  {
    const { c } = makeCtx({ ls: { [KEY]: rec(100) }, store: true });
    const changed = await c.SX.nativeRestore();
    check('二重の保存: Web（Preferences が無い）では戻す処理をせず、localStorage だけで動く', changed === false && c.SX.getS().stats.totalSolved === 9, '');
  }
  // 起動の決まり（ソース）: Preferences があるときは nativeRestore を待ってから boot（最長1.2秒）。persistIfEmpty は restoring の間は書かない
  const tail = SRC.slice(SRC.indexOf('/* ---------- 起動 ---------- */'));
  check('起動: iOS アプリでは Preferences から戻してから起動する（最長1.2秒）。Web はすぐ起動する。戻している間は押せない',
    /if \(plug\('Preferences'\)\) \{[\s\S]*setTimeout\(boot, 1200\)[\s\S]*nativeRestore\(\)\.then[\s\S]*\} else boot\(\);/.test(tail) &&
    /if \(restoring\) return;/.test(fnSrc('persistIfEmpty')) && !/\n  persistIfEmpty\(\);\n/.test(tail) && /if \(!booted\) return;/.test(SRC), '');
}

// 触覚（Haptics）・状態バー（StatusBar）
{
  const hc = [];
  FAKE.Haptics = { impact: (o) => { hc.push('impact:' + o.style); return Promise.resolve(); }, notification: (o) => { hc.push('notification:' + o.type); return Promise.resolve(); } };
  ST.setS(ST.defaults());
  VIB.length = 0;
  ['pick', 'result', 'found', 'wrong', 'solve', 'toggle'].forEach((k) => NU.buzz(k));
  const native = hc.join() === 'impact:LIGHT,impact:MEDIUM,impact:HEAVY,notification:WARNING,notification:SUCCESS,impact:LIGHT' && VIB.length === 0;
  check('触覚: iOS アプリでは Haptics（選ぶ・切り替え = 軽い impact、調べた = 中くらい、発見 = 強い impact、判定が外れた = warning、解決 = success）。navigator.vibrate は使わない', native, hc.join());
  hc.length = 0;
  NU.setAway(true); NU.buzz('solve'); NU.buzz('found'); NU.setAway(false);
  DOC.hidden = true; NU.buzz('solve'); DOC.hidden = false;
  check('触覚: iOS アプリが裏に回っている（away）間・画面が裏にある間は Haptics を呼ばない', hc.length === 0, hc.join());
  ST.getS().settings.haptics = false;
  NU.buzz('pick'); NU.buzz('solve');
  const off = hc.length === 0 && VIB.length === 0;
  ST.getS().settings.haptics = true;
  delete FAKE.Haptics;
  NU.buzz('pick'); NU.buzz('solve');
  const web = J(VIB) === J([6, [20, 50, 30, 50, 90]]);
  NAV.userActivation.hasBeenActive = false; VIB.length = 0;
  NU.buzz('pick');
  const quietBefore = VIB.length === 0;
  NAV.userActivation.hasBeenActive = true;
  check('触覚: 設定の「振動」が OFF なら Haptics も vibrate も呼ばない。Web は vibrate のパターン（画面に触れる前は呼ばない）', off && web && quietBefore, J(VIB));
  check('触覚: 調べた = result（発見のときは found だけで重ねない）・判定が外れた = wrong・解決 = solve',
    /if \(found\) discover\(\); else buzz\('result'\);/.test(fnSrc('ask')) && /buzz\('found'\)/.test(fnSrc('discover')) && /buzz\('wrong'\)/.test(fnSrc('check')) && /buzz\('solve'\)/.test(fnSrc('solve')), '');
  // 状態バー
  const sb = [];
  FAKE.StatusBar = { setStyle: (o) => { sb.push(o.style); return Promise.resolve(); } };
  const meta = () => ({ setAttribute(k, v) { this[k] = v; } });
  NU.DOM['#metaTheme'] = meta(); NU.DOM['#metaThemeDark'] = meta(); NU.DOM['#metaScheme'] = meta();
  const s = ST.getS();
  s.settings.theme = 'dark'; NU.applyTheme();
  const d = HTML.attrs['data-theme'] === 'dark' && NU.DOM['#metaTheme'].content === '#0F1513' && NU.DOM['#metaThemeDark'].content === '#0F1513' && NU.DOM['#metaScheme'].content === 'dark' && HTML.style.colorScheme === 'dark';
  s.settings.theme = 'light'; NU.applyTheme();
  const l = HTML.attrs['data-theme'] === 'light' && NU.DOM['#metaThemeDark'].content === '#ECEFEA' && NU.DOM['#metaScheme'].content === 'light';
  s.settings.theme = 'auto'; NU.applyTheme();
  const a = !('data-theme' in HTML.attrs) && NU.DOM['#metaTheme'].content === '#ECEFEA' && NU.DOM['#metaThemeDark'].content === '#0F1513' && NU.DOM['#metaScheme'].content === 'light dark';
  delete FAKE.StatusBar;
  NU.applyTheme();
  check('状態バー: 画面の色に合わせて StatusBar.setStyle（ダーク = DARK・ライト = LIGHT・自動 = DEFAULT）。StatusBar が無ければ呼ばない。theme-color・color-scheme も合わせる', sb.join() === 'DARK,LIGHT,DEFAULT' && d && l && a, sb.join());
  check('状態バー: 起動の0.9秒後とアプリに戻ったときにも当て直す。「自動」は端末の外観が変わったときも', /setTimeout\(applyTheme, 900\)/.test(fnSrc('boot')) && /resumeAll\(\);\s*applyTheme\(\);\s*syncNotifications\(\);/.test(SRC) && /matchMedia\('\(prefers-color-scheme: dark\)'\)[\s\S]{0,120}applyTheme\(\)/.test(SRC), '');
  ST.setS(ST.defaults());
}

// 毎朝の通知（LocalNotifications）
{
  // 予約する一覧
  const at8 = new Date(2026, 9, 20, 8, 0).getTime();
  const L1 = NU.morningList('2026-10-20', '07:00', at8);
  const c2 = Engine.dailyConfig('2026-10-21');
  const st2 = '★'.repeat(c2.star) + '☆'.repeat(3 - c2.star);
  const first = L1[0];
  const okFirst = first && first.id === NU.NOTI_BASE + 2 && first.title === '今日のルールが届きました' && first.body === 'No.2（難しさ' + st2 + '・候補' + Engine.SCOPES[c2.star].size + '通り）。カードに隠れたルールを見抜こう。' &&
    first.schedule.at.getTime() === new Date(2026, 9, 21, 7, 0).getTime() && first.schedule.allowWhileIdle === true && first.extra.date === '2026-10-21';
  const L2 = NU.morningList('2026-10-20', '23:30', at8);
  const ids = new Set(L2.map((x) => x.id));
  const allOK = L2.length === NU.NOTI_DAYS && ids.size === L2.length && L2.every((x, i) => NU.isMine(x.id) && x.id === NU.NOTI_BASE + i + 1 && x.body.startsWith('No.' + (i + 1) + '（難しさ' + '★'.repeat(Engine.dailyConfig(x.extra.date).star)));
  check('通知: 毎朝の通知は「今日のルールが届きました」。本文に No.・難しさ・候補の数。今日から28日分を1日ずつ、時刻を過ぎた分は入れない', okFirst && L1.length === NU.NOTI_DAYS - 1 && allOK, J(first));
  // 通知の文に答えのルールを書かない（ロック画面に出るため）。60日分
  const leak = [];
  for (let k = 0; k < 60; k += NU.NOTI_DAYS) {
    for (const x of NU.morningList(Engine.addDays('2026-10-20', k), '06:00', 0)) {
      const r = Engine.ruleById(Engine.dailyConfig(x.extra.date).ruleId);
      if ((x.title + x.body).includes(r.text) || (x.title + x.body).includes(r.id)) leak.push(x.extra.date);
    }
  }
  check('通知: 通知の題と本文に、その日の答えのルール（文・id）を書かない（ロック画面に出るため）', leak.length === 0, leak.join(' '));
  // 予約し直し（syncNow）: 前の予約（このアプリの番号だけ）を取り消してから入れ直す。許可は求めない
  const ln = (granted, allow) => {
    const log = [];
    return { log, granted, allow,
      async getPending() { log.push('getPending'); return { notifications: [{ id: NU.NOTI_BASE + 5 }, { id: 5 }, { id: NU.NOTI_BASE + 12 }, { id: 810003 }] }; },
      async cancel(o) { log.push('cancel:' + o.notifications.map((n) => n.id).join('/')); },
      async checkPermissions() { log.push('check'); return { display: this.granted ? 'granted' : 'prompt' }; },
      async requestPermissions() { log.push('request'); if (this.allow) this.granted = true; return { display: this.allow ? 'granted' : 'denied' }; },
      async schedule(o) { log.push('schedule:' + o.notifications.length); this.list = o.notifications; } };
  };
  const s = ST.getS();
  s.settings.notifyMorning = true; s.settings.notifyTime = '07:00';
  let N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const want = NU.morningList(Engine.localDateStr(new Date()), '07:00', Date.now()).map((x) => x.id).join();
  check('通知: 予約し直すときは、このアプリの予約だけを取り消して（ほかの番号は残す）、ON なら入れ直す。許可は求めない',
    N.log[0] === 'getPending' && N.log[1] === 'cancel:' + (NU.NOTI_BASE + 5) + '/' + (NU.NOTI_BASE + 12) && N.log.includes('check') && !N.log.includes('request') && N.list && N.list.map((x) => x.id).join() === want, N.log.join(' '));
  s.settings.notifyMorning = false;
  N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const offOK = N.log.some((x) => x.startsWith('cancel')) && !N.log.some((x) => x.startsWith('schedule')) && !N.log.includes('request');
  s.settings.notifyMorning = true;
  N = ln(false, true); FAKE.LocalNotifications = N;
  await NU.syncNotifications();
  const noPerm = !N.log.some((x) => x.startsWith('schedule')) && !N.log.includes('request') && NU.denied() === true;
  check('通知: OFF なら取り消すだけ。ON でも許可が無ければ予約せず「許可されていません」を出す（ここでも許可は求めない）', offOK && noPerm, N.log.join(' '));
  // 設定で ON にしたときだけ許可を求める
  s.settings.notifyMorning = false; NU.setDenied(false); NU.TOASTS.length = 0;
  N = ln(false, true); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const onOK = N.log.includes('request') && ST.getS().settings.notifyMorning === true && N.log.some((x) => x.startsWith('schedule')) && NU.TOASTS.some((t) => /毎朝 07:00 に知らせます/.test(t));
  ST.getS().settings.notifyMorning = false;
  N = ln(false, false); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const denyOK = N.log.includes('request') && ST.getS().settings.notifyMorning === false && NU.denied() === true && NU.TOASTS.includes('通知が許可されていません') && !N.log.some((x) => x.startsWith('schedule'));
  ST.getS().settings.notifyMorning = true;
  N = ln(true, true); FAKE.LocalNotifications = N;
  await NU.toggleNotify(); await NU.chain();
  const offT = !N.log.includes('request') && ST.getS().settings.notifyMorning === false && !N.log.some((x) => x.startsWith('schedule'));
  check('通知: 設定で ON にしたときだけ許可を求める。断られたら OFF のまま「通知が許可されていません」。OFF にするときは求めない', onOK && denyOK && offT, N.log.join(' '));
  // 設定の画面: 通知の行は LocalNotifications があるときだけ
  NU.DOM['#settingsBody'] = { innerHTML: '' };
  delete FAKE.LocalNotifications;
  NU.renderSettings();
  const webRow = NU.DOM['#settingsBody'].innerHTML;
  FAKE.LocalNotifications = ln(true, true); FAKE.Haptics = { impact() {}, notification() {} };
  ST.getS().settings.notifyMorning = false; NU.renderSettings();
  const offRow = NU.DOM['#settingsBody'].innerHTML;
  ST.getS().settings.notifyMorning = true; ST.getS().settings.notifyTime = '06:30'; NU.setDenied(true); NU.renderSettings();
  const onRow = NU.DOM['#settingsBody'].innerHTML;
  check('設定: 毎朝の通知の行は iOS アプリ（LocalNotifications があるとき）だけ。ON のときは時刻の欄、許可が無ければ注記', !/notifyMorning/.test(webRow) && /data-set="notifyMorning"/.test(offRow) && !/id="notifyTime"/.test(offRow) &&
    /id="notifyTime" value="06:30"/.test(onRow) && /通知が許可されていません/.test(onRow) && /「法則ハンター」で許可できます/.test(onRow), '');
  check('設定: iOS アプリでは振動の説明と「アプリの中に保存」を出し、サポート・プライバシーポリシーへのリンク（公開の場所の support.html・別のタブ）を置く',
    /調べる・発見・解決・判定の外れで軽く震える/.test(onRow) && /アプリの中/.test(onRow) && onRow.includes('href="' + NV.SITE_URL + 'support.html" target="_blank" rel="noopener"') && webRow.includes('href="' + NV.SITE_URL + 'support.html"') &&
    /対応している端末だけ/.test(webRow) && !/軽く震える/.test(webRow), '');
  check('通知: 通知を押したら今日のルールを開く（このアプリの番号の通知だけ。起動前なら起動のあと）。時刻を変えたら予約し直す',
    /addListener\('localNotificationActionPerformed'/.test(SRC) && /if \(isMine\(id\)\) openFromNotice\(\)/.test(SRC) && /pendingOpen = true/.test(fnSrc('openFromNotice')) &&
    /e\.target\.id !== 'notifyTime'/.test(SRC) && /TIME_RE\.test\(v\)/.test(SRC) && /t\.dataset\.set === 'notifyMorning'\) \{ toggleNotify\(\); return; \}/.test(SRC), '');
  delete FAKE.LocalNotifications; delete FAKE.Haptics; NU.setDenied(false);
  ST.setS(ST.defaults());
  // 保存: 通知の設定の読み込み
  const sn = ST.sanitize({ v: 1, settings: { notifyMorning: true, notifyTime: '06:45' } });
  const sb = ST.sanitize({ v: 1, settings: { notifyMorning: 'yes', notifyTime: '25:00' } });
  check('保存: 通知の設定（notifyMorning・notifyTime）を読み、形の違う値は既定（OFF・07:00）に戻す', sn.settings.notifyMorning === true && sn.settings.notifyTime === '06:45' && sb.settings.notifyMorning === false && sb.settings.notifyTime === '07:00' &&
    ST.defaults().settings.notifyMorning === false && ST.defaults().settings.notifyTime === '07:00', '');
}

// アプリが裏に回ったとき（ソース）
{
  const pa = fnSrc('pauseAll'), ra = fnSrc('resumeAll');
  check('裏に回ったら: 途中を保存し、音の仕組みを止める。裏で動く演出のタイマーは音・振動・発見の演出を出さない（document.hidden と away を見る）。戻ったら日付を確かめる',
    /saveProgress\(\)/.test(pa) && /AC\.suspend/.test(pa) && /clearTimeout\(idleT\)/.test(pa) && /checkDay\(\)/.test(ra) &&
    /if \(away\) return null;/.test(fnSrc('ensureAudio')) && /document\.hidden \|\| away\) return;/.test(fnSrc('buzz')) && /document\.hidden \|\| away\) return;/.test(fnSrc('discover')), '');
  check('裏に回ったら: ブラウザは visibilitychange、iOS アプリは App の appStateChange（isActive が false で away にして止め、true で戻す）',
    /addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) pauseAll\(\); else resumeAll\(\); \}\)/.test(SRC) &&
    /addListener\('appStateChange'[\s\S]{0,80}isActive === false\) \{ away = true; pauseAll\(\); return; \}\s*away = false;/.test(SRC), '');
}

// <head> のタグ・PWA の素材（manifest・アイコン・OGP・sw.js・サポートページ）
{
  const SITE = 'https://kiyotake1229.github.io/hosoku-hunter/';
  const head = SRC.slice(0, SRC.indexOf('</head>'));
  const has = (re) => re.test(head);
  // manifest と apple-touch-icon は <head> の小さなスクリプトが置く。iframe・sandbox（Claude Artifact）の中では置かない（読みに行って CSP のエラーになるため）
  const headJs = (/<script>([\s\S]*?apple-touch-icon[\s\S]*?)<\/script>/.exec(head) || [])[1] || '';
  const headLinks = (win) => {
    const added = [];
    const c = { window: win, document: { createElement: () => ({}), head: { appendChild: (l) => { added.push(l.rel + ' ' + l.href); } } } };
    vm.createContext(c);
    try { vm.runInContext(headJs, c); } catch (e) { added.push('例外 ' + e.message); }
    return added.join(',');
  };
  const thrower = winOf(); Object.defineProperty(thrower, 'top', { get() { throw new Error('SecurityError'); } });
  check('<head>: manifest と apple-touch-icon は、直接開いたときだけ置く（iframe・sandbox・親を読めない iframe では置かない）',
    headLinks(winOf()) === 'apple-touch-icon apple-touch-icon.png,manifest manifest.json' && headLinks(winOf({ top: {} })) === '' && headLinks(winOf({ origin: 'null' })) === '' && headLinks(thrower) === '' &&
    !/<link[^>]+rel="(manifest|apple-touch-icon)"/.test(head), headLinks(winOf()));
  check('<head>: ホーム画面のアプリ名・状態バー・theme-color のライト／ダーク・canonical',
    has(/name="apple-mobile-web-app-capable" content="yes"/) && has(/name="mobile-web-app-capable" content="yes"/) &&
    has(/name="apple-mobile-web-app-title" content="法則ハンター"/) && has(/name="apple-mobile-web-app-status-bar-style" content="default"/) &&
    has(/name="theme-color" content="#ECEFEA" media="\(prefers-color-scheme: light\)" id="metaTheme"/) && has(/name="theme-color" content="#0F1513" media="\(prefers-color-scheme: dark\)" id="metaThemeDark"/) &&
    head.includes('<link rel="canonical" href="' + SITE + '">'), '');
  check('<head>: 説明文・OGP（og:url・og:image は公開の場所の絶対 URL、1200×630）・Twitter カード', has(/<meta name="description" content="[^"]{30,}">/) && head.includes('property="og:url" content="' + SITE + '"') &&
    head.includes('property="og:image" content="' + SITE + 'ogp.png"') && has(/og:image:width" content="1200"/) && has(/og:image:height" content="630"/) && has(/name="twitter:card" content="summary_large_image"/) &&
    head.includes('name="twitter:image" content="' + SITE + 'ogp.png"') && has(/property="og:site_name" content="法則ハンター"/), '');
  const dir = path.dirname(target);
  const file = (f) => path.join(dir, f);
  const png = (f) => { try { const b = fs.readFileSync(file(f)); return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 } : null; } catch (e) { return null; } };
  let man = null; try { man = JSON.parse(fs.readFileSync(file('manifest.json'), 'utf8')); } catch (e) { man = null; }
  const icons = man && Array.isArray(man.icons) ? man.icons : [];
  const iconOK = icons.length === 4 && icons.every((x) => { const p = png(x.src); return p && x.sizes === p.w + 'x' + p.h && x.type === 'image/png'; }) &&
    ['any', 'maskable'].every((pu) => ['192x192', '512x512'].every((sz) => icons.some((x) => x.purpose === pu && x.sizes === sz)));
  check('manifest.json: 名前・start_url と scope は ./・縦向き・地の色はライトの --bg（#ECEFEA）・アイコン 192／512 を any と maskable で（ファイルの大きさも合う）',
    !!man && man.name === '法則ハンター' && man.short_name === '法則ハンター' && man.start_url === './' && man.scope === './' && man.id === './' && man.display === 'standalone' && man.orientation === 'portrait' &&
    man.theme_color === '#ECEFEA' && man.background_color === '#ECEFEA' && man.lang === 'ja' && iconOK, man ? J(icons) : 'manifest.json が読めない');
  const a = png('apple-touch-icon.png'), ios = png('ios-app/assets/icon.png'), og = png('ogp.png');
  check('画像: apple-touch-icon 180×180・iOS アプリのアイコンの元 1024×1024（どちらも透明なし）・OGP 1200×630・icon.svg がある',
    !!a && a.w === 180 && a.h === 180 && !a.alpha && !!ios && ios.w === 1024 && ios.h === 1024 && !ios.alpha && !!og && og.w === 1200 && og.h === 630 && fs.existsSync(file('icon.svg')), J({ a, ios, og }));

  // sw.js を偽の Service Worker の環境で動かす
  let swSrc = null; try { swSrc = fs.readFileSync(file('sw.js'), 'utf8'); } catch (e) { swSrc = null; }
  if (!swSrc) check('sw.js: ファイルがある', false, 'sw.js が無い');
  else {
    const H = {}, caches = new Map(), deleted = [], fetched = [];
    const mkCache = () => { const m = new Map(); return { m, async match(r) { return m.get(typeof r === 'string' ? r : r.url); }, async put(r, res) { m.set(typeof r === 'string' ? r : r.url, res); }, async addAll(list) { list.forEach((r) => m.set(r.url, { ok: true })); }, async keys() { return [...m.keys()]; }, async delete(k) { return m.delete(k); } }; };
    const scope = 'https://kiyotake1229.github.io/hosoku-hunter/';
    const sw = {
      module: { exports: {} }, console, URL, Promise, setTimeout,
      self: { addEventListener: (t, f) => { H[t] = f; }, registration: { scope, navigationPreload: null }, clients: { claim: async () => {} }, skipWaiting: async () => {}, location: { origin: 'https://kiyotake1229.github.io' } },
      caches: { open: async (n) => { if (!caches.has(n)) caches.set(n, mkCache()); return caches.get(n); }, keys: async () => [...caches.keys()], delete: async (n) => { deleted.push(n); return caches.delete(n); } },
      Request: function (u) { this.url = u; },
      Response: function () {},
      fetch: async (r) => { fetched.push(typeof r === 'string' ? r : r.url); return { ok: true, type: 'basic', status: 200, clone() { return this; } }; },
    };
    vm.createContext(sw);
    let swOK = true;
    try { vm.runInContext(swSrc + '\n;this.SWX = { PREFIX, APP_CACHE, FONT_CACHE, PRECACHE, refill };', sw); } catch (e) { swOK = false; }
    if (!swOK) check('sw.js: 読み込める', false, '');
    else {
      ['hosoku-app-v0', 'hosoku-old', 'dandori-app-v1', 'dandori-fonts-v1', 'usotsuki-app-v2', 'senda-v2', sw.SWX.FONT_CACHE].forEach((n) => caches.set(n, mkCache()));
      const waits = [];
      H.activate({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      check('sw.js: 古いキャッシュを消すのは「hosoku-」で始まるものだけ（段取り名人・嘘つき村などほかのアプリのキャッシュ・書体のキャッシュは残す）',
        sw.SWX.PREFIX === 'hosoku-' && sw.SWX.APP_CACHE.startsWith('hosoku-app-') && sw.SWX.FONT_CACHE.startsWith('hosoku-fonts-') && deleted.sort().join() === 'hosoku-app-v0,hosoku-old' &&
        caches.has('dandori-app-v1') && caches.has('usotsuki-app-v2') && caches.has('senda-v2') && caches.has(sw.SWX.FONT_CACHE), deleted.join());
      const pre = sw.SWX.PRECACHE.map((u) => u.replace(/^\.\//, ''));
      check('sw.js: 先にキャッシュするファイル（./・index.html・manifest・アイコン3つ・support.html）がこのフォルダにある', ['', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'support.html'].every((f) => pre.includes(f)) &&
        pre.filter((f) => f).every((f) => fs.existsSync(file(f))), pre.join(' '));
      // 消された分だけ取り直す（refill）
      const app = await sw.caches.open(sw.SWX.APP_CACHE);
      app.m.clear(); app.m.set('./index.html', { ok: true }); fetched.length = 0;
      await sw.SWX.refill();
      check('sw.js: ほかのアプリにキャッシュを消されたら、無くなったファイルだけを取り直す（refill）', fetched.length === sw.SWX.PRECACHE.length - 1 && !fetched.includes('./index.html') && sw.SWX.PRECACHE.every((u) => app.m.has(u)), fetched.join(' '));
      // ほかのアプリの場所・ほかのサイトには触らない。書体は書体の決まりで
      const resp = (url, mode) => { let r = false; H.fetch({ request: { method: 'GET', url, mode: mode || 'no-cors' }, respondWith: (p) => { r = true; Promise.resolve(p).catch(() => {}); }, waitUntil: (p) => { Promise.resolve(p).catch(() => {}); }, preloadResponse: Promise.resolve(undefined) }); return r; };
      check('sw.js: 同じドメインのほかのアプリ（/dandori-meijin/・/usotsuki-mura/）・ほかのサイトの読み込みには触らない。このアプリのページと Google Fonts は受け持つ',
        !resp('https://kiyotake1229.github.io/dandori-meijin/', 'navigate') && !resp('https://kiyotake1229.github.io/usotsuki-mura/index.html', 'navigate') && !resp('https://example.com/x.js') && resp(scope, 'navigate') && resp(scope + 'icon-192.png') &&
        resp('https://fonts.googleapis.com/css2?family=x') && resp('https://fonts.gstatic.com/s/x.woff2') && /cache: 'reload'/.test(swSrc) && /PAGE_TIMEOUT = 4000/.test(swSrc), '');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // サポートページ: 曜日の表・候補の範囲がエンジンの決まり（Engine.WEEK・SCOPES・BUDGET）と同じか・お問い合わせ先・canonical
  let sup = null; try { sup = fs.readFileSync(file('support.html'), 'utf8'); } catch (e) { sup = null; }
  if (!sup) check('support.html: ファイルがある', false, '');
  else {
    const stars = {};
    for (const m of sup.matchAll(/data-wd="(\d)" data-star="(\d)"/g)) stars[m[1]] = +m[2];
    const wbad = [0, 1, 2, 3, 4, 5, 6].filter((wd) => stars[wd] !== Engine.WEEK[wd]);
    const scope = {}, budget = {};
    for (const m of sup.matchAll(/data-scope="(\d)">(\d+)</g)) scope[m[1]] = +m[2];
    for (const m of sup.matchAll(/data-budget="(\d)">(\d+)</g)) budget[m[1]] = +m[2];
    const sbad = [1, 2, 3].filter((k) => scope[k] !== Engine.SCOPES[k].size || budget[k] !== Engine.BUDGET[k]);
    check('support.html: 曜日の表（難しさ）と、★ごとの候補の数・調べる上限がエンジンの決まり（Engine.WEEK・SCOPES・BUDGET）と同じ', Object.keys(stars).length === 7 && wbad.length === 0 && sbad.length === 0, wbad.concat(sbad).join(' '));
    const p1 = Engine.DAY1.split('-').map(Number);
    check('support.html: canonical・お問い合わせ（GitHub の Issues）・プライバシーポリシー・通知・iOS アプリ版は準備中・No.1 の日付',
      sup.includes('<link rel="canonical" href="' + SITE + 'support.html">') && sup.includes('https://github.com/kiyotake1229/hosoku-hunter/issues') && /id="privacy"/.test(sup) && /id="notice"/.test(sup) && /id="contact"/.test(sup) &&
      /個人情報を集めません/.test(sup) && /今日のルールが届きました/.test(sup) && /iOS アプリ版は準備中です/.test(sup) && sup.includes('No.1（' + p1[0] + '年' + p1[1] + '月' + p1[2] + '日）'), '');
    const sloads = [...sup.matchAll(/\bsrc\s*=\s*["'](https?:[^"']+)/g)].map((m) => m[1])
      .concat([...sup.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/rel="canonical"/.test(t)).map((t) => (/href\s*=\s*["'](https?:[^"']+)/.exec(t) || [])[1]).filter(Boolean))
      .concat([...sup.matchAll(/l\.href = '(https?:[^']+)'/g)].map((m) => m[1]));
    const google = (u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u);
    const semoji = [...sup].filter((ch) => /\p{Extended_Pictographic}/u.test(ch) && !'★☆©®'.includes(ch));
    check('support.html: 外から読み込むのは Google Fonts だけ・絵文字なし・ライト/ダークのトークン・動きを減らす設定', sloads.length > 0 && sloads.every(google) && semoji.length === 0 &&
      /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/.test(sup) && /:root\[data-theme="dark"\]\{/.test(sup) && /body\{[^}]*background-color:var\(--bg\)/.test(sup) && /@media \(prefers-reduced-motion: reduce\)/.test(sup), sloads.filter((u) => !google(u)).join(' ') + [...new Set(semoji)].join(''));
  }
}

/* ---------- ソース ---------- */
{
  const ui = SRC.slice(SRC.indexOf('// ==ENGINE END=='));
  const code = ui.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('alert・confirm・prompt を使わない（確かめは画面の中で）', !/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(code), '');
  // 読み込むもの（src・<link> の href（canonical を除く）・書体の読み込み）は Google Fonts だけ。
  // 移動するだけのリンク（canonical・<a href>）と、書いてあるだけの URL（OGP の meta・SITE_URL）は公開の場所（GitHub Pages）だけ（#0004）
  const SITE = 'https://kiyotake1229.github.io/hosoku-hunter/';
  const google = (u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u);
  const loads = [...SRC.matchAll(/\bsrc\s*=\s*["'](https?:[^"']+)/g)].map((m) => m[1])
    .concat([...SRC.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/rel="canonical"/.test(t)).map((t) => (/href\s*=\s*["'](https?:[^"']+)/.exec(t) || [])[1]).filter(Boolean))
    .concat([...SRC.matchAll(/l\.href = '(https?:[^']+)'/g)].map((m) => m[1]));
  const urls = [...SRC.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u));
  check('外から読み込むのは Google Fonts だけ（ほかに書いてある URL は公開の場所だけ。canonical・OGP・SITE_URL）',
    loads.length > 0 && loads.every(google) && urls.every((u) => google(u) || u.startsWith(SITE)) && lineOf('const SITE_URL = ').includes("'" + SITE + "'"), loads.filter((u) => !google(u)).concat(urls.filter((u) => !google(u) && !u.startsWith(SITE))).join(' '));
  check('画面: download のリンクは出さない（Artifact の iframe・iOS アプリでは効かない。出すなら NATIVE・FRAMED で外す）',
    ui.split('\n').filter((l) => /\bdownload\s*=/.test(l)).every((l) => /FRAMED/.test(l) && /NATIVE/.test(l)), '');
  const fonts = (/family=([^'"]+)/.exec(SRC) || [])[1] || '';
  check('書体: Google Fonts（Inter・Space Grotesk は使わない）', fonts && !/Inter|Space\+Grotesk/.test(fonts) && !/font-family:[^;]*(Inter|Space Grotesk)/.test(SRC), fonts);
  const css = (/<style>([\s\S]*?)<\/style>/.exec(SRC) || [])[1] || '';
  const toks = (block) => { const m = {}; for (const x of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) m[x[1]] = x[2].trim(); return m; };
  const rootB = (/:root\{([\s\S]*?)\n\}/.exec(css) || [])[1] || '';
  const darkA = (/:root:not\(\[data-theme="light"\]\)\{([\s\S]*?)\n  \}/.exec(css) || [])[1] || '';
  const darkB = (/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/.exec(css) || [])[1] || '';
  const TR = toks(rootB), TA = toks(darkA), TB = toks(darkB);
  const missing = Object.keys(TA).filter((k) => !(k in TR));
  const diff = Object.keys(TA).filter((k) => TA[k] !== TB[k]).concat(Object.keys(TB).filter((k) => !(k in TA)));
  check('テーマ: 色のトークンは :root にすべてあり、ダーク（端末の設定・手動）の2か所は同じ値', Object.keys(TR).length > 30 && Object.keys(TA).length > 20 && missing.length === 0 && diff.length === 0 && /body\{[^}]*background-color:var\(--bg\)/.test(css), missing.concat(diff).join(' '));
  check('テーマ: 設定のスイッチのつまみはダークでも地と見分けられる（--knob・--knob-on）・color-scheme もアプリの設定に合わせる', 'knob' in Object.fromEntries(Object.keys(TA).map((k) => [k.slice(2), 1])) && /background:var\(--knob\)/.test(css) && /background:var\(--knob-on\)/.test(css) && /colorScheme = scheme/.test(fnSrc('applyTheme')) && /id="metaScheme"/.test(SRC), '');
  check('動き: prefers-reduced-motion で動きを止める（発見の演出も出さない。メーターは減ったあとの数で描く）', /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*\.burst\{display:none\}/.test(css) && /reduceMotion\(\)/.test(fnSrc('ask')) && /!reduceMotion\(\)/.test(fnSrc('renderPlay')), '');
  const emoji = [...SRC].filter((ch) => /\p{Extended_Pictographic}/u.test(ch) && !'★☆©®'.includes(ch));
  check('絵文字を使わない（アイコンはインライン SVG）', emoji.length === 0, [...new Set(emoji)].join(' '));
  check('色の見分け: カードの青は斜線・緑は点の模様（色が分からなくても区別できる）', /<pattern id="pt-blue"/.test(SRC) && /<pattern id="pt-green"/.test(SRC) && /\.sh-blue\{fill:url\(#pt-blue\)/.test(css) && /\.sh-green\{fill:url\(#pt-green\)/.test(css), '');
  check('Artifact: iframe の中（FRAMED）ではコピーの返事を待ちすぎず、手でコピーする欄を出す（遅れて来た返事では二重に出さない）。localStorage・履歴が使えなくても止まらない', /const FRAMED = /.test(SRC) && /if \(FRAMED\)/.test(fnSrc('copyFn')) && /if \(settled\) return;/.test(fnSrc('copyFn')) && /histOK = false/.test(SRC) && /storeOK = false/.test(SRC), '');
  check('スマホ: 下の帯は safe-area を足す・調査の画面の下の余白は帯の高さ（--bar-h）・中央 480px の列・横にはみ出さない', /\.bar\{[^}]*env\(safe-area-inset-bottom\)/.test(css) && /body\[data-view="play"\] #app\{padding-bottom:calc\(var\(--bar-h/.test(css) && /#app\{max-width:480px/.test(css) && /overflow-x:hidden/.test(css), '');
  check('読み込み直し: 前のスクロール位置に戻さない（history.scrollRestoration）', /history\.scrollRestoration = 'manual'/.test(SRC), '');
  check('効果音: 画面が裏にあるときは鳴らさず、使い終わったら音の仕組みを止める', /if \(!S\.settings\.sound \|\| document\.hidden\) return;/.test(fnSrc('sfx')) && /document\.hidden/.test(fnSrc('ensureAudio')) && /AC\.suspend/.test(fnSrc('audioIdle')), '');
  check('目印（ENGINE・NATIVE・DAYRULES・STORE・VIEW）は1回ずつ', ['ENGINE START', 'ENGINE END', 'NATIVE START', 'NATIVE END', 'DAYRULES START', 'DAYRULES END', 'STORE START', 'STORE END', 'VIEW START', 'VIEW END'].every((k) => SRC.split('// ==' + k + '==').length === 2), '');
  check('保存のキーは hosoku.v1・すべて try/catch', ST.KEY === 'hosoku.v1' && /try \{ raw = localStorage\.getItem\(KEY\); \} catch/.test(SRC), '');
  check('文書: <!doctype html> と <title>法則ハンター</title>・lang="ja"', /^<!doctype html>/i.test(SRC) && SRC.includes('<title>法則ハンター</title>') && SRC.includes('<html lang="ja">'), '');
}

let fail = 0;
console.log('検査対象: ' + target + '\n');
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` + (r.ok || r.detail === '' || r.detail == null ? '' : '\n        ' + r.detail));
}
console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${results.length}項目`);
if (FAIL_OUT) fs.writeFileSync(FAIL_OUT, JSON.stringify(results.filter((r) => !r.ok).map((r) => r.name)));

/* ---------- わざとバグを入れた写し（--mutants） ----------
 * index.html を1か所ずつ書き換えた写しを一時フォルダに作り、この検査にかける。狙った検査項目が FAIL すれば「見つけた」。 */
let miss = false;
if (RUN_MUTANTS) {
  const M = [
    ['まだ調べていないカードの○×を、作ったカードの読み上げに入れる', [["front = cardHTML(card, { cls: 'pop' });", "front = cardHTML(card, { cls: 'pop', label: Engine.test(P.pz, card) ? '合う' : '合わない' });"]], '答え: 答えだけが違う'],
    ['最善手のカードの文を隠した要素に入れる', [["else msg = '<p class=\"bench-msg\">［調べる］で答えがめくれる。</p>';", "else msg = '<p class=\"bench-msg\">［調べる］で答えがめくれる。</p><p hidden>' + esc(Engine.cardText(P.pz.stats.bestCards[P.obs.length] || {})) + '</p>';"]], '答え: 答えだけが違う'],
    ['最善手の流れ（path）を title に入れる', [["'<section class=\"meter\" aria-label=\"候補メーター\">'", "'<section class=\"meter\" aria-label=\"候補メーター\" title=\"' + P.pz.stats.path.join('→') + '\">'"]], '答え: 答えだけが違う'],
    ['判定のボタンの名前に答えの印を混ぜる', [["const b = (v) => '<button type=\"button\" aria-label=\"' + (v ? '合う' : '合わない') + '\"", "const b = (v) => '<button type=\"button\" aria-label=\"' + (v ? '合う' : '合わない') + (Engine.test(P.pz, card) === v ? '　' : '') + '\""]], '答え: 答えだけが違う'],
    ['判定の5枚を、候補が2つ以上でも答えのルールで選ぶ（VERSION 2）', [['const chosen = C.length >= 2 ? judgeOpen(C, free, key) : judgeOne(t, known, free);', 'const chosen = judgeOne(t, known, free);']], '答え: 答えだけが違う'],
    ['連続を、あとから埋まった日の先へつながない（0〜3時に今日→昨日の順で切れる）', [['    while (solvedOn(daily, Engine.addDays(end, 1)) && len < 100000) { end = Engine.addDays(end, 1); len++; }\n', '']], '連続'],
    ['別のタブで解決した練習の途中を書き戻す（二重に数える）', [['if (old && old.seed === P.seed && (old.state === \'done\' || aheadOf(old, base))) return;', 'if (false) return;']], '別のタブ: 同じ練習'],
    ['別のタブが判定に進んだ記録を、調べる途中のタブで消す', [['if (aheadOf(old, base)) return;', 'if (false) return;']], '別のタブ: 別のタブが判定'],
    ['第2話で、最初から「×になるカードも試そう」を出す', [['main = ep === 2 ? (flatSeen(P) ? L.ask : L.first) : (P.obs.length ? L.ask : L.first);', 'main = L.ask;']], 'はじめての調査 第2話'],
    ['判定中もメーターに「調べる あとN回」を出す', [["const right = P.phase === 'judge'", 'const right = false']], 'メーター: 判定中'],
    ['読み上げで句点を重ねる', [["return /[。！？]$/.test(s) ? s : s + '。';", "return s + '。';"]], '読み上げ: 文をつなぐ'],
    ['これまでの平均を推移（60件）からだけ出す', [['    s.stats.powerN = (s.stats.powerN || 0) + 1;\n', '']], '調査力'],
    ['コピー文で難しさと結果の★を書き分けない', [["const head = P.mode === 'daily' ? '法則ハンター No.' + P.no + '（難しさ★' + pz.star + '）' : '法則ハンター 練習（難しさ★' + pz.star + '）';", "const head = P.mode === 'daily' ? '法則ハンター No.' + P.no + '（' + '★'.repeat(pz.star) + '☆'.repeat(3 - pz.star) + '）' : '法則ハンター 練習（' + '★'.repeat(pz.star) + '☆'.repeat(3 - pz.star) + '）';"]], 'コピー文'],
    ['予想のボタンを台に戻し、下の帯に置かない', [["return { cls: 'bar-in', html: guide + guess + '<button", "return { cls: 'bar-in', html: guide + '<button"]], '帯: 予想'],
    // #0004 ネイティブ連携と PWA
    ['起動の「空なら保存」が、Preferences を読み終える前にも書く', [['  function persistIfEmpty() {\n    if (restoring) return;\n', '  function persistIfEmpty() {\n']], '二重の保存（起動の順）'],
    ['Preferences を読み終える前にも Preferences に書く', [['if (!pf || restoring || newerStore) return;', 'if (!pf || newerStore) return;']], '二重の保存（起動の順）'],
    ['開いたときに空だったか（blankAtStart）を見ずに、新しいほうだけで決める', [['if (fromPf && (!fromLs || blankAtStart || fromPf.t > fromLs.t))', 'if (fromPf && (!fromLs || fromPf.t > fromLs.t))']], '二重の保存（起動の順）: 開いたとき'],
    ['iframe（Artifact）の中でも Service Worker を登録する', [['      if (NATIVE || FRAMED) return;\n      if (!/^https?:$/', '      if (NATIVE) return;\n      if (!/^https?:$/']], 'Service Worker: iOS アプリ・iframe'],
    ['判定が外れたときの触覚を軽い impact にする', [["wrong: ['notification', { type: 'WARNING' }]", "wrong: ['impact', { style: 'LIGHT' }]"]], '触覚: iOS アプリでは Haptics'],
    ['iOS アプリが裏に回っても振動する（away を見ない）', [['if (!S.settings.haptics || document.hidden || away) return;', 'if (!S.settings.haptics || document.hidden) return;']], '触覚: iOS アプリが裏に回っている'],
    ['予約し直すたびに通知の許可を求める', [['try { perm = await ln.checkPermissions(); } catch (e) { perm = null; }', 'try { perm = await ln.requestPermissions(); } catch (e) { perm = null; }']], '通知: 予約し直すときは'],
    ['通知の本文に答えのルールを書く', [["'通り）。カードに隠れたルールを見抜こう。'", "'通り）。' + Engine.ruleById(cfg.ruleId).text + '？'"]], '通知: 通知の題と本文に'],
    ['Web でも毎朝の通知の行を出す', [["const noti = plug('LocalNotifications')\n      ?", "const noti = true\n      ?"]], '設定: 毎朝の通知の行'],
    ['コピー文の最後の公開 URL を外す', [['    lines.push(SITE_URL);   // 最後に遊べる場所（一般公開の URL）\n', '']], 'コピー文: 決まった形'],
    ['状態バーの色を当てない', [["const sb = plug('StatusBar');", 'const sb = null;']], '状態バー: 画面の色に'],
    ['iframe の中でも manifest と apple-touch-icon を置く', [["try { if (window.self !== window.top || window.origin === 'null') return; } catch (e) { return; }", 'try { } catch (e) { return; }']], '<head>: manifest と apple-touch-icon'],
    ['sw.js: activate でほかのアプリのキャッシュまで消す', [['.filter((n) => n.startsWith(PREFIX) && !keep.includes(n))', '.filter((n) => !keep.includes(n))']], 'sw.js: 古いキャッシュ', 'sw.js'],
    ['sw.js: 消された分だけでなく、毎回全部を取り直す', [['    if (await cache.match(u)) return;\n', '']], 'sw.js: ほかのアプリにキャッシュを消されたら', 'sw.js'],
    ['sw.js: 同じドメインのほかのアプリの読み込みも受け持つ', [['  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;\n', '']], 'sw.js: 同じドメインのほかのアプリ', 'sw.js'],
  ];
  // 写しのフォルダに、index.html と一緒に検査する素材（manifest・sw.js・画像・サポートページ）を置く（sw.js の写しはそこを書き換える）
  const ASSETS = ['manifest.json', 'sw.js', 'support.html', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'ogp.png', 'ios-app/assets/icon.png'];
  const srcDir = path.dirname(target);
  const SRC0 = fs.readFileSync(target, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosoku-app-mutants-'));
  console.log('\nわざとバグを入れた写しの検査（' + M.length + '種）:');
  try {
    M.forEach((m, k) => {
      const which = m[3] || 'index.html';
      let src = which === 'index.html' ? SRC0 : fs.readFileSync(path.join(srcDir, which), 'utf8');
      for (const [from, to] of m[1]) { const n = src.split(from).length - 1; if (n !== 1) { console.log('  SKIP    ' + m[0] + '（書き換える場所が ' + n + ' か所）'); miss = true; return; } src = src.replace(from, to); }
      const sub = path.join(dir, 'm' + k);
      for (const f of ASSETS) { if (fs.existsSync(path.join(srcDir, f))) { fs.mkdirSync(path.dirname(path.join(sub, f)), { recursive: true }); fs.copyFileSync(path.join(srcDir, f), path.join(sub, f)); } }
      const file = path.join(sub, 'index.html'), out = path.join(dir, 'fail' + k + '.json');
      fs.writeFileSync(file, which === 'index.html' ? src : SRC0);
      if (which !== 'index.html') fs.writeFileSync(path.join(sub, which), src);
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), file, '--fail-out', out], { stdio: 'ignore' });
      let failed = []; try { failed = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { failed = ['（結果なし）']; }
      const hit = r.status === 1 && failed.some((f) => f.startsWith(m[2]));
      if (!hit) miss = true;
      console.log('  ' + (hit ? '見つけた' : '見逃した') + '  ' + m[0] + '  → FAIL ' + failed.length + '項目（' + failed.slice(0, 2).map((x) => x.slice(0, 40)).join(' / ') + '）');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(miss ? '  見逃した写しがある（検査を強くする）' : '  すべての写しで、狙った検査項目が FAIL を出した');
}
process.exit(fail || miss ? 1 : 0);
