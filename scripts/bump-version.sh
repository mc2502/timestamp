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

# 공개 버전과 업데이트 노트를 먼저 기록해야 배포 번호를 올릴 수 있다.
node scripts/check-release.mjs --next-build "$next"

# 아이콘 · manifest 주소에도 붙인다: 아이폰은 같은 주소의 홈 화면 아이콘을 오래 기억해서, 주소가 바뀌어야 새 그림을 받는다
sed -i '' -E "s/\?v=[0-9]+/?v=$next/g" index.html js/app.js js/stamp.js manifest.webmanifest
sed -i '' -E "s/^const VERSION = '[0-9]+';/const VERSION = '$next';/" sw.js
sed -i '' -E "s/^const APP_BUILD = '[0-9]+';/const APP_BUILD = '$next';/" js/app.js

echo "내부 배포 번호 $cur → $next"
grep -n "?v=$next\|VERSION = '$next'" index.html js/app.js js/stamp.js manifest.webmanifest sw.js
