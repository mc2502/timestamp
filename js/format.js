// 날짜·시간 표기와 식사 구분. 스탬프 표기: 2026년 11월 23일 (월) / 오전 7:46

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const pad2 = (n) => String(n).padStart(2, '0');

export const weekday = (d) => WEEKDAYS[d.getDay()];
export const fmtLongDate = (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday(d)})`;

// 아이폰과 같은 12시간제: 오전 12:05, 오전 7:46, 오후 12:30
export function fmtClock(d) {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}:${pad2(d.getMinutes())}`;
}
export const monthDay = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday(d)})`;

export const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const fileStamp = (d) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;

export function relDay(d, now = new Date()) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const n = Math.round((b - a) / 864e5);
  if (n === 0) return '오늘';
  if (n === 1) return '어제';
  if (n > 1) return `${n}일 전`;
  return '';
}

export const MEALS = [
  ['breakfast', '아침'],
  ['lunch', '점심'],
  ['dinner', '저녁'],
  ['snack', '간식'],
];

export const mealLabel = (id) => (MEALS.find((m) => m[0] === id) || [])[1] || null;

// 시간대로 고르는 기본값. 사용자가 바꾸면 그 값을 따른다.
export function mealFor(d) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

export const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(+d) ? null : d;
}

// 알림 문장이 어색한 곳에서 줄바꿈되지 않게, 함께 읽어야 하는 말 사이의 띄어쓰기를 줄바꿈 없는 공백으로 바꾼다.
// (낱말 중간은 CSS word-break: keep-all이 막는다) 줄바꿈(\n)은 그대로 둔다.
const NB = '\u00a0';
const GROUPED = /(^|[ \u00a0(])(찍힌|다른|이미|기존|백업|앨범|촬영|지금|다시|아래) (?=\S)/g;
export function keepPhrases(text) {
  if (!text) return text;
  return String(text)
    // 날짜·시각: 2026년 11월 1일 · 7월 7일 오후 4:39 · 오후 3시부터 · 1일 전 · 3 / 10장
    .replace(/(\d+(?:년|월|일)) (?=\d)/g, `$1${NB}`)
    .replace(/(\d+일) (?=오전|오후|전|후|부터)/g, `$1${NB}`)
    .replace(/(오전|오후) (?=\d)/g, `$1${NB}`)
    .replace(/(\d+) \/ (?=\d)/g, `$1${NB}/${NB}`)
    // 괄호 앞은 띄어쓰기가 없어도 줄을 바꿀 수 있게: 11월 1일 전 / (7월 7일 오후 4:39)에
    .replace(/([가-힣])\(/g, '$1\u200b(')
    // 닫는 괄호와 뒤 조사는 붙인다: (오전 9:05)에
    .replace(/\)(?=[가-힣])/g, ')\u2060')
    // 앞말에 붙어 읽는 말: 남길 수 없어요 · 준비 중 · 할 때 · 시도해 주세요
    .replace(/ (?=(?:수|중|때|뒤|것|줄|뿐)(?: |$|[.,]))/g, NB)
    .replace(/ (?=주세요)/g, NB)
    // 한 덩어리로 읽는 말: 찍힌 사진 · 다른 날 · 이미 있는 · 백업 파일 · 앨범 저장 · 촬영 시각 · 다시 눌러 · 아래 버튼
    // (이어진 묶음 '다른 백업 파일'까지 잡도록 두 번)
    .replace(GROUPED, `$1$2${NB}`)
    .replace(GROUPED, `$1$2${NB}`)
    // 한 글자 낱말은 뒷말과 함께: 한 번 더 눌러 · 위 버튼 · 수 있어요 ('확인한 뒤'의 뒤는 앞말에만)
    .replace(/(^|[ \u00a0(])((?!뒤)[가-힣]) (?=\S)/g, (_, pre, w) => `${pre}${w}${NB}`)
    .replace(/(^|[ \u00a0(])((?!뒤)[가-힣]) (?=\S)/g, (_, pre, w) => `${pre}${w}${NB}`);
}
