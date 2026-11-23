// 사진 위에 찍히는 스탬프: PT Note 유리 카드 + 마스코트 얼굴 + 식사 · 시각 · 날짜
//
//  ┌──────────────────────────┐
//  │ (얼굴)  점심              │
//  │         12:34            │
//  │         2026.11.23 (월)  │
//  └──────────────────────────┘
//
// 모든 크기는 402pt 화면 기준 단위에 배율 s를 곱한다. 배율은 사진의 짧은 변에 비례해서
// 미리보기와 저장본의 비율이 같다.

import { fmtDate, fmtTime, weekday, mealLabel } from './format.js';

const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

const COLOR = {
  card: 'rgba(255,255,255,0.92)',
  edge: 'rgba(109,134,164,0.18)',
  shadow: 'rgba(29,54,86,0.2)',
  ink: '#191f28',
  ink2: '#4e5968',
  blueInk: '#1b64da',
  sat: '#1b64da',
  sun: '#d4253e',
};

const L = {
  padX: 14, padY: 12, face: 50, gap: 11, radius: 20,
  meal: 13, mealLH: 17,
  time: 34, timeLH: 36,
  date: 14, dateLH: 18,
  mealGap: 1, dateGap: 2,
  margin: 16, minMargin: 6,
};

const REF = 402;
const SCALE = 0.8;

export function stampScale(width, height) {
  return (Math.min(width, height) / REF) * SCALE;
}

const font = (weight, px) => `${weight} ${px}px ${FONT}`;

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function texts(info) {
  const d = info.date;
  const day = d.getDay();
  return {
    meal: info.meal ? mealLabel(info.meal) : null,
    time: fmtTime(d),
    date: `${fmtDate(d)} `,
    weekday: `(${weekday(d)})`,
    weekdayColor: day === 0 ? COLOR.sun : day === 6 ? COLOR.sat : COLOR.ink2,
  };
}

export function measureStamp(ctx, info, s) {
  const t = texts(info);
  ctx.save();
  ctx.font = font(800, L.time * s);
  setSpacing(ctx, -0.03 * L.time * s);
  const timeW = ctx.measureText(t.time).width;
  setSpacing(ctx, 0);
  ctx.font = font(600, L.date * s);
  const dateW = ctx.measureText(t.date + t.weekday).width;
  let mealW = 0;
  if (t.meal) {
    ctx.font = font(700, L.meal * s);
    mealW = ctx.measureText(t.meal).width;
  }
  ctx.restore();

  const textW = Math.max(timeW, dateW, mealW);
  const textH = ((t.meal ? L.mealLH + L.mealGap : 0) + L.timeLH + L.dateGap + L.dateLH) * s;
  const faceW = info.face ? (L.face + L.gap) * s : 0;
  const innerH = Math.max(textH, info.face ? L.face * s : 0);
  return {
    w: L.padX * 2 * s + faceW + textW + 2 * s,
    h: L.padY * 2 * s + innerH,
    textH,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawStamp(ctx, info, x, y, s, size = measureStamp(ctx, info, s)) {
  const t = texts(info);
  ctx.save();

  ctx.shadowColor = COLOR.shadow;
  ctx.shadowBlur = 16 * s;
  ctx.shadowOffsetY = 4 * s;
  roundRect(ctx, x, y, size.w, size.h, L.radius * s);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeStyle = COLOR.edge;
  ctx.stroke();

  let tx = x + L.padX * s;
  if (info.face) {
    const f = L.face * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(info.face, tx, y + (size.h - f) / 2, f, f);
    tx += (L.face + L.gap) * s;
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let ty = y + (size.h - size.textH) / 2;

  if (t.meal) {
    ctx.font = font(700, L.meal * s);
    ctx.fillStyle = COLOR.blueInk;
    ctx.fillText(t.meal, tx, ty + (L.mealLH * s) / 2);
    ty += (L.mealLH + L.mealGap) * s;
  }

  ctx.font = font(800, L.time * s);
  setSpacing(ctx, -0.03 * L.time * s);
  ctx.fillStyle = COLOR.ink;
  ctx.fillText(t.time, tx - 1 * s, ty + (L.timeLH * s) / 2 + 1 * s);
  setSpacing(ctx, 0);
  ty += (L.timeLH + L.dateGap) * s;

  ctx.font = font(600, L.date * s);
  ctx.fillStyle = COLOR.ink2;
  const dateY = ty + (L.dateLH * s) / 2;
  ctx.fillText(t.date, tx, dateY);
  const dateW = ctx.measureText(t.date).width;
  ctx.fillStyle = t.weekdayColor;
  ctx.fillText(t.weekday, tx + dateW, dateY);

  ctx.restore();
}

// pos: { corner: 'tl'|'tr'|'bl'|'br' } 또는 { fx, fy } (스탬프 왼쪽 위, 사진 크기에 대한 비율)
export function resolvePos(pos, width, height, size, s) {
  const m = L.margin * s;
  const min = L.minMargin * s;
  let x;
  let y;
  if (pos && pos.corner) {
    x = pos.corner.endsWith('l') ? m : width - size.w - m;
    y = pos.corner.startsWith('t') ? m : height - size.h - m;
  } else {
    x = (pos?.fx ?? 0) * width;
    y = (pos?.fy ?? 0) * height;
  }
  x = Math.min(Math.max(x, min), Math.max(min, width - size.w - min));
  y = Math.min(Math.max(y, min), Math.max(min, height - size.h - min));
  return { x, y };
}

// 스탬프가 음식을 덜 가리도록 네 모서리 중 가장 단조로운 곳을 고른다.
const BIAS = { br: 0.92, bl: 0.97, tr: 1, tl: 1.03 };

export function pickCorner(source, info) {
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) return 'br';
  const aw = 128;
  const ah = Math.max(1, Math.round((aw * sh) / sw));
  const c = document.createElement('canvas');
  c.width = aw;
  c.height = ah;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, aw, ah);
  let data;
  try {
    data = ctx.getImageData(0, 0, aw, ah).data;
  } catch {
    return 'br';
  }
  const lum = new Float32Array(aw * ah);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  }

  const s = stampScale(aw, ah);
  const size = measureStamp(ctx, info, s);
  let best = 'br';
  let bestScore = Infinity;
  for (const corner of ['br', 'bl', 'tr', 'tl']) {
    const p = resolvePos({ corner }, aw, ah, size, s);
    const score = busyness(lum, aw, ah, p.x, p.y, size.w, size.h) * BIAS[corner];
    if (score < bestScore) {
      bestScore = score;
      best = corner;
    }
  }
  c.width = c.height = 1;
  return best;
}

function busyness(lum, w, h, x, y, rw, rh) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, Math.ceil(x + rw));
  const y1 = Math.min(h - 1, Math.ceil(y + rh));
  let n = 0;
  let sum = 0;
  let sq = 0;
  let grad = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const v = lum[yy * w + xx];
      sum += v;
      sq += v * v;
      grad += Math.abs(v - lum[yy * w + xx + 1]) + Math.abs(v - lum[(yy + 1) * w + xx]);
      n++;
    }
  }
  if (!n) return Infinity;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return sd + 2 * (grad / n);
}
