#!/usr/bin/env python3
"""アイコンと OGP 画像を元データから書き出す（法則ハンター）。

  python3 tools/make-images.py          # 両方
  python3 tools/make-images.py icons    # アイコンだけ（iOS の起動画面の元も作り直す）
  python3 tools/make-images.py ogp      # OGP 画像だけ
  python3 tools/make-images.py splash   # iOS の起動画面の元だけ（ios-app/assets/icon.png から）

元データ → 出力
  icon.svg       → icon-512.png / icon-192.png / apple-touch-icon.png(180) / ios-app/assets/icon.png(1024)
                 → ios-app/assets/splash.png / splash-dark.png（2732×2732。角を丸めたアイコンを地の色の真ん中に）
  tools/ogp.html → ogp.png（1200×630）
iOS アプリに入れるときは、このあと ios-app/ で npm run icons を実行する。

必要なもの: Google Chrome（画面なしモードで描く）、Python 3 と Pillow（縮小・透明なしへの変換）、
OGP の書体を読むための通信（Google Fonts の Klee One・M PLUS 2・Courier Prime）。
アイコンは書体を使わないので、通信が無くても書き出せる。
アイコンは 1024px で1回だけ描き、縮小して各サイズを作る。どの画像も透明なし（RGB）。
作業用のファイル（Chrome のプロファイル・描く HTML）は一時フォルダに作り、終わったら消す（このフォルダには残さない）。
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
TIMEOUT = 90   # Chrome を待つ最長の秒数。これを過ぎたら止めて、失敗として終わる

# アイコンを描くための HTML。icon.svg をそのまま埋め込む（書体は使わないので、すぐ見せてよい）
ICON_PAGE = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:#FF00FF}
svg{display:block;width:1024px;height:1024px}</style></head><body>%SVG%</body></html>"""


