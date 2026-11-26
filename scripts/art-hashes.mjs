// 배포할 때 bump-version.sh가 실행한다: assets/ 그림마다 내용 지문을 sw.js의 ART_HASH에 적는다.
// 서비스 워커는 지문이 같은 그림은 다시 받지 않고, 같은 이름으로 다시 그린 그림만 새로 받는다.
// (GitHub Pages의 ETag는 배포 때마다 모든 파일이 바뀌어서 그림이 바뀌었는지 알려 주지 못한다)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'assets'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((p) => p && !p.startsWith('assets/icons/')) // 아이콘은 ?v= 주소로 매번 새로 받는다
  .sort();

const lines = [];
for (const path of files) {
  let data;
  try { data = readFileSync(new URL(`../${path}`, import.meta.url)); } catch { continue; } // 지운 파일
  lines.push(`  '${path}': '${createHash('sha256').update(data).digest('hex').slice(0, 12)}',`);
}

const swPath = new URL('../sw.js', import.meta.url);
const sw = readFileSync(swPath, 'utf8');
const block = /const ART_HASH = \{[\s\S]*?\n\};/;
if (!block.test(sw)) {
  console.error('sw.js 에서 ART_HASH 를 찾지 못했어요');
  process.exit(1);
}
writeFileSync(swPath, sw.replace(block, `const ART_HASH = {\n${lines.join('\n')}\n};`));
console.log(`그림 지문 ${lines.length}개`);
