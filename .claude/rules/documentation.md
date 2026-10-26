# ドキュメント管理・検査の規則（法則ハンター）

## 開発完了後の自動ドキュメント作成（重要）

**コード変更を伴う開発タスクを完了したら、ユーザーの指示を待たずに自動的にドキュメント作成を開始すること。**

### 判定フロー

1. 開発タスク（コード変更）が完了した
2. 変更種類を判定する:
   - NEW / BUG / ENH / SEC → **必ずドキュメントを作成**（ユーザーに確認不要）
   - FIX → 推奨（簡潔でよい）
   - タイポ修正・コメントのみ → スキップ（`[no-doc]` でコミット）
3. ドキュメント作成 → `generate_docs_json.sh` 実行
4. 完了をユーザーに報告

### 自動作成の手順

1. `docs/manager/docs.json` の `next_no` を確認して連番を取得
2. 命名規則に従いファイル作成: `YYYYMMDD_種類_連番_場所_内容.md`（`docs/` 直下）
3. `docs/README.md` の必須記載項目（6章）に従い内容を記述
4. `docs/manager/generate_docs_json.sh` を実行

## ドキュメント管理

docsフォルダにドキュメントを追加・修正する際は、必ず先に `docs/README.md` のルールを確認すること。

- 命名規則: `YYYYMMDD_種類_連番_場所_内容.md`
- 場所: ALL（全体）/ APP（画面）/ ENG（推理エンジン・問題生成。`index.html` 内）/ PWA（manifest・sw.js・アイコン・OGP・support.html）/ IOS（`ios-app/`・`.github/workflows/ios-build.yml` とネイティブ連携）
- 次の連番: `docs/manager/docs.json` の `next_no` を参照
- アプリ全体の現状は `docs/20261020_DOC_0001_ALL_現状の仕様と構成.md`。最初にこれを読む

### docs.json の更新（重要）

**`docs/*.md` ファイルを作成・編集した後は、必ず以下のコマンドを実行すること:**

```bash
bash docs/manager/generate_docs_json.sh
```

## このアプリでの注意

- 本体は `index.html` の1ファイルだけ。エンジンは `// ==ENGINE START==`〜`// ==ENGINE END==` の間にある（別ファイルで作ったら、ここに入れ直す。ロジックは変えずにそのまま貼る）
- エンジン（ENG）を変えたら、文書を書く前に `node tools/check-engine.mjs index.html` を実行し、PASS を確かめる。結果（項目数・秒数）を文書の「確認」に書く
- 問題の作り方が変わる変更（ルールの表・候補の範囲・答えの集まり・調べる上限・例の2枚の選び方・公平さの条件・判定の5枚の選び方・結果の★と調査力の決まり・言い回し・はじめての調査の案内・日替わりの並べ方）は、全員の日替わり・練習の問題を変える。エンジンの `VERSION` を上げ、`tools/check-engine.mjs` の `GOLDEN` に新しい版の値を足し、そのことを文書に必ず書く。回帰ハッシュ（日替わり365日・練習120問・はじめての調査3問と遊び方の例）のどれかが FAIL したら、問題が変わったということ
- 日付・連続日数（`// ==DAYRULES START==`〜`END`）、保存（`// ==STORE START==`〜`END`）、調査・判定の画面・下の帯・案内とコピー文（`// ==VIEW START==`〜`END`）を変えたら、`node tools/check-app.mjs index.html` を実行し、PASS を確かめる
- 画面の操作・見た目（下の帯・焦点・読み上げ・効果音・別のタブ・幅）を変えたら、`node tools/check-ui.mjs index.html`（Chrome の画面なしモード。約2〜3分）も PASS を確かめる。検査を強くしたときは `--mutants`（check-app・check-ui・check-engine とも）で、わざとバグを入れた写しが FAIL することも確かめる
- 連続日数は日替わりの記録（その日のうちに解決した日 `solvedOnDay`）から数え直す（`recountStreak`・`shownStreak`）。`stats.streak` はその控え
- **答えのルール（問題の `ruleId`・`ruleText`・`stats.path`・`stats.bestCards`）は、解決するまで画面・読み上げ・コピー文・途中の保存に出さない。** 出してよいのは結果の画面・解決した日の記録帳とホーム・ルール図鑑だけ。`check-app` が解決前の画面とコピー文に答えの文が混ざらないかを確かめる
- 判定の5枚の答え（○×）も、答え合わせの前は DOM に書かない（`data-ok` のような属性も置かない）。候補が2つ以上のときの5枚は、答えを使わずに選ぶ（どの候補が答えでも同じ5枚）
- `check-app` は、答えだけが違う同じ形の問題（候補に残っている別のルール）で、解決する前の画面の HTML が同じになるかを比べる。画面に答えにつながるもの（まだ調べていないカードの○×・最善手・path）を足すと FAIL する
- 保存のキーは `hosoku.v1`。読み込みは1件ずつ検査し、1件読めなくても全部は消さない。別のタブで「記録を消す」をしたときは `epoch` で途中の書き戻しを防ぐ（段取り名人・嘘つき村と同じ考え方）
- ネイティブ連携（`// ==NATIVE START==`〜`END`・Preferences への二重保存と戻す順・毎朝の通知・触覚・状態バー・裏に回ったとき）や PWA の素材（`manifest.json`・`sw.js`・アイコン・`support.html`）を変えたら、`node tools/check-app.mjs index.html` を実行し、PASS を確かめる（偽の Capacitor・偽の Service Worker で動かして確かめる。#0004）。Web では Capacitor の機能はどれも何もしないこと、iOS アプリ・iframe（Artifact）では Service Worker を登録しないことを崩さない
- **通知の題と本文に答えのルールを書かない**（ロック画面に出る）。`check-app` が60日分で確かめる
- `manifest.json`・アイコン・`sw.js` の先にキャッシュするファイルの一覧を変えたら、`sw.js` の `VERSION` を上げる。キャッシュの名前は `hosoku-` で始め、activate で消すのも `hosoku-` で始まるものだけ（同じ github.io の兄弟アプリのキャッシュに触らない）。アイコンと OGP 画像は元データ（`icon.svg`・`tools/ogp.html`）を直して `python3 tools/make-images.py` で書き出す。OGP に答えのルールの文を描かない
- 遊びの決まり（曜日の★・候補の範囲・調べる上限）を変えたら、`support.html` の説明も直す（曜日の表・候補の数・上限は `check-app` が `Engine.WEEK`・`SCOPES`・`BUDGET` と突き合わせる）
- ブラウザで確かめるときは、ページを開いたら何もクリックする前に `アプリ開発/_テンプレート/動作チェックのミュート手順.md` のスクリプトを流す（読み込み直すたびに流し直す）。確かめたあとは localStorage の記録（`hosoku.v1`）を消す
- 作業用・実験用のファイルはこのフォルダに残さない（Dropbox で共有されている）。一時ファイルは作業用の場所に置く

