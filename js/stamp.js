// 정사각형 사진에 찍는 스탬프
//
//  ┌───────────────────────────┐
//  │              TimeStamp ◷  │  ← 오른쪽 위 로고
//  │                           │
//  │                           │
//  │ 2026년 11월 23일 (월)       │  ← 왼쪽 아래, 흰 글씨
//  │ 오전 7:46                  │
//  │                           │
//  └───────────────────────────┘
//
// 모든 값은 1080px 정사각형 기준이고, 실제 크기에 비율로 맞춘다.

import { fmtLongDate, fmtClock } from './format.js?v=5';

const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

const L = {
  left: 58, // 글씨 왼쪽 여백
  lastBaseline: 928, // 둘째 줄(시각) 기준선
  lineGap: 66, // 두 줄 사이
  size: 50, // 날짜·시각 글자 크기
  weight: 600,
  logoRight: 86, // 로고 오른쪽 여백
  logoTop: 84, // 로고 위 여백
  logoSize: 33, // 로고 글자 크기
  clockR: 17.5, // 시계 반지름
  clockGap: 10, // 글자와 시계 사이
};

const SHADOW = 'rgba(0, 0, 0, 0.42)';

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

// pop: 스탬프 효과용 { scale, alpha } — 글씨 덩어리마다 제자리에서 커졌다 작아진다
export function drawStamp(ctx, side, date, { logo = true, pop = null } = {}) {
  const u = side / 1080;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 1.5 * u;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (pop) ctx.globalAlpha = pop.alpha;

  ctx.save();
  if (pop) scaleAround(ctx, pop.scale, L.left * u, (L.lastBaseline - L.lineGap / 2 - L.size * 0.35) * u);
  ctx.font = `${L.weight} ${L.size * u}px ${FONT}`;
  setSpacing(ctx, -0.01 * L.size * u);
  ctx.fillText(fmtLongDate(date), L.left * u, (L.lastBaseline - L.lineGap) * u);
  ctx.fillText(fmtClock(date), L.left * u, L.lastBaseline * u);
  setSpacing(ctx, 0);
  ctx.restore();

  if (logo) drawLogo(ctx, side, u, pop);
  ctx.restore();
}

function scaleAround(ctx, s, x, y) {
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(-x, -y);
}

function drawLogo(ctx, side, u, pop) {
  const r = L.clockR * u;
  const cx = side - L.logoRight * u - r;
  const cy = L.logoTop * u + r;
  if (pop) scaleAround(ctx, pop.scale, cx, cy);

  ctx.font = `700 ${L.logoSize * u}px ${FONT}`;
  setSpacing(ctx, -0.01 * L.logoSize * u);
  const text = 'TimeStamp';
  const tw = ctx.measureText(text).width;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx - r - L.clockGap * u - tw, cy + 1 * u);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.55);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + r * 0.42, cy + r * 0.32);
  ctx.stroke();
}
