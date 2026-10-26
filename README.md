# 法則ハンター

思考力フォルダの中にある別アプリ（親フォルダの `思考力/` は嘘つき村、隣の `段取り名人/` も別アプリ）。

色・形・数のカードに隠れた「ルール」を、自分でカードを作って試しながら見抜く仮説検証パズル。予想（○か×か）を決めてから調べ、予想が外れたら「発見」。調べるたびに「のこる候補」の数が減り、最後に5枚の判定テストに答えて解決する。毎日1問の「今日のルール」（全員同じ問題）、何問でも遊べる練習（★1〜★3）、初めての人向けの「はじめての調査」（案内つき3話）、記録帳、ルール図鑑。スマホ縦持ち・片手・1回2〜4分の単一HTMLアプリ。
問題はすべてプログラムがその場で作り、最善の調べ方なら上限の回数のうちに答えが1つに決まることを確かめてから出している。

## このあとの変更

- **#0002（2026-10-21）点数と判定と答えの集まりの見直し**: 答えの集まり＝候補メーターの範囲（★1 21・★2 99・★3 350）、候補が2つ以上のときの判定の5枚は答えを使わずに選ぶ、結果の★3 は「判定に進む前に候補を1つに絞った」ときだけ、調査力は判定に進んだときの残りも数える、日替わりを週ごとに並べる。エンジンを VERSION 3 に上げた（全員の問題が変わった）
- **#0003（2026-10-21）点検で見つかった不具合の修正**: 連続日数を記録から数え直す（0〜3時に今日→昨日の順でも切れない）、予想と［調べる］を下の帯へ（375×667 でスクロールなし）、はじめての調査の案内、ふり返りと調査力の書き方、別のタブ・裏に回ったときの音・iframe のコピー・焦点と読み上げなど。画面を実際に動かす検査 `tools/check-ui.mjs` を足した
- **#0004（2026-10-26）PWA化と公開用の素材とネイティブ連携**: アイコン・manifest・Service Worker（オフライン）・OGP 画像・サポートページを作った。iOS アプリ（Capacitor）のときだけ動く触覚・記録の二重保存（Preferences）・毎朝の通知・状態バーの色・裏に回ったときの停止を入れた（Web では何もしない）。結果のコピー文の最後に公開 URL、設定にサポートへのリンク。段取り名人の #0006 と同じ作り。エンジンは変えていない（VERSION 3 のまま）
- **#0005（2026-10-26）iOSアプリ化**: `ios-app/` に Capacitor 7 の iOS プロジェクト（Bundle ID `work.ltv.hosoku`・iPhone・縦向きのみ・5つのプラグイン・プライバシーマニフェスト）、App Store 用のスクリーンショット（3サイズ×6枚）、`岩崎さんへの引き渡し手順.md`。GitHub Actions のビルド確認（`.github/workflows/ios-build.yml`）、`.gitignore`、`_config.yml`。段取り名人の #0007 と同じ作り
- **#0006（2026-10-26）GitHub Pages で公開とビルド確認**: git のリポジトリ `kiyotake1229/hosoku-hunter` を作って GitHub Pages で一般公開。iOS のビルド（シミュレータ向け・実機向け）が GitHub Actions で通ることを確かめた

| 項目 | 内容 |
|------|------|
| 状態 | **GitHub Pages で一般公開した（2026-10-26 の #0006）。iOS アプリのプロジェクト・スクリーンショット・引き渡し手順もできた（#0005。ビルドは GitHub Actions で確認。App Store 申請はまだ）** |
| 本体 | `index.html`（約230KB・3,400行。画面・推理エンジン・SVG アイコンまで1ファイル） |
| ローカル確認 | http://127.0.0.1:8795/ （`思考力/.claude/launch.json` の `hosoku`。このフォルダで `python3 -m http.server 8795 --bind 127.0.0.1` でもよい） |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/8WjqncLuFmwKUWvs8Yjr1c （2026-10-22 公開。#0003 まで反映） |
| 一般公開（GitHub Pages） | https://kiyotake1229.github.io/hosoku-hunter/ （2026-10-26 公開） |
| サポートURL | https://kiyotake1229.github.io/hosoku-hunter/support.html （`support.html`。App Store のサポートURL・プライバシーポリシーは `#privacy`） |
| お問い合わせ | https://github.com/kiyotake1229/hosoku-hunter/issues |
| 通信 | 記録や操作の内容は外に送らない。外から読むのは Google Fonts の文字だけ（読めなくても端末の文字で表示される） |
| データ | 端末内のみ（localStorage のキー `hosoku.v1`。iOS アプリでは Preferences にも同じものを二重に保存） |
| Bundle ID | `work.ltv.hosoku`（iOS アプリ。`ios-app/`） |
| エンジンの版 | VERSION 3（版が変わると全員の問題が変わる） |
| git | https://github.com/kiyotake1229/hosoku-hunter （public。main に push すると GitHub Pages に反映。親の `思考力/` のリポジトリでは `.gitignore` で外してある） |
| iOS ビルド確認 | GitHub Actions の「iOS build check」（https://github.com/kiyotake1229/hosoku-hunter/actions ） |

## フォルダの中身

