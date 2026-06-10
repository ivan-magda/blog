#!/usr/bin/env bash
# Compress WWDC session slide screenshots IN PLACE, preserving PNG format and the
# original filenames. Strategy: downscale only (never upscale) + palette-quantize,
# stepping the width down until each file clears the 200 KB ceiling. Aims for the
# 100-200 KB band; simple/low-detail slides land below 100 KB and are left there
# (padding them up would mean upscaling — bytes without detail).
#
# Usage: compress-screenshots.sh <screenshots-dir>
# Requires: ImageMagick (magick) + pngquant. macOS `stat -f%z` (BSD).
set -euo pipefail

DIR="${1:?usage: compress-screenshots.sh <screenshots-dir>}"
command -v magick   >/dev/null || { echo "need ImageMagick (brew install imagemagick)"; exit 1; }
command -v pngquant >/dev/null || { echo "need pngquant (brew install pngquant)";      exit 1; }

MAX=204800   # 200 KB ceiling
cd "$DIR"
shopt -s nullglob
shot=( *.png )
[ ${#shot[@]} -gt 0 ] || { echo "no PNGs in $DIR"; exit 0; }

for f in "${shot[@]}"; do
  best=""; bestsize=0
  for w in 1600 1400 1200 1100 1000 900 800 700; do
    tmp="/tmp/wwdcshot-$$-${w}.png"
    magick "$f" -resize "${w}x>" "$tmp"                       # ">" = shrink only
    pngquant --quality=55-90 --strip --force --output "$tmp" -- "$tmp"
    bestsize=$(stat -f%z "$tmp"); best="$tmp"
    [ "$bestsize" -le "$MAX" ] && break
  done
  mv "$best" "$f"
  printf '%7d KB  %s\n' $((bestsize/1024)) "$f"
done
echo "--- total ---"; du -sh .
