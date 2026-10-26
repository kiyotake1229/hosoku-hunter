# GitHub Pages で公開とビルド確認

- 管理番号: #0006
- 種類: DPL（デプロイ）
- 対象: ALL（全体）
- 作成日: 2026-10-26
- 関連: #0004（PWA化と公開用の素材）、#0005（iOSアプリ化・`_config.yml`・ビルド確認のワークフロー）。手本は段取り名人の #0008（GitHub Pages で公開とビルド確認）

## 概要

このフォルダを git リポジトリにして GitHub の公開リポジトリ `kiyotake1229/hosoku-hunter` に push し、main ブランチのルートを GitHub Pages で公開した（清武さんの依頼）。あわせて GitHub Actions の「iOS build check」で、iOS アプリがシミュレータ向け・実機向け（署名なし）ともにビルドできることを確かめた。

## 対象ファイル

- フォルダ全体（`.gitignore` の対象を除く）。公開サイトに出すのは `index.html`・`manifest.json`・`sw.js`・`icon.svg`・`icon-192.png`・`icon-512.png`・`apple-touch-icon.png`・`ogp.png`・`support.html`
- `_config.yml`（#0005）で `README.md`・`docs/`・`ios-app/`・`tools/`・`.claude/` を公開サイトから外している（`.github/` と `.gitignore` などの点で始まるものは Jekyll がもともと出さない）

## 変更内容

### 1. リポジトリ

