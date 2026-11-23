// 정사각형 사진에 찍는 스탬프 6종. 로고는 넣지 않는다.
// 모든 값은 1080px 정사각형 기준 단위(u)이고, 실제 크기에 비율로 맞춘다.
//
//  basic   기본     왼쪽 아래 두 줄: 2026년 11월 23일 (월) / 오전 7:46
//  big     크게     가운데 큰 시각, 아래 한 줄 날짜
//  film    필름     오른쪽 아래 주황 디지털 숫자 '26 11 23  7:46
//  meal    식단     왼쪽 위 끼니 라벨 + 시각 + 날짜
//  capsule 캡슐     왼쪽 아래 반투명 둥근 바탕 위 한 줄
//  mascot  마스코트 왼쪽 아래 오둥이·퍼펭이 얼굴 + 시각 + 날짜

import { fmtLongDate, fmtClock, monthDay, mealLabel, pad2 } from './format.js?v=6';

const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

export const STYLES = [
  { id: 'basic', label: '기본' },
  { id: 'big', label: '크게' },
  { id: 'film', label: '필름' },
  { id: 'meal', label: '식단' },
  { id: 'capsule', label: '캡슐' },
  { id: 'mascot', label: '마스코트' },
];

// 글자색. 밝은 사진에는 검정, 눈에 띄게 하려면 노랑.
export const COLORS = {
  white: { label: '흰색', fill: '#ffffff', shadow: 'rgba(0, 0, 0, 0.45)' },
  black: { label: '검정', fill: '#191f28', shadow: 'rgba(255, 255, 255, 0.6)' },
  yellow: { label: '노랑', fill: '#ffd84a', shadow: 'rgba(0, 0, 0, 0.5)' },
};

// 필름 스탬프는 색을 고르지 않는다 (필름 카메라 날짜의 주황색)
export const styleUsesColor = (style) => style !== 'film';

const font = (weight, px) => `${weight} ${px}px ${FONT}`;

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function textShadow(ctx, c, u, blur = 10) {
  ctx.shadowColor = c.shadow;
  ctx.shadowBlur = blur * u;
  ctx.shadowOffsetY = 1.5 * u;
}

function noShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// 스탬프 효과(pop)가 커졌다 작아지는 기준점
function anchor(style, side, u) {
  switch (style) {
    case 'big': return [side / 2, side / 2];
    case 'film': return [side - 220 * u, side - 110 * u];
    case 'meal': return [58 * u, 150 * u];
    default: return [60 * u, side - 140 * u];
  }
}

/**
 * info: { date: Date, meal: string|null, face: HTMLImageElement|null }
 * opts: { style, color, pop: { scale, alpha } | null }
 */
export function drawStamp(ctx, side, info, { style = 'basic', color = 'white', pop = null } = {}) {
  const u = side / 1080;
  const c = COLORS[color] || COLORS.white;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (pop) {
    ctx.globalAlpha = pop.alpha;
    const [ax, ay] = anchor(style, side, u);
    ctx.translate(ax, ay);
    ctx.scale(pop.scale, pop.scale);
    ctx.translate(-ax, -ay);
  }
  (DRAW[style] || DRAW.basic)(ctx, side, u, info, c);
  ctx.restore();
}

