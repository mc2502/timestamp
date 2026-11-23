// 정사각형 사진에 찍는 스탬프 7종. 로고는 넣지 않는다. 캐릭터 스탬프가 기본이다.
// 모든 값은 1080px 정사각형 기준 단위(u)이고, 실제 크기에 비율로 맞춘다.
//
//  odung   오둥이   왼쪽 아래 카메라 든 오둥이 + 옆 말풍선에 시각·날짜
//  perpeng 퍼펭이   왼쪽 아래 카메라 든 퍼펭이 + 옆 말풍선에 시각·날짜
//  basic   기본     왼쪽 아래 두 줄: 2026년 11월 23일 (월) / 오전 7:46
//  big     크게     가운데 큰 시각, 아래 한 줄 날짜
//  film    필름     오른쪽 아래 주황 디지털 숫자 '26 11 23  7:46
//  meal    식단     왼쪽 위 끼니 라벨 + 시각 + 날짜
//  capsule 캡슐     왼쪽 아래 반투명 둥근 바탕 위 한 줄

import { fmtLongDate, fmtClock, monthDay, mealLabel, pad2 } from './format.js?v=10';

const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

export const STYLES = [
  { id: 'odung', label: '오둥이', character: true },
  { id: 'perpeng', label: '퍼펭이', character: true },
  { id: 'basic', label: '기본' },
  { id: 'big', label: '크게' },
  { id: 'film', label: '필름' },
  { id: 'meal', label: '식단' },
  { id: 'capsule', label: '캡슐' },
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

/* ── 자간: 글자를 한 자씩 직접 놓는다 ──
   아이폰 Safari 캔버스는 letterSpacing을 무시할 수 있어서, 그대로 두면 글자와 띄어쓰기가 벌어져 보인다.
   em: 글자 크기 대비 자간(음수면 좁힘), space: 띄어쓰기 폭 비율 */
const TRACK = {
  text: { em: -0.04, space: 1.15 }, // 날짜 · 시각
  big: { em: -0.065, space: 1 }, // 큰 숫자
  label: { em: -0.02, space: 1 }, // 식사 라벨
};

function advance(ctx, ch, space) {
  const w = ctx.measureText(ch).width;
  return ch === ' ' ? w * space : w;
}

function trackedWidth(ctx, text, px, { em, space }) {
  const chars = [...text];
  return chars.reduce((s, ch) => s + advance(ctx, ch, space), 0) + em * px * (chars.length - 1);
}

// align: 'left' | 'center' — 그린 폭을 돌려준다
function fillTracked(ctx, text, x, y, px, track = TRACK.text, align = 'left') {
  const total = trackedWidth(ctx, text, px, track);
  let cx = align === 'center' ? x - total / 2 : x;
  const saved = ctx.textAlign;
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  for (const ch of text) {
    if (ch !== ' ') ctx.fillText(ch, cx, y);
    cx += advance(ctx, ch, track.space) + track.em * px;
  }
  ctx.textAlign = saved;
  return total;
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
    case 'odung':
    case 'perpeng': return [200 * u, side - 200 * u];
    default: return [60 * u, side - 140 * u];
  }
}

