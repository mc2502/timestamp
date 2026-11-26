// bump-version.sh가 실행한다: 업데이트 노트 맨 위 항목의 날짜·시간을 지금 한국 시각으로 채운다.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../js/releases.js', import.meta.url);
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date()).map((p) => [p.type, p.value]));
const date = `${parts.year}-${parts.month}-${parts.day}`;
const time = `${parts.hour}:${parts.minute}`;
const source = readFileSync(path, 'utf8');
// 정규식에 g가 없어서 첫 번째(맨 위) 항목만 바뀐다
const next = source.replace(/date: '\d{4}-\d{2}-\d{2}'/, `date: '${date}'`).replace(/time: '\d{2}:\d{2}'/, `time: '${time}'`);
writeFileSync(path, next);
console.log(`업데이트 노트 시각: ${date} ${time}`);