const DRAW = {
  basic(ctx, side, u, { date }, c) {
    textShadow(ctx, c, u);
    ctx.fillStyle = c.fill;
    ctx.font = font(600, 50 * u);
    setSpacing(ctx, -0.5 * u);
    ctx.fillText(fmtLongDate(date), 58 * u, 862 * u);
    ctx.fillText(fmtClock(date), 58 * u, 928 * u);
  },

  big(ctx, side, u, { date }, c) {
    const clock = fmtClock(date); // "오전 7:46"
    const [ampm, digits] = clock.split(' ');
    ctx.textAlign = 'center';
    textShadow(ctx, c, u, 22);
    ctx.fillStyle = c.fill;
    ctx.font = font(800, 236 * u);
    setSpacing(ctx, -9 * u);
    ctx.fillText(digits, side / 2, 612 * u);
    setSpacing(ctx, -0.5 * u);
    ctx.font = font(600, 50 * u);
    ctx.fillText(`${ampm} · ${fmtLongDate(date)}`, side / 2, 704 * u);
  },

  film(ctx, side, u, { date }) {
    const h = date.getHours();
    const text = `'${String(date.getFullYear()).slice(2)} ${pad2(date.getMonth() + 1)} ${pad2(date.getDate())}  ${h}:${pad2(date.getMinutes())}`;
    drawSegments(ctx, text, side - 70 * u, side - 78 * u, 58 * u);
  },

  meal(ctx, side, u, { date, meal }, c) {
    const label = mealLabel(meal) || '식사';
    const x = 58 * u;
    const top = 70 * u;
    const ph = 72 * u;
    ctx.font = font(700, 40 * u);
    setSpacing(ctx, 0);
    const pw = ctx.measureText(label).width + 52 * u;
    // 라벨: 고른 색으로 칠하고 글자는 반대색
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 12 * u;
    ctx.shadowOffsetY = 2 * u;
    roundRect(ctx, x, top, pw, ph, ph / 2);
    ctx.fillStyle = c.fill;
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = c.fill === '#191f28' ? '#ffffff' : '#191f28';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 26 * u, top + ph / 2 + 2 * u);

    ctx.textBaseline = 'alphabetic';
    textShadow(ctx, c, u);
    ctx.fillStyle = c.fill;
    ctx.font = font(800, 80 * u);
    setSpacing(ctx, -2.4 * u);
    ctx.fillText(fmtClock(date), x, top + ph + 98 * u);
    ctx.font = font(600, 42 * u);
    setSpacing(ctx, -0.4 * u);
    ctx.fillText(monthDay(date), x, top + ph + 158 * u);
  },

  capsule(ctx, side, u, { date }, c) {
    const text = `${monthDay(date)}  ${fmtClock(date)}`;
    ctx.font = font(600, 44 * u);
    setSpacing(ctx, -0.4 * u);
    const tw = ctx.measureText(text).width;
    const h = 88 * u;
    const x = 48 * u;
    const y = side - 64 * u - h;
    const dark = c.fill !== '#191f28';
    roundRect(ctx, x, y, tw + 64 * u, h, h / 2);
    ctx.fillStyle = dark ? 'rgba(17, 20, 26, 0.52)' : 'rgba(255, 255, 255, 0.78)';
    ctx.fill();
    ctx.fillStyle = c.fill;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 32 * u, y + h / 2 + 2 * u);
  },

  mascot(ctx, side, u, { date, face }, c) {
    const size = 150 * u;
    const left = 52 * u;
    const top = side - 60 * u - size;
    let tx = 58 * u;
    if (face) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = 14 * u;
      ctx.shadowOffsetY = 3 * u;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(face, left, top, size, size);
      tx = left + size + 24 * u;
    }
    textShadow(ctx, c, u);
    ctx.fillStyle = c.fill;
    ctx.font = font(800, 76 * u);
    setSpacing(ctx, -2.2 * u);
    ctx.fillText(fmtClock(date), tx, top + 88 * u);
    ctx.font = font(600, 40 * u);
    setSpacing(ctx, -0.4 * u);
    ctx.fillText(monthDay(date), tx, top + 138 * u);
  },
};

/* ── 필름 카메라 날짜 같은 7세그먼트 숫자 ── */

const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function glyphWidth(ch, h) {
  if (ch === ' ') return h * 0.42;
  if (ch === "'") return h * 0.22;
  if (ch === ':') return h * 0.26;
  return h * 0.5 + h * 0.16;
}

function drawSegment(ctx, key, x, y, w, h, t) {
  const g = t * 0.22;
  const half = h / 2;
  const rects = {
    a: [x + t * 0.5 + g, y, w - t - 2 * g, t],
    g: [x + t * 0.5 + g, y + half - t / 2, w - t - 2 * g, t],
    d: [x + t * 0.5 + g, y + h - t, w - t - 2 * g, t],
    f: [x, y + t * 0.5 + g, t, half - t - 2 * g],
    b: [x + w - t, y + t * 0.5 + g, t, half - t - 2 * g],
    e: [x, y + half + t * 0.5 + g - t / 2, t, half - t - 2 * g],
    c: [x + w - t, y + half + t * 0.5 + g - t / 2, t, half - t - 2 * g],
  };
  const [rx, ry, rw, rh] = rects[key];
  roundRect(ctx, rx, ry, rw, rh, t / 2);
  ctx.fill();
}

// right: 글자 끝 x, baseline: 글자 아래 y, h: 숫자 높이
function drawSegments(ctx, text, right, baseline, h) {
  const total = [...text].reduce((s, ch) => s + glyphWidth(ch, h), 0);
  const top = baseline - h;
  const t = h * 0.13;
  ctx.save();
  // 살짝 기울인 디지털 숫자
  ctx.translate(right - total, baseline);
  ctx.transform(1, 0, -0.1, 1, 0, 0);
  ctx.translate(-(right - total), -baseline);
  ctx.fillStyle = '#ff8a2a';
  for (const pass of [0, 1]) {
    // 첫 번째는 번지는 빛, 두 번째는 또렷한 숫자
    ctx.shadowColor = pass ? 'rgba(255, 120, 30, 0.55)' : 'rgba(255, 96, 20, 0.9)';
    ctx.shadowBlur = pass ? h * 0.12 : h * 0.4;
    ctx.globalAlpha = pass ? 1 : 0.55;
    let x = right - total;
    for (const ch of text) {
      const gw = glyphWidth(ch, h);
      if (SEG[ch]) {
        for (const key of SEG[ch]) drawSegment(ctx, key, x, top, h * 0.5, h, t);
      } else if (ch === "'") {
        roundRect(ctx, x + gw * 0.25, top, t, h * 0.3, t / 2);
        ctx.fill();
      } else if (ch === ':') {
        roundRect(ctx, x + gw * 0.3, top + h * 0.25, t, t, t / 2);
        ctx.fill();
        roundRect(ctx, x + gw * 0.3, top + h * 0.65, t, t, t / 2);
        ctx.fill();
      }
      x += gw;
    }
  }
  ctx.restore();
}
