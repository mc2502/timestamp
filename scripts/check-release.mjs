import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASES } from '../js/releases.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const compare = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};

try {
  assert.ok(RELEASES.length, '업데이트 노트가 비어 있어요');
  for (const [i, release] of RELEASES.entries()) {
    assert.match(release.version, semver, '버전은 1.0.0 형식으로 적어 주세요');
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이에요');
    assert.equal(new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10), release.date, '날짜를 확인해 주세요');
    assert.match(release.time ?? '', /^([01]\d|2[0-3]):[0-5]\d$/, '시간은 24시간 HH:MM 형식이에요 (배포 스크립트가 맨 위 항목을 채워요)');
    assert.ok(Number.isSafeInteger(release.build) && release.build > 0, '내부 배포 번호가 필요해요');
    assert.ok(typeof release.title === 'string' && release.title.trim(), '업데이트 제목을 적어 주세요');
    assert.ok(Array.isArray(release.changes) && release.changes.length && release.changes.every(s => typeof s === 'string' && s.trim()), '변경 내용을 한 가지 이상 적어 주세요');
    if (i) {
      assert.ok(compare(RELEASES[i - 1].version, release.version) > 0, '최신 버전을 맨 위에 적고, 이전 버전보다 높여 주세요');
      assert.ok(RELEASES[i - 1].build > release.build, '내부 배포 번호는 최신 항목이 더 커야 해요');
    }
  }
  const next = process.argv[2] === '--next-build' ? Number(process.argv[3]) : null;
  const build = Number(/const VERSION = '(\d+)'/.exec(source('sw.js'))?.[1]);
  assert.equal(RELEASES[0].build, next ?? build, `js/releases.js에 ${next ?? build}번 배포의 업데이트 노트를 먼저 추가해 주세요`);
  if (next !== null) {
    assert.equal(next, build + 1, '다음 배포 번호를 확인해 주세요');
    let previous;
    try { previous = execFileSync('git', ['show', 'HEAD:js/releases.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* 첫 정식 버전 */ }
    const versionPattern = /['"]?version['"]?\s*:\s*['"]([^'"]+)['"]/g;
    const history = [...(previous || '').matchAll(versionPattern)].map(match => match[1]);
    const oldVersion = history[0];
    // 여러 버전을 하나로 합치기로 한 배포만 RELEASE_MERGE=1 로 아래 두 검사를 건너뛴다 (2026-11-26: 1.0.2–1.0.6 → 1.0.2)
    const merging = process.env.RELEASE_MERGE === '1';
    if (merging) console.log(`버전 합치기: ${oldVersion} → ${RELEASES[0].version} (이전 노트 확인 건너뜀)`);
    if (oldVersion && !merging) assert.ok(compare(RELEASES[0].version, oldVersion) > 0, `현재 ${oldVersion} 다음 버전을 새 항목으로 기록해 주세요`);
    if (!merging) assert.ok(history.every(version => RELEASES.some(release => release.version === version)), '이전 업데이트 노트도 지우지 않고 남겨 주세요');
  } else {
    assert.equal(Number(/const APP_BUILD = '(\d+)'/.exec(source('js/app.js'))?.[1]), build, '앱과 서비스 워커의 내부 번호가 달라요');
  }
  console.log(`업데이트 노트 확인: ${RELEASES[0].version} · ${RELEASES[0].date}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