/**
 * info: { date: Date, meal: string|null, chars: { odung, perpeng } (카메라 든 캐릭터 그림) }
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
    const px = 52 * u;
    textShadow(ctx, c, u);
    ctx.fillStyle = c.fill;
    ctx.font = font(650, px);
    fillTracked(ctx, fmtLongDate(date), 58 * u, 862 * u, px);
    fillTracked(ctx, fmtClock(date), 58 * u, 928 * u, px);
  },

  big(ctx, side, u, { date }, c) {
    const clock = fmtClock(date); // "오전 7:46"
    const [ampm, digits] = clock.split(' ');
    textShadow(ctx, c, u, 22);
    ctx.fillStyle = c.fill;
    const big = 236 * u;
    ctx.font = font(800, big);
    fillTracked(ctx, digits, side / 2, 612 * u, big, TRACK.big, 'center');
    const px = 48 * u;
    ctx.font = font(650, px);
    fillTracked(ctx, `${ampm} · ${fmtLongDate(date)}`, side / 2, 700 * u, px, TRACK.text, 'center');
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
    const lp = 40 * u;
    ctx.font = font(700, lp);
    const pw = trackedWidth(ctx, label, lp, TRACK.label) + 52 * u;
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
    fillTracked(ctx, label, x + 26 * u, top + ph / 2 + 2 * u, lp, TRACK.label);

    ctx.textBaseline = 'alphabetic';
    textShadow(ctx, c, u);
    ctx.fillStyle = c.fill;
    const tp = 80 * u;
    ctx.font = font(800, tp);
    fillTracked(ctx, fmtClock(date), x, top + ph + 98 * u, tp);
    const dp = 42 * u;
    ctx.font = font(650, dp);
    fillTracked(ctx, monthDay(date), x, top + ph + 156 * u, dp);
  },

  capsule(ctx, side, u, { date }, c) {
    const text = `${monthDay(date)}  ${fmtClock(date)}`;
    const px = 44 * u;
    ctx.font = font(650, px);
    const tw = trackedWidth(ctx, text, px, TRACK.text);
    const h = 88 * u;
    const x = 48 * u;
    const y = side - 64 * u - h;
    const dark = c.fill !== '#191f28';
    roundRect(ctx, x, y, tw + 64 * u, h, h / 2);
    ctx.fillStyle = dark ? 'rgba(17, 20, 26, 0.52)' : 'rgba(255, 255, 255, 0.78)';
    ctx.fill();
    ctx.fillStyle = c.fill;
    ctx.textBaseline = 'middle';
    fillTracked(ctx, text, x + 32 * u, y + h / 2 + 2 * u, px);
  },

  odung(ctx, side, u, info, c) { drawCharacter(ctx, side, u, info, c, 'odung'); },
  perpeng(ctx, side, u, info, c) { drawCharacter(ctx, side, u, info, c, 'perpeng'); },
};

/* ── 캐릭터 스탬프: 카메라 든 오둥이·퍼펭이 + 말풍선 ──
   글씨는 캐릭터 위에 얹지 않고 옆 말풍선에만 쓴다 (PT Note: 마스코트 위에 글씨 금지). */

const BUBBLE = {
  white: { fill: 'rgba(255, 255, 255, 0.95)', ink: '#191f28', sub: '#4e5968' },
  black: { fill: 'rgba(25, 31, 40, 0.92)', ink: '#ffffff', sub: '#c9d0d9' },
  yellow: { fill: '#ffd84a', ink: '#191f28', sub: '#4a3d0a' },
};

function drawCharacter(ctx, side, u, { date, chars }, c, who) {
  const img = chars?.[who];
  const size = 340 * u;
  const left = 22 * u;
  const top = side - 18 * u - size;
  const colors = BUBBLE[Object.keys(COLORS).find((k) => COLORS[k] === c) || 'white'];

  if (img) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 18 * u;
    ctx.shadowOffsetY = 5 * u;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, left, top, size, size);
    ctx.restore();
  }

  // 말풍선 크기
  const tp = 66 * u;
  const dp = 36 * u;
  const time = fmtClock(date);
  const day = monthDay(date);
  ctx.font = font(800, tp);
  const tw = trackedWidth(ctx, time, tp, TRACK.text);
  ctx.font = font(650, dp);
  const dw = trackedWidth(ctx, day, dp, TRACK.text);
  const padX = 34 * u;
  const bw = Math.max(tw, dw) + padX * 2;
  const bh = 168 * u;
  let bx = img ? left + size * 0.86 : 48 * u;
  bx = Math.min(bx, side - bw - 30 * u);
  const by = img ? top + size * 0.16 : side - 60 * u - bh;
  const r = 44 * u;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 22 * u;
  ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = colors.fill;
  roundRect(ctx, bx, by, bw, bh, r);
  ctx.fill();
  if (img) {
    // 캐릭터 쪽을 가리키는 꼬리
    const ty = by + bh * 0.62;
    ctx.beginPath();
    ctx.moveTo(bx + 6 * u, ty - 22 * u);
    ctx.quadraticCurveTo(bx - 10 * u, ty + 4 * u, bx - 30 * u, ty + 20 * u);
    ctx.quadraticCurveTo(bx + 4 * u, ty + 16 * u, bx + 20 * u, ty + 6 * u);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colors.ink;
  ctx.font = font(800, tp);
  fillTracked(ctx, time, bx + padX, by + 82 * u, tp);
  ctx.fillStyle = colors.sub;
  ctx.font = font(650, dp);
  fillTracked(ctx, day, bx + padX, by + 136 * u, dp);
}

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