| パス | 中身 |
|---|---|
| `index.html` | アプリ本体 |
| `manifest.json` / `sw.js` | PWA の設定 / Service Worker（オフライン用のキャッシュ。名前は `hosoku-` で始まる） |
| `icon.svg` / `icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | アイコンの元データと PNG（`python3 tools/make-images.py icons` で書き出す） |
| `ogp.png` | リンクを貼ったときのプレビュー画像（1200×630。元は `tools/ogp.html`） |
| `support.html` | サポートページ兼プライバシーポリシー（App Store のサポートURL） |
| `ios-app/` | iOS アプリ（Capacitor 7）。`ios/`（Xcode プロジェクト）・`assets/`（アイコンと起動画面の元）・`screenshots/`（App Store 用）・`README.md`・**`岩崎さんへの引き渡し手順.md`**（ビルド・申請の手順と申請情報の下書き）。`node_modules/`・`ios/App/Pods/`・`www/` は置かない（`npm install` / `npm run sync` で戻る） |
| `.github/workflows/ios-build.yml` | iOS のビルド確認（GitHub Actions・macos-26・Xcode 26。シミュレータ向けと実機向け（署名なし）） |
| `_config.yml` / `.gitignore` | GitHub Pages に載せないもの（`README.md`・`docs/`・`tools/`・`ios-app/`・`.claude/`） / git に入れないもの |
| `tools/make-images.py` / `tools/ogp.html` | アイコン・OGP 画像の書き出しの道具 / OGP 画像の元データ |
| `tools/check-engine.mjs` | エンジンの検査（`node tools/check-engine.mjs index.html`。95項目。約10〜30秒。`--mutants` でわざとバグを入れた写し25種も） |
| `tools/check-app.mjs` | 日付・連続日数・保存・図鑑・はじめての調査・別のタブ・答えが漏れないか（答えだけが違う問題で同じ画面になるか）・ソースの決まり・ネイティブ連携（偽の Capacitor）・Service Worker の登録・sw.js・manifest・画像・サポートページの検査（`node tools/check-app.mjs index.html`。154項目。数秒。`--mutants` で写し29種も） |
| `tools/check-ui.mjs` | 画面を実際に動かす検査（Chrome の画面なしモードを DevTools Protocol で操作。`node tools/check-ui.mjs index.html`。34項目。約2〜3分。Chrome が要る。`--mutants` で写し11種も・約15分） |
| `docs/` | 開発ドキュメント（ルールは [docs/README.md](docs/README.md)、一覧は `docs/manager/docs.json`） |
| `.claude/` | ローカル確認のサーバ設定・文書と検査の決まり（`rules/documentation.md`） |

## 開発ドキュメント

| 番号 | 文書 |
|---|---|
| #0001 | [現状の仕様と構成](docs/20261020_DOC_0001_ALL_現状の仕様と構成.md)（遊びの決まり・エンジン・画面・保存・検査） |
| #0002 | [点数と判定と答えの集まりの見直し](docs/20261021_ENH_0002_ENG_点数と判定と答えの集まりの見直し.md)（VERSION 3） |
| #0003 | [点検で見つかった不具合の修正](docs/20261021_BUG_0003_ALL_点検で見つかった不具合の修正.md)（直したもの・見送ったもの・check-ui） |
| #0004 | [PWA化と公開用の素材とネイティブ連携](docs/20261026_NEW_0004_ALL_PWA化と公開用の素材とネイティブ連携.md)（アイコン・manifest・sw.js・OGP・サポートページ・使う Capacitor プラグイン） |
| #0005 | [iOSアプリ化](docs/20261026_NEW_0005_IOS_iOSアプリ化.md)（Capacitor 7・Info.plist・プライバシーマニフェスト・ビルド確認・スクリーンショット・引き渡し手順） |
| #0006 | [GitHub Pages で公開とビルド確認](docs/20261026_DPL_0006_ALL_GitHubPagesで公開とビルド確認.md)（リポジトリ・Pages の設定・公開サイトの確認・iOS ビルドの結果） |

機能追加・バグ修正・改善をしたら、1件ごとに文書を足して `bash docs/manager/generate_docs_json.sh` を実行する。

## 残作業

1. スマホ実機で遊んで確かめる（音・振動・片手での操作・判定の難しさ）。公開 URL を iPhone の Safari でホーム画面に追加・Android の Chrome でインストール・オフラインで開けるか、SNS に URL を貼ったときのプレビュー画像
2. iOS アプリをシミュレータ・実機で確かめる（通知・触覚・記録の二重保存・起動画面・状態バーの色）。App Store 申請は岩崎さんが `ios-app/岩崎さんへの引き渡し手順.md` に沿って行う
3. 清武さんが決めること（引き渡し手順の冒頭）: 岩崎さんの Mac の macOS ごとの Xcode、問い合わせ用のメールアドレス（決まったら `support.html` に足す。それまで申請しない）、EU の trader の申告と App Review の連絡先
4. App Store に出たら、`support.html` の「iOS アプリ版は準備中です」を直す
5. Claude Artifact（#0003 の版）を最新の版で公開し直す
6. UIScene への対応（Capacitor 7 の雛形のまま。Xcode 27 でビルドする前、2027年4月ごろまでに。段取り名人・嘘つき村と同じ）