- `git init -b main` で始め、最初のコミット「[#0005] 初版を GitHub Pages で公開（#0001〜#0004 を含む）」（`987b718`。77ファイル）を push した
- リポジトリ: https://github.com/kiyotake1229/hosoku-hunter （public。説明「法則ハンター — カードに隠れたルールを、カードを作って試しながら見抜く毎日1問の仮説検証パズル」。兄弟アプリ dandori-meijin・usotsuki-mura と同じ形）
- App Store 用スクリーンショット（約4.8MB）があるので、push の前にこのリポジトリだけ `git config http.postBuffer 524288000` を設定した（段取り名人と同じ）。1回で push できた
- 親フォルダ `思考力/` のリポジトリ（嘘つき村）には触れていない（このフォルダは親の `.gitignore` で外してあり、親の `git status` も変わらない）
- push の前に、秘密の情報（トークン・鍵・パスワード）、メールアドレス、手元の絶対パス、作業用のファイル（`node_modules`・`www`・`Pods`・`public`・ログ・Chrome のプロファイル）が入っていないことを確かめた

### 2. GitHub Pages

- 設定: ブランチ `main`・フォルダ `/`（`gh api -X POST repos/kiyotake1229/hosoku-hunter/pages`）。https は強制
- `.nojekyll` は置かない（置くと `_config.yml` の `exclude` が効かず、`docs/` なども公開サイトで開けてしまう）
- 「pages build and deployment」: 成功 https://github.com/kiyotake1229/hosoku-hunter/actions/runs/40334503209

### 3. iOS ビルド確認（GitHub Actions）

- ワークフロー: `.github/workflows/ios-build.yml`（#0005）
- 結果: **1回目で成功**。https://github.com/kiyotake1229/hosoku-hunter/actions/runs/40334489457 （約3分）
  - ランナー `macos-26-arm64`（イメージ 20261013.0424.1）。「Select Xcode 26」は「既定の Xcode 26.6 を使う」（Build version 17F113）
  - `npm ci`（225 パッケージ）→ `npm run sync-web` → `npx cap sync ios`（pod install）→ 構成の確認 → シミュレータ向け Debug ビルド `** BUILD SUCCEEDED **` → 実機向け Release ビルド（署名なし）`** BUILD SUCCEEDED **` → アプリの中身の確認（表示名「法則ハンター」・Bundle ID `work.ltv.hosoku`・iPhone 専用・`index.html` など6つの Web 資産（と Capacitor の `cordova.js`・`cordova_plugins.js`）・`sw.js` なし・`PrivacyInfo.xcprivacy`・Capacitor と5プラグインの6つのフレームワーク）
  - ビルドの警告は2種類だけ（AppIntents が無いので抜き出しを飛ばした、Pods の「Embed Pods Frameworks」が毎回動く）。どちらも Capacitor の雛形で出るもので、動作には関係ない（段取り名人と同じ）
- 注意（動作には影響なし）: 「Node.js 20 の actions（checkout@v4・setup-node@v4）は Node.js 24 で動かす」「macOS arm64 のランナーは混んでいて待つことがある」という知らせが出ている。「pages build and deployment」には「ubuntu-latest は 2026-10-19 から Ubuntu 26 に移る」という知らせ（GitHub が用意するワークフローなので、こちらで直すものはない）

## 確認

- 公開サイト（curl）: `/`・`index.html`・`manifest.json`・`sw.js`・`icon.svg`・`icon-192.png`・`icon-512.png`・`apple-touch-icon.png`・`ogp.png`・`support.html` が 200。`README.md`・`docs/README.md`・`docs/manager/docs.json`・`tools/check-engine.mjs`・`tools/make-images.py`・`ios-app/README.md`・`ios-app/package.json`・`ios-app/screenshots/README.md`・`.claude/launch.json`・`_config.yml`・`.github/workflows/ios-build.yml`・`.gitignore` は 404（公開サイトに出ていない）
- 公開サイトの `index.html`・`sw.js`・`support.html`・`manifest.json`・`icon.svg`・PNG 5つ（アイコン4つと `ogp.png`）は、手元のファイルと同じ中身（SHA-256 が一致。Jekyll で書き換わっていない）
- 画面なしの Chrome を DevTools Protocol で動かし、公開 URL をスマホの幅（375×812・拡大率3倍）で開いた（ページを開くたびに、操作の前にミュートのスクリプトを流した。`mute-armed`、調べる画面で `__muteReport` の intercepted 1）
  - ホームに今日のルール No.7（10月26日（月）・★1「色と形のルール21通りから探す。調べるのは3回まで」）と［調査を始める］が出る。横スクロールなし（scrollWidth 375）
  - `<head>` に manifest と apple-touch-icon が置かれる。manifest を読める（`Page.getAppManifest` のエラー0）
  - Service Worker が `https://kiyotake1229.github.io/hosoku-hunter/` の範囲で activated。読み込み直すとページを受け持つ。キャッシュ `hosoku-app-v1` に先にキャッシュする7件
  - ［調査を始める］で調査の画面が開き、「今日のルール」・のこる候補5通りが出る
  - コンソールのエラー・警告 0件
  - 確かめたあと、記録・Service Worker の登録・キャッシュを消し、作業用の Chrome のプロファイルも消した
- `node tools/check-app.mjs index.html`: PASS 154項目。`node tools/check-engine.mjs index.html`: PASS 95項目（10.8秒。load average 3.5 前後）。`node tools/check-ui.mjs index.html`: PASS 34項目（159秒）
- `index.html` とエンジンは変えていないので、問題は変わらない（VERSION 3 のまま）

**まだ確かめていないこと**: スマホ実機（iPhone Safari・Android Chrome でのホーム画面に追加・オフライン）、SNS に URL を貼ったときのプレビュー画像、iOS のシミュレータ・実機での動作と App Store 申請

## 確認URL

| 環境 | URL |
|------|-----|
| ローカル | http://127.0.0.1:8795/ （このフォルダで `python3 -m http.server 8795 --bind 127.0.0.1`） |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/8WjqncLuFmwKUWvs8Yjr1c （#0003 の版） |
| 本番（GitHub Pages） | https://kiyotake1229.github.io/hosoku-hunter/ |
| サポート（App Store 用） | https://kiyotake1229.github.io/hosoku-hunter/support.html |
| リポジトリ | https://github.com/kiyotake1229/hosoku-hunter |
| Pages の公開 | https://github.com/kiyotake1229/hosoku-hunter/actions/runs/40334503209 |
| iOS ビルド確認 | https://github.com/kiyotake1229/hosoku-hunter/actions/runs/40334489457 |

## 作業概要と概算費用

| 項目 | 内容 | 工数 |
|------|------|------|
| 準備 | 公開してよい中身の確認（秘密情報・作業用ファイル・`.gitignore`・`_config.yml`） | 0.2h |
| 公開 | リポジトリ作成・push・Pages の設定 | 0.2h |
| 確認 | 公開サイトの応答と中身、画面なしの Chrome での表示・Service Worker、iOS ビルドの結果とログ、検査3つ | 0.6h |
| 文書 | この文書、README・#0001・#0005・docs/README.md・documentation.md の更新 | 0.5h |
| 合計 | | 1.5h（約0.2人日） |

人日単価が未設定のため金額は書かない。外部費用なし（GitHub の無料の範囲）。
