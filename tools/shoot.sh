#!/bin/sh
# Captures the three screenshots from a built dashboard with headless Chrome at 1440x900.
# Chrome runs on a throwaway profile directory that is removed afterwards, never a personal profile.
#
#   tools/shoot.sh <built dashboard dir> <directory to write the PNGs into>
set -eu
dash=$(cd "$1" && pwd)
dest=$2
chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
mkdir -p "$dest"

shoot() { # <file name> <hash>
  "$chrome" --headless=new --user-data-dir="$profile" --no-first-run --disable-extensions --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1440,900 --virtual-time-budget=3000 \
    --screenshot="$dest/$1" "file://$dash/index.html$2" >/dev/null 2>&1
  echo "$1 $(wc -c < "$dest/$1" | tr -d ' ') bytes"
}

shoot 1-board.png ''
# The defaults are the views the committed screenshots show.
shoot 2-detail.png "#p=${DETAIL_SLUG:-onre}"
shoot 3-filtered.png "#${FILTER_HASH:-cat=Risk+Curators&wl=1}"
