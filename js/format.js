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