def shoot(html_path, out_png, w, h):
    """Chrome の画面なしモードで html_path を w×h で撮る。

    環境によっては撮り終えても Chrome が終わらないので、
    「bytes written to file」が出たら（または TIMEOUT 秒たったら）こちらで終わらせる。
    """
    prof = tempfile.mkdtemp(prefix='hosoku-chrome-')
    proc = subprocess.Popen([
        CHROME, '--headless=new', '--mute-audio', '--hide-scrollbars',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        '--force-device-scale-factor=1', '--force-color-profile=srgb',
        '--user-data-dir=' + prof, '--window-size=%d,%d' % (w, h),
        '--virtual-time-budget=10000', '--screenshot=' + out_png,
        'file://' + html_path,
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    done = threading.Event()

    def watch():
        for line in proc.stdout:
            if b'bytes written to file' in line:
                done.set()
        done.set()
    threading.Thread(target=watch, daemon=True).start()
    try:
        finished = done.wait(TIMEOUT)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        shutil.rmtree(prof, ignore_errors=True)
    if not finished:
        sys.exit('Chrome が %d 秒以内に終わりませんでした: %s' % (TIMEOUT, html_path))
    if not os.path.exists(out_png):
        sys.exit('Chrome で画像を撮れませんでした: ' + html_path)
    im = Image.open(out_png).convert('RGB')
    if im.size != (w, h):
        sys.exit('撮った画像の大きさが違います: %s（期待 %dx%d）' % (im.size, w, h))
    return im


def is_magenta(px):
    r, g, b = px
    return r > 240 and g < 20 and b > 240


def count(im, box, test):
    """box の中で test(r, g, b) を満たす画素の数"""
    return sum(n for n, (r, g, b) in im.crop(box).getcolors(1024 * 1024) if test(r, g, b))


def render_icon():
    """icon.svg を 1024px で描いて検査し、Pillow の画像で返す（書き出しはしない）"""
    with open(os.path.join(ROOT, 'icon.svg'), encoding='utf-8') as f:
        svg = f.read()
    tmp = tempfile.mkdtemp(prefix='hosoku-icon-')
    try:
        page = os.path.join(tmp, 'icon.html')
        with open(page, 'w', encoding='utf-8') as f:
            f.write(ICON_PAGE.replace('%SVG%', svg))
        im = shoot(page, os.path.join(tmp, 'icon-1024.png'), 1024, 1024)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # 検査: 描けたか（下地の赤紫が出ていない）、カードの白・三角の青・丸の赤・虫眼鏡の黄が真ん中の安全域にあるか、四隅が地の色か
    if any(is_magenta(im.getpixel(xy)) for xy in ((4, 4), (512, 512), (1019, 1019))):
        sys.exit('icon.svg が描けていません（下地の赤紫が見えます）。icon.svg を確かめてください。')
    box = (150, 150, 874, 874)
    white = count(im, box, lambda r, g, b: r > 235 and g > 238 and b > 230)
    blue = count(im, box, lambda r, g, b: b > 160 and r < 110 and 70 < g < 150)
    red = count(im, box, lambda r, g, b: r > 180 and g < 90 and b < 80)
    yellow = count(im, box, lambda r, g, b: r > 220 and g > 190 and b < 110)
    if white < 60000 or blue < 8000 or red < 6000 or yellow < 20000:
        sys.exit('カードか虫眼鏡が描けていません（白 %d・青 %d・赤 %d・黄 %d）。icon.svg を確かめてください。' % (white, blue, red, yellow))
    for xy in ((4, 4), (1019, 4), (4, 1019), (1019, 1019)):
        r, g, b = im.getpixel(xy)
        if not (r < 60 and g < 70 and b < 65 and g >= r):
            sys.exit('四隅が地の色（暗い緑）になっていません: %s %s' % (xy, (r, g, b)))
    return im


def icons():
    im = render_icon()
    outs = [
        ('ios-app/assets/icon.png', 1024),
        ('icon-512.png', 512),
        ('icon-192.png', 192),
        ('apple-touch-icon.png', 180),
    ]
    for rel, size in outs:
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        out = im if size == 1024 else im.resize((size, size), Image.LANCZOS)
        out.save(path, 'PNG', optimize=True)
        print('書き出し: %s（%dx%d、透明なし）' % (rel, size, size))
    splash()


# iOS の起動画面（@capacitor/assets が splash.png / splash-dark.png から作る）。
# 画面いっぱいに縦横比を保って広げる（aspect fill）ので、2732px の正方形の真ん中に置いたアイコン 400px は、
# iPhone の縦の画面で約 110〜140pt になる。地の色はアプリの紙面（ライト #ECEFEA・ダーク #0F1513）と同じ
SPLASH = 2732
SPLASH_ICON = 400
SPLASH_BG = (('splash.png', (0xEC, 0xEF, 0xEA)), ('splash-dark.png', (0x0F, 0x15, 0x13)))


def splash():
    src = os.path.join(ROOT, 'ios-app', 'assets', 'icon.png')
    if not os.path.exists(src):
        sys.exit('先にアイコンを書き出してください（python3 tools/make-images.py icons）: ' + src)
    icon = Image.open(src).convert('RGB').resize((SPLASH_ICON, SPLASH_ICON), Image.LANCZOS)
    # 角丸（iOS のアイコンと同じくらいの丸み）。4倍の大きさで描いて縮め、縁をなめらかにする
    k = 4
    big = Image.new('L', (SPLASH_ICON * k, SPLASH_ICON * k), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, SPLASH_ICON * k - 1, SPLASH_ICON * k - 1), radius=int(SPLASH_ICON * 0.2237 * k), fill=255)
    mask = big.resize((SPLASH_ICON, SPLASH_ICON), Image.LANCZOS)
    at = ((SPLASH - SPLASH_ICON) // 2, (SPLASH - SPLASH_ICON) // 2)
    for name, bg in SPLASH_BG:
        im = Image.new('RGB', (SPLASH, SPLASH), bg)
        im.paste(icon, at, mask)
        if im.getpixel((4, 4)) != bg or im.getpixel((SPLASH // 2, SPLASH // 2)) == bg:
            sys.exit('起動画面の元を作れませんでした: ' + name)
        im.save(os.path.join(ROOT, 'ios-app', 'assets', name), 'PNG', optimize=True)
        print('書き出し: ios-app/assets/%s（%dx%d、透明なし）' % (name, SPLASH, SPLASH))


def ogp():
    page = os.path.join(ROOT, 'tools', 'ogp.html')
    tmp = tempfile.mkdtemp(prefix='hosoku-ogp-')
    try:
        im = shoot(page, os.path.join(tmp, 'ogp.png'), 1200, 630)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if is_magenta(im.getpixel((600, 315))):
        sys.exit('書体が読めませんでした。通信を確かめてやり直してください。')
    im.save(os.path.join(ROOT, 'ogp.png'), 'PNG', optimize=True)
    print('書き出し: ogp.png（1200x630、透明なし）')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what not in ('all', 'icons', 'ogp', 'splash'):
        sys.exit('使い方: python3 tools/make-images.py [icons|ogp|splash]')
    if what == 'splash':
        splash()
        sys.exit(0)
    if not os.path.exists(CHROME):
        sys.exit('Google Chrome が見つかりません: ' + CHROME + '（環境変数 CHROME で場所を指定できます）')
    if what in ('all', 'icons'):
        icons()
    if what in ('all', 'ogp'):
        ogp()
