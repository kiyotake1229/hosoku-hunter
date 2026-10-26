# 法則ハンター 開発ドキュメント管理ルール

このファイルは、docs/ フォルダにドキュメントを追加する際のルールを定めています。

ドキュメント一覧: docs/manager/docs.json

---

## 1. 命名規則

```
YYYYMMDD_種類_連番_場所_内容.拡張子
```

例: `20261020_DOC_0001_ALL_現状の仕様と構成.md`

- **YYYYMMDD**: 作成日
- **種類**: 案件の種類（下記参照）
- **連番**: 4桁の連番（0001〜9999）
- **場所**: 対象システム（下記参照）
- **内容**: 内容がわかる日本語名

---

## 2. 種類（Type）略語一覧

| 略語 | 意味 | 説明 |
|------|------|------|
| INQ | Inquiry | お問い合わせ対応・調査 |
| BUG | Bug Fix | バグ修正 |
| FIX | Fix | 軽微な修正 |
| NEW | New Feature | 新規開発 |
| ENH | Enhancement | 機能改善・拡張 |
| SEC | Security | セキュリティ対応 |
| DOC | Document | ドキュメント作成 |
| REF | Refactor | リファクタリング |
| DPL | Deploy | デプロイ関連 |
| RPT | Report | 報告書・見積書 |
| UPD | Update | 既存機能の更新 |

---

## 3. 場所（Category）略語一覧

| 略語 | 対象システム |
|------|-------------|
| ALL | プロジェクト全体 |
| APP | 画面（`index.html` のうちエンジン以外。HTML・CSS・画面の JavaScript・効果音・保存）と、その検査 `tools/check-app.mjs`・`tools/check-ui.mjs` |
| ENG | 推理エンジン・問題生成（`index.html` 内の `// ==ENGINE START==`〜`// ==ENGINE END==`）と、その検査 `tools/check-engine.mjs` |
| PWA | PWA と公開用の素材（`manifest.json`・`sw.js`・アイコン・`ogp.png`・`support.html`・`tools/make-images.py`・`tools/ogp.html`）と、`index.html` の Service Worker の登録 |
| IOS | iOSアプリ（`ios-app/`。Capacitor 7 のプロジェクト・スクリーンショット・引き渡し手順）とビルド確認（`.github/workflows/ios-build.yml`）、`index.html` のネイティブ連携（`// ==NATIVE START==`〜`END`・保存の二重化・通知・触覚・状態バー） |

ENG を変えて問題の作り方が変わる（同じ日付・同じ seed で別の問題になる）ときは、文書に「日替わりの問題が変わる」ことと、エンジンの `VERSION` を上げたことを必ず書く。

---

## 4. 連番管理

- 連番は全ドキュメント共通で管理（場所や種類で分けない）
- 関連案件は同じ連番を使用するか、ファイル内で関連番号を記載
- 次の連番は `docs/manager/docs.json` の `next_no` で確認

### docs.json の更新（重要）

ドキュメントを作成・編集した後は、必ず以下のコマンドを実行すること:

```bash
bash docs/manager/generate_docs_json.sh
```

---

## 5. ファイル配置

すべてのドキュメントは `docs/` 直下に配置する。サブフォルダは使用しない。

管理用ファイル:
- `docs/README.md` — このファイル（ルール説明）
- `docs/manager/` — 管理スクリプト・データ

---

## 6. 必須記載項目

### (1) ヘッダー情報
管理番号、種類、対象システム、作成日、関連案件

### (2) 概要
何についてのドキュメントか（1〜3文）

### (3) 対象ファイル
関連するソースコードファイルのパスを記載

### (4) 変更内容（変更の場合）
何をどう変更したか

### (5) 確認URL（動作確認が必要な場合）

| 環境 | URL |
|------|-----|
| ローカル | http://127.0.0.1:8795/ （`思考力/.claude/launch.json` の `hosoku`。このフォルダで `python3 -m http.server 8795 --bind 127.0.0.1` でもよい） |
| 開発確認用 | Claude Artifact（https://claude.ai/artifact/8WjqncLuFmwKUWvs8Yjr1c 。#0003 の版） |
| 本番 | GitHub Pages（https://kiyotake1229.github.io/hosoku-hunter/ ） |

### (6) 作業概要と概算費用（作業が発生する場合）

| 項目 | 内容 | 工数 |
|------|------|------|
| 調査 | ... | Xh |
| 実装 | ... | Xh |
| テスト | ... | Xh |
| 合計 | | Xh（Y人日） |

- 工数は時間（h）で書き、8h = 1人日で換算する
- 人日単価は未設定のため、金額は書かない

---

## 7. git について

2026-10-26 から git で管理している（GitHub の公開リポジトリ `kiyotake1229/hosoku-hunter`。main に push すると GitHub Pages に反映され、アプリに入るファイルや `ios-app/` を変えると GitHub Actions の「iOS build check」が動く）。親フォルダ `思考力/` のリポジトリ（嘘つき村）では、このフォルダを `.gitignore` で外してある。

- コミットメッセージ: `[#連番] 内容`（本文に変更ファイルの要約と関連ドキュメント）。文書が要らない変更（誤字・コメント・整形だけ）は `[no-doc] 内容`
- 文書を書いたら `bash docs/manager/generate_docs_json.sh` を実行してから、ソースと文書を一緒にコミットする
- `ios-app/node_modules/`・`ios-app/www/`・`ios-app/ios/App/Pods/` などは `.gitignore` で外してある（`npm install` / `npm run sync` で戻る）
- 公開サイトに出さないもの（`README.md`・`docs/`・`tools/`・`ios-app/`・`.claude/`）は `_config.yml` の `exclude` で外している。`.nojekyll` は置かない（置くと `exclude` が効かない）

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-10-20 | 初版作成（#0001 と同時） |
| 2026-10-21 | APP の検査に `tools/check-ui.mjs` を足した（#0003） |
| 2026-10-26 | PWA・IOS の対象を書き足した（#0004） |
| 2026-10-26 | 場所の IOS の説明を #0005（iOSアプリ化）に合わせ、確認URLと7章を git の決まりに書き換えた（リポジトリ `kiyotake1229/hosoku-hunter`） |