## git

2026-10-26 から git で管理している（GitHub の公開リポジトリ `kiyotake1229/hosoku-hunter`。push すると GitHub Pages（https://kiyotake1229.github.io/hosoku-hunter/ ）に反映される。親の `思考力/` リポジトリでは `.gitignore` で外してある。親のリポジトリには何もしない）。

- 手順: 実装 → 文書 → `bash docs/manager/generate_docs_json.sh` → ソースと文書を一緒に `git add` → コミット → push
- アプリに入るファイル（`index.html`・`manifest.json`・アイコン）や `ios-app/` を変えて push すると、GitHub Actions の「iOS build check」が動く。ログに `** BUILD SUCCEEDED **`（シミュレータ向け・実機向け）が出て成功することを確かめる
- iOS アプリ（`ios-app/`）を触ったあとは `rm -rf ios-app/node_modules ios-app/ios/App/Pods ios-app/www` で消す（Dropbox の同期が重くなるため。`npm install` / `npm run sync` で戻る）。作業は Dropbox の外の作業用フォルダで行い、できたファイルだけを写してもよい（#0005）
- 公開サイトに出さないもの（`README.md`・`docs/`・`tools/`・`ios-app/`・`.claude/`）は `_config.yml` の `exclude` で外している。`.nojekyll` は置かない（置くと `exclude` が効かない）。リポジトリそのものは public なので、github.com の画面では読める。秘密の情報・手元だけのファイルはコミットしない

### コミット前チェックリスト

| 変更種類 | ドキュメント | 必須度 |
|----------|-------------|--------|
| 新機能追加 (NEW) | 必須 | ◎ |
| バグ修正 (BUG) | 必須 | ◎ |
| 機能改善 (ENH) | 必須 | ◎ |
| セキュリティ対応 (SEC) | 必須 | ◎ |
| 軽微な修正 (FIX) | 推奨 | ○ |
| リファクタリング (REF) | 状況による | △ |

### コミットメッセージ規則

```
[#連番] 変更内容の要約

- 変更ファイル一覧
- 関連ドキュメント: docs/YYYYMMDD_TYPE_NNNN_CAT_タイトル.md
```

ドキュメント不要の場合:
```
[no-doc] タイポ修正: path/to/file
```

### ドキュメント不要の例外ケース

- タイポ修正
- コメントの追加・修正のみ
- コードフォーマットの調整のみ
- 開発環境のみに影響する変更
