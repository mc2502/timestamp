#!/bin/sh
# 배포 전에 한 번 실행한다: 파일 주소의 ?v= 숫자와 앱·서비스 워커 버전을 함께 1 올린다.
# 아이폰이 예전 파일과 새 파일을 섞어 쓰지 않게 하려는 것이다.
set -eu
cd "$(dirname "$0")/.."

cur=$(sed -n "s/^const VERSION = '\([0-9][0-9]*\)';/\1/p" sw.js)
if [ -z "$cur" ]; then
  echo "sw.js 에서 VERSION 을 찾지 못했어요" >&2
  exit 1
fi
next=$((cur + 1))

sed -i '' -E "s/\?v=[0-9]+/?v=$next/g" index.html js/app.js js/stamp.js
sed -i '' -E "s/^const VERSION = '[0-9]+';/const VERSION = '$next';/" sw.js
sed -i '' -E "s/^const APP_VERSION = '[0-9]+';/const APP_VERSION = '$next';/" js/app.js

echo "버전 $cur → $next"
grep -n "?v=$next\|VERSION = '$next'" index.html js/app.js js/stamp.js sw.js
