import {
  WEEKDAYS, MEALS, pad2, fmtDate, fmtTime, weekday, monthDay, dayKey, fromDayKey, fileStamp,
  weekLabel, relDay, mealLabel, mealFor, toLocalInput, fromLocalInput,
} from './format.js';
import { readExifDate } from './exif.js';
import { stampScale, measureStamp, drawStamp, resolvePos, pickCorner } from './stamp.js';
import * as db from './db.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 저장본 크기: 긴 변 3200px, iOS 캔버스 한도(1,670만 화소) 안쪽
const MAX_SIDE = 3200;
const MAX_AREA = 16e6;
const JPEG_QUALITY = 0.92;

/* ── 마스코트: 앱을 열 때마다 지난번과 다른 친구가 나온다 ── */

const ART = {
  odung: {
    summary: 'assets/mascots/odung-summary-v2.png',
    face: 'assets/mascots/odung-calendar-face-v7.png',
    trio: 'assets/mascots/odung-week-trio-v2.png',
  },
  perpeng: {
    summary: 'assets/mascots/perpeng-summary-v1.png',
    face: 'assets/mascots/perpeng-calendar-face-v4.png',
    trio: 'assets/mascots/perpeng-week-trio-v1.png',
  },
};

const local = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};

function chooseFamily() {
  const next = local.get('timestamp:family') === 'odung' ? 'perpeng' : 'odung';
  local.set('timestamp:family', next);
  return next;
}

const state = {
  family: chooseFamily(),
  face: null,
  records: [],
  thumbUrls: new Map(),
  dbOk: true,
  view: 'today',
  month: null,
  selectedDay: null,
  todayKey: dayKey(new Date()),
};
const art = ART[state.family];

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ── 시작 ── */

async function init() {
  document.documentElement.dataset.family = state.family;
  $$('[data-art]').forEach((img) => { img.src = art[img.dataset.art]; });
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);
  state.selectedDay = dayKey(now);

  bindEvents();
  renderAll();

  const [face] = await Promise.all([loadImageUrl(art.face).catch(() => null), fontsReady()]);
  state.face = face;
  renderSample();

  await loadRecords();
  renderAll();

  setInterval(() => tick(), 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('resize', () => { if (ed?.rect) placeHandle(); });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function loadImageUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image: ${src}`));
    img.src = src;
  });
}

async function fontsReady() {
  if (!document.fonts?.load) return;
  const sample = '0123456789.:() 월화수목금토일아침점심저녁간식';
  const family = '"Pretendard Variable"';
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`800 34px ${family}`, sample),
        document.fonts.load(`700 13px ${family}`, sample),
        document.fonts.load(`600 14px ${family}`, sample),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // 글꼴을 못 받으면 시스템 글꼴(Apple SD Gothic Neo)로 그린다
  }
}

async function loadRecords() {
  try {
    const list = await db.all();
    state.records = list.sort((a, b) => a.takenAt - b.takenAt);
  } catch {
    state.dbOk = false;
    state.records = [];
  }
}

function tick() {
  const key = dayKey(new Date());
  if (key !== state.todayKey) {
    if (state.selectedDay === state.todayKey) state.selectedDay = key;
    state.todayKey = key;
    renderAll();
  } else {
    renderHero();
  }
  renderSample();
}

/* ── 이벤트 ── */

function bindEvents() {
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      closeSheet($('#choose'));
      openPicker(pick.dataset.pick);
      return;
    }
    const tab = e.target.closest('[data-view]');
    if (tab) { showView(tab.dataset.view); return; }
    const photo = e.target.closest('[data-id]');
    if (photo) { openViewer(photo.dataset.id); return; }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      state.selectedDay = day.dataset.day;
      renderCalendar();
      renderDay();
    }
  });

  $('#add').addEventListener('click', () => openSheet($('#choose')));

  $('#input-camera').addEventListener('change', (e) => startEdit(e.target.files?.[0], 'camera'));
  $('#input-album').addEventListener('change', (e) => startEdit(e.target.files?.[0], 'album'));

  $('#mon-prev').addEventListener('click', () => shiftMonth(-1));
  $('#mon-next').addEventListener('click', () => shiftMonth(1));

  for (const sheet of $$('.scrim, .sheet')) {
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close]')) requestClose(sheet);
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(sheet); }
    });
  }

  bindEditor();
  bindViewer();
}

function openPicker(source) {
  const input = source === 'camera' ? $('#input-camera') : $('#input-album');
  input.value = '';
  input.click();
}

function showView(view) {
  state.view = view;
  $('#view-today').hidden = view !== 'today';
  $('#view-log').hidden = view !== 'log';
  for (const tab of $$('.tab')) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('on', on);
    if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

function shiftMonth(delta) {
  const m = state.month;
  state.month = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  renderCalendar();
}

/* ── 시트 ── */

const appRoot = $('#app');
const openSheets = [];

function openSheet(sheet) {
  if (!sheet.hidden) return;
  sheet.returnFocus = document.activeElement;
  sheet.hidden = false;
  openSheets.push(sheet);
  appRoot.inert = true;
  document.documentElement.classList.add('is-locked');
  requestAnimationFrame(() => {
    const target = sheet.querySelector('[data-autofocus]') || sheet.querySelector('button');
    target?.focus({ preventScroll: true });
  });
}

function closeSheet(sheet) {
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  openSheets.splice(openSheets.indexOf(sheet), 1);
  if (!openSheets.length) {
    appRoot.inert = false;
    document.documentElement.classList.remove('is-locked');
  }
  const back = sheet.returnFocus;
  if (back && document.contains(back) && !back.closest('[hidden]')) back.focus({ preventScroll: true });
}

function requestClose(sheet) {
  if (sheet.id === 'editor') closeEditor();
  else if (sheet.id === 'viewer') closeViewer();
  else closeSheet(sheet);
}

function showMsg(slot, kind, text) {
  slot.innerHTML = text ? `<p class="msg ${kind}"${kind === 'err' ? ' role="alert"' : ''}>${escapeHtml(text)}</p>` : '';
}

/* ── 기록 데이터 ── */

const recordsOn = (key) => state.records.filter((r) => r.day === key).sort((a, b) => a.takenAt - b.takenAt);

function thumbUrl(rec) {
  let url = state.thumbUrls.get(rec.id);
  if (!url) {
    url = URL.createObjectURL(rec.thumb || rec.blob);
    state.thumbUrls.set(rec.id, url);
  }
  return url;
}

function forgetThumb(id) {
  const url = state.thumbUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.thumbUrls.delete(id);
}

function upsertRecord(rec) {
  forgetThumb(rec.id);
  const i = state.records.findIndex((r) => r.id === rec.id);
  if (i >= 0) state.records[i] = rec; else state.records.push(rec);
  state.records.sort((a, b) => a.takenAt - b.takenAt);
}

function statusText(rec) {
  if (rec.sentAt) return '보냈어요';
  if (rec.savedAt) return '저장했어요';
  return '';
}

/* ── 화면 그리기 ── */

function renderAll() {
  renderHero();
  renderWeek();
  renderTodayList();
  renderLog();
}

function renderHero() {
  const now = new Date();
  $('#today-date').textContent = `${fmtDate(now)} (${weekday(now)})`;
  const meal = mealFor(now);
  const label = mealLabel(meal);
  const done = recordsOn(dayKey(now)).some((r) => r.meal === meal);
  $('#hero-title').innerHTML = done ? `${label}까지<br>잘 남겼어요` : `${label} 사진을<br>남겨 볼까요?`;
}

function renderSample() {
  const canvas = $('#sample-stamp');
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const now = new Date();
  const info = { date: now, meal: mealFor(now), face: state.face };
  const s = 0.74 * dpr;
  const pad = 12 * dpr;
  const ctx = canvas.getContext('2d');
  const size = measureStamp(ctx, info, s);
  canvas.width = Math.ceil(size.w + pad * 2);
  canvas.height = Math.ceil(size.h + pad * 2);
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  drawStamp(ctx, info, pad, pad, s, measureStamp(ctx, info, s));
}

const WEEK_LINES = ['', '좋은 출발이에요', '리듬이 생겼어요', '꾸준히 남기고 있어요', '절반을 넘었어요', '거의 다 왔어요', '하루만 더 남았어요', '하루도 안 빠졌어요'];

function renderWeek() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 7);
  const stampedDays = new Set(state.records.map((r) => r.day));
  const todayKey = dayKey(today);

  let html = '<span aria-hidden="true"></span>';
  html += WEEKDAYS.map((w) => `<span class="week-weekday" aria-hidden="true">${w}</span>`).join('');
  let count = 0;
  for (let row = 0; row < 2; row++) {
    html += `<span class="week-row-label${row ? ' current' : ''}">${row ? '이번 주' : '지난주'}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + row * 7 + i);
      const key = dayKey(d);
      const stamped = stampedDays.has(key);
      const future = key > todayKey;
      if (row === 1 && stamped) count++;
      const label = `${d.getMonth() + 1}월 ${d.getDate()}일${stamped ? ', 사진 남김' : ''}`;
      html += `<div class="wk${stamped ? ' wk-stamped' : ''}" role="img" aria-label="${label}">`
        + `<i class="wdot${key === todayKey ? ' today' : ''}${future ? ' off' : ''}" aria-hidden="true">${d.getDate()}</i>`
        + (stamped ? `<img class="week-stamp" src="${art.face}" alt="" aria-hidden="true">` : '')
        + '</div>';
    }
  }
  $('#week').innerHTML = html;
  $('#week-heading').innerHTML = count === 0
    ? '이번 주 <span class="week-total">첫 기록</span>을 기다려요'
    : `이번 주 <span class="week-total">${count}일</span>, ${WEEK_LINES[count]}`;
  $('#week-label').textContent = weekLabel(now);
}

function renderTodayList() {
  const list = recordsOn(dayKey(new Date()));
  $('#today-count').textContent = list.length ? `${list.length}장` : '';
  $('#today-empty').hidden = list.length > 0;
  $('#today-thumbs').hidden = list.length === 0;
  $('#today-thumbs').innerHTML = list.map((r) => {
    const d = new Date(r.takenAt);
    const label = mealLabel(r.meal) || '사진';
    return `<button class="thumb" type="button" data-id="${r.id}" aria-label="${label} ${fmtTime(d)} 사진 보기">`
      + `<span class="thumb-img"><img src="${thumbUrl(r)}" alt=""></span>`
      + `<span class="thumb-cap"><b>${label}</b>${fmtTime(d)}</span></button>`;
  }).join('');
}

function renderLog() {
  const days = new Set(state.records.map((r) => r.day));
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const monthDays = [...days].filter((k) => k.startsWith(thisMonth)).length;
  $('#sum-title').textContent = days.size ? `누적 ${days.size}일 기록` : '첫 기록을 기다려요';
  $('#sum-lead').innerHTML = `<span>이번 달 <b>${monthDays}일</b></span><span>사진 <b>${state.records.length}장</b></span>`;
  $('#sum-tot').innerHTML = MEALS.map(([id, label]) => {
    const n = state.records.filter((r) => r.meal === id).length;
    return `<div><span>${label}</span><b>${n}<small>장</small></b></div>`;
  }).join('');
  renderCalendar();
  renderDay();
}

function renderCalendar() {
  const m = state.month;
  const y = m.getFullYear();
  const mo = m.getMonth();
  const now = new Date();
  $('#mon-t').textContent = y === now.getFullYear() ? `${mo + 1}월` : `${y}년 ${mo + 1}월`;
  $('#mon-next').disabled = y === now.getFullYear() && mo === now.getMonth();

  const counts = new Map();
  for (const r of state.records) counts.set(r.day, (counts.get(r.day) || 0) + 1);
  const todayKey = dayKey(now);
  const first = new Date(y, mo, 1).getDay();
  const last = new Date(y, mo + 1, 0).getDate();

  let html = WEEKDAYS.map((w, i) => `<div class="hd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="c" aria-hidden="true"></div>';
  for (let d = 1; d <= last; d++) {
    const key = dayKey(new Date(y, mo, d));
    const n = counts.get(key) || 0;
    const future = key > todayKey;
    const selected = key === state.selectedDay;
    const cls = ['dot', n && 'has', key === todayKey && 'today', selected && 'selected', future && 'off'].filter(Boolean).join(' ');
    const label = `${mo + 1}월 ${d}일${n ? `, 사진 ${n}장` : ''}`;
    html += `<div class="c"><button class="day" type="button" data-day="${key}" aria-pressed="${selected}" aria-label="${label}"${future ? ' disabled' : ''}>`
      + `<span class="${cls}">${d}</span></button></div>`;
  }
  $('#cal').innerHTML = html;
}

function renderDay() {
  const d = fromDayKey(state.selectedDay);
  const list = recordsOn(state.selectedDay);
  const rel = relDay(d);
  $('#day-title').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday(d)})`;
  $('#day-count').textContent = [rel, list.length ? `${list.length}장` : ''].filter(Boolean).join(' · ');
  $('#day-empty').hidden = list.length > 0;
  $('#day-rows').innerHTML = list.map((r) => {
    const t = new Date(r.takenAt);
    const label = mealLabel(r.meal) || '사진';
    const status = statusText(r);
    return `<button class="row" type="button" data-id="${r.id}">`
      + `<span class="row-thumb"><img src="${thumbUrl(r)}" alt=""></span>`
      + `<span class="row-m"><span class="row-t">${label}</span><span class="row-s">${fmtTime(t)}${status ? ` · ${status}` : ''}</span></span>`
      + '<i class="chev" aria-hidden="true"></i></button>';
  }).join('');
}

/* ── 스탬프 확인 ── */

let ed = null;
const E = {
  sheet: $('#editor'),
  preview: $('#preview'),
  skel: $('#preview-skel'),
  canvas: $('#preview-canvas'),
  handle: $('#stamp-handle'),
  auto: $('#pos-auto'),
  time: $('#ed-time'),
  timeText: $('#ed-time-text'),
  timeNote: $('#ed-time-note'),
  seg: $('#meal-seg'),
  msg: $('#ed-msg'),
  save: $('#ed-save'),
  send: $('#ed-send'),
};

const TIME_NOTES = {
  exif: ['사진에 저장된 촬영 시각이에요.', ''],
  now: ['방금 찍은 시각이에요.', ''],
  file: ['파일에 남은 시각이에요. 맞는지 확인해 주세요.', 'warn'],
  unknown: ['사진에 촬영 시각이 없어서 지금 시각을 넣었어요. 맞지 않으면 바꿔 주세요.', 'warn'],
  edited: ['직접 고친 시각이에요.', ''],
};

const infoOf = (e) => ({ date: e.takenAt, meal: e.meal, face: state.face });

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function startEdit(file, source) {
  if (!file) return;
  const mine = {
    id: uid(), createdAt: Date.now(), version: 0, job: null, timer: 0,
    file: null, thumb: null, savedAt: null, sentAt: null, persistedVersion: null,
    pos: null, autoCorner: 'br', meal: null, mealAuto: true, rect: null, ready: false,
  };
  ed = mine;
  E.canvas.hidden = true;
  E.handle.hidden = true;
  E.skel.hidden = false;
  E.auto.hidden = true;
  E.save.disabled = true;
  E.send.disabled = true;
  E.timeText.textContent = '';
  E.timeNote.textContent = '';
  showMsg(E.msg, '', '');
  openSheet(E.sheet);

  try {
    const [{ img, url }, exifDate] = await Promise.all([loadPhoto(file), readExifDate(file)]);
    if (ed !== mine) { URL.revokeObjectURL(url); return; }
    mine.img = img;
    mine.url = url;

    if (exifDate) { mine.takenAt = exifDate; mine.timeSource = 'exif'; }
    else if (source === 'camera') { mine.takenAt = new Date(); mine.timeSource = 'now'; }
    else if (file.lastModified && Math.abs(Date.now() - file.lastModified) > 60000) { mine.takenAt = new Date(file.lastModified); mine.timeSource = 'file'; }
    else { mine.takenAt = new Date(); mine.timeSource = 'unknown'; }
    mine.meal = mealFor(mine.takenAt);

    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0), Math.sqrt(MAX_AREA / (w0 * h0)));
    mine.W = Math.max(1, Math.round(w0 * k));
    mine.H = Math.max(1, Math.round(h0 * k));

    buildPreview(mine);
    mine.autoCorner = pickCorner(mine.base, infoOf(mine));
    mine.pos = { corner: mine.autoCorner };
    mine.ready = true;

    E.skel.hidden = true;
    E.canvas.hidden = false;
    E.handle.hidden = false;
    E.save.disabled = false;
    E.send.disabled = false;
    fillFields();
    drawPreview();
    markDirty();
  } catch {
    if (ed !== mine) return;
    E.skel.hidden = true;
    showMsg(E.msg, 'err', '사진을 열지 못했어요. 다른 사진으로 다시 시도해 주세요.');
  }
}

function buildPreview(e) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const maxW = Math.max(200, E.preview.clientWidth || 354);
  const maxH = Math.min(window.innerHeight * 0.52, 470);
  const fit = Math.min(maxW / e.W, maxH / e.H);
  const cssW = Math.round(e.W * fit);
  const cssH = Math.round(e.H * fit);
  const pw = Math.min(e.W, Math.round(cssW * dpr));
  const ph = Math.max(1, Math.round((pw * e.H) / e.W));

  const base = document.createElement('canvas');
  base.width = pw;
  base.height = ph;
  const bctx = base.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(e.img, 0, 0, pw, ph);
  e.base = base;

  E.canvas.width = pw;
  E.canvas.height = ph;
  E.canvas.style.width = `${cssW}px`;
  E.canvas.style.height = `${cssH}px`;
}

function fillFields() {
  const d = ed.takenAt;
  const day = d.getDay();
  E.timeText.innerHTML = `${fmtDate(d)} <small class="${day === 0 ? 'sun' : day === 6 ? 'sat' : ''}">(${weekday(d)})</small> ${fmtTime(d)}`;
  E.time.value = toLocalInput(d);
  E.time.max = toLocalInput(new Date(Date.now() + 60000));
  const [note, tone] = TIME_NOTES[ed.timeSource] || ['', ''];
  E.timeNote.textContent = note;
  E.timeNote.className = `time-note${tone ? ` ${tone}` : ''}`;
  for (const b of $$('button', E.seg)) {
    const id = b.dataset.meal === 'none' ? null : b.dataset.meal;
    b.setAttribute('aria-pressed', String(id === ed.meal));
  }
}

let frame = 0;
function schedulePreview() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; drawPreview(); });
}

function drawPreview() {
  if (!ed?.base) return;
  const c = E.canvas;
  const ctx = c.getContext('2d');
  ctx.drawImage(ed.base, 0, 0);
  const info = infoOf(ed);
  const s = stampScale(c.width, c.height);
  const size = measureStamp(ctx, info, s);
  const p = resolvePos(ed.pos, c.width, c.height, size, s);
  drawStamp(ctx, info, p.x, p.y, s, size);
  ed.rect = { x: p.x, y: p.y, w: size.w, h: size.h };
  placeHandle();
  E.auto.hidden = Boolean(ed.pos.corner);
}

function placeHandle() {
  const c = E.canvas;
  const cb = c.getBoundingClientRect();
  const pb = E.preview.getBoundingClientRect();
  if (!cb.width) return;
  const k = cb.width / c.width;
  const r = ed.rect;
  Object.assign(E.handle.style, {
    left: `${cb.left - pb.left + r.x * k}px`,
    top: `${cb.top - pb.top + r.y * k}px`,
    width: `${r.w * k}px`,
    height: `${r.h * k}px`,
  });
}

// 끌어서 놓은 자리를 비율로 기억한다 (저장본도 같은 자리)
function settlePos() {
  ed.pos = { fx: ed.rect.x / E.canvas.width, fy: ed.rect.y / E.canvas.height };
}

function markDirty() {
  if (!ed) return;
  const mine = ed;
  mine.version++;
  mine.file = null;
  clearTimeout(mine.timer);
  mine.timer = setTimeout(() => { if (ed === mine) exportFor(mine, mine.version).catch(() => {}); }, 300);
}

function exportFor(e, v) {
  if (e.job && e.job.v === v) return e.job.p;
  const p = renderExport(e, v);
  e.job = { v, p };
  return p;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality);
  });
}

async function renderExport(e, v) {
  const c = document.createElement('canvas');
  c.width = e.W;
  c.height = e.H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(e.img, 0, 0, e.W, e.H);
  const info = infoOf(e);
  const s = stampScale(e.W, e.H);
  const size = measureStamp(ctx, info, s);
  const p = resolvePos(e.pos, e.W, e.H, size, s);
  drawStamp(ctx, info, p.x, p.y, s, size);
  const blob = await canvasBlob(c, 'image/jpeg', JPEG_QUALITY);

  const tk = Math.min(1, 360 / Math.max(e.W, e.H));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(e.W * tk));
  t.height = Math.max(1, Math.round(e.H * tk));
  const tctx = t.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(c, 0, 0, t.width, t.height);
  const thumb = await canvasBlob(t, 'image/jpeg', 0.8);
  c.width = c.height = 1;
  t.width = t.height = 1;

  if (e.version !== v) return null;
  e.file = new File([blob], `TimeStamp_${fileStamp(e.takenAt)}.jpg`, { type: 'image/jpeg', lastModified: e.takenAt.getTime() });
  e.thumb = thumb;
  return e.file;
}

async function readyFile() {
  if (ed.file) return ed.file;
  clearTimeout(ed.timer);
  await exportFor(ed, ed.version);
  return ed.file;
}

// 공유 화면을 연다. 공유를 못 쓰는 브라우저에서는 파일로 내려받는다.
async function shareFile(file) {
  const data = { files: [file] };
  if (navigator.canShare && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      if (err?.name === 'NotAllowedError') return 'retry';
      return 'error';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

function resultText(kind, result) {
  if (result === 'downloaded') return kind === 'send' ? '사진을 내려받았어요. 카카오톡에서 골라 보내 주세요.' : '사진을 내려받았어요.';
  return kind === 'send' ? '보냈어요.' : '저장했어요.';
}

async function editorShare(kind) {
  if (!ed?.ready) return;
  const mine = ed;
  const button = kind === 'save' ? E.save : E.send;
  let file = mine.file;
  if (!file) {
    button.classList.add('is-busy');
    try { file = await readyFile(); } finally { button.classList.remove('is-busy'); }
    if (!file) return;
  }
  const result = await shareFile(file);
  if (ed !== mine || result === 'cancelled') return;
  if (result === 'retry') { showMsg(E.msg, 'warn', '사진을 준비했어요. 한 번 더 눌러 주세요.'); return; }
  if (result === 'error') { showMsg(E.msg, 'err', '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }

  if (kind === 'save') mine.savedAt = Date.now(); else mine.sentAt = Date.now();
  const kept = await persistEdit(mine);
  if (ed !== mine) return;
  showMsg(E.msg, kept ? 'ok' : 'warn', `${resultText(kind, result)} ${kept ? '기록 탭에도 남겼어요.' : '이 기기에는 기록을 남기지 못했어요.'}`);
}

async function persistEdit(e) {
  if (!state.dbOk || !e.file) return false;
  const rec = {
    id: e.id,
    takenAt: e.takenAt.getTime(),
    day: dayKey(e.takenAt),
    meal: e.meal,
    width: e.W,
    height: e.H,
    blob: e.file,
    thumb: e.thumb,
    createdAt: e.createdAt,
    savedAt: e.savedAt,
    sentAt: e.sentAt,
  };
  try {
    await db.put(rec);
  } catch {
    return false;
  }
  e.persistedVersion = e.version;
  upsertRecord(rec);
  renderAll();
  return true;
}

function closeEditor() {
  if (ed?.ready) {
    if (ed.persistedVersion === null) {
      if (!window.confirm('이 사진은 아직 저장하지 않았어요. 닫을까요?')) return;
    } else if (ed.persistedVersion !== ed.version) {
      if (!window.confirm('저장한 뒤에 바꾼 내용은 기록에 남지 않아요. 닫을까요?')) return;
    }
  }
  if (ed) {
    clearTimeout(ed.timer);
    if (ed.url) URL.revokeObjectURL(ed.url);
    if (ed.base) ed.base.width = ed.base.height = 1;
  }
  ed = null;
  E.canvas.width = E.canvas.height = 1;
  closeSheet(E.sheet);
}

function bindEditor() {
  $('#ed-close').addEventListener('click', closeEditor);
  E.save.addEventListener('click', () => editorShare('save'));
  E.send.addEventListener('click', () => editorShare('send'));

  E.seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-meal]');
    if (!b || !ed?.ready) return;
    ed.meal = b.dataset.meal === 'none' ? null : b.dataset.meal;
    ed.mealAuto = false;
    fillFields();
    drawPreview();
    markDirty();
  });

  E.time.addEventListener('change', () => {
    if (!ed?.ready) return;
    const d = fromLocalInput(E.time.value);
    if (!d) { fillFields(); return; }
    ed.takenAt = d;
    ed.timeSource = 'edited';
    if (ed.mealAuto) ed.meal = mealFor(d);
    fillFields();
    drawPreview();
    markDirty();
  });

  E.auto.addEventListener('click', () => {
    if (!ed?.ready) return;
    ed.pos = { corner: ed.autoCorner };
    drawPreview();
    markDirty();
    E.handle.focus({ preventScroll: true });
  });

  // 스탬프 끌기
  let drag = null;
  E.handle.addEventListener('pointerdown', (e) => {
    if (!ed?.rect) return;
    e.preventDefault();
    E.handle.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: ed.rect.x, y0: ed.rect.y, moved: false };
    E.handle.classList.add('dragging');
  });
  E.handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = E.canvas.width / E.canvas.getBoundingClientRect().width;
    const dx = (e.clientX - drag.sx) * k;
    const dy = (e.clientY - drag.sy) * k;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    ed.pos = { fx: (drag.x0 + dx) / E.canvas.width, fy: (drag.y0 + dy) / E.canvas.height };
    schedulePreview();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    E.handle.classList.remove('dragging');
    if (!ed?.rect) return;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (moved) {
      drawPreview();
      settlePos();
      drawPreview();
      markDirty();
    }
  };
  E.handle.addEventListener('pointerup', endDrag);
  E.handle.addEventListener('pointercancel', endDrag);

  E.handle.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step || !ed?.rect) return;
    e.preventDefault();
    ed.pos = {
      fx: ed.rect.x / E.canvas.width + step[0] * 0.02,
      fy: ed.rect.y / E.canvas.height + step[1] * 0.02,
    };
    drawPreview();
    settlePos();
    markDirty();
  });

  // 사진을 누르면 그 자리로 옮긴다
  E.preview.addEventListener('click', (e) => {
    if (!ed?.rect || e.target === E.handle || E.canvas.hidden) return;
    const cb = E.canvas.getBoundingClientRect();
    if (e.clientX < cb.left || e.clientX > cb.right || e.clientY < cb.top || e.clientY > cb.bottom) return;
    const k = E.canvas.width / cb.width;
    const cx = (e.clientX - cb.left) * k;
    const cy = (e.clientY - cb.top) * k;
    ed.pos = { fx: (cx - ed.rect.w / 2) / E.canvas.width, fy: (cy - ed.rect.h / 2) / E.canvas.height };
    drawPreview();
    settlePos();
    markDirty();
  });
}

/* ── 기록 사진 보기 ── */

let vw = null;
const V = {
  sheet: $('#viewer'),
  title: $('#vw-t'),
  sub: $('#vw-s'),
  img: $('#vw-img'),
  msg: $('#vw-msg'),
};

function viewerTitles(rec) {
  const d = new Date(rec.takenAt);
  V.title.textContent = `${monthDay(d)}${rec.meal ? ` ${mealLabel(rec.meal)}` : ''}`;
  const status = statusText(rec);
  V.sub.textContent = `${fmtTime(d)}${status ? ` · ${status}` : ''}`;
}

function openViewer(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) return;
  const d = new Date(rec.takenAt);
  vw = {
    rec,
    url: URL.createObjectURL(rec.blob),
    file: new File([rec.blob], `TimeStamp_${fileStamp(d)}.jpg`, { type: 'image/jpeg', lastModified: rec.takenAt }),
  };
  viewerTitles(rec);
  V.img.src = vw.url;
  V.img.alt = `${monthDay(d)} ${fmtTime(d)}에 찍은 ${mealLabel(rec.meal) || ''} 사진`.replace(/\s+/g, ' ');
  showMsg(V.msg, '', '');
  openSheet(V.sheet);
}

function closeViewer() {
  if (vw) URL.revokeObjectURL(vw.url);
  vw = null;
  V.img.removeAttribute('src');
  closeSheet(V.sheet);
}

async function viewerShare(kind) {
  if (!vw) return;
  const mine = vw;
  const result = await shareFile(mine.file);
  if (vw !== mine || result === 'cancelled') return;
  if (result === 'retry') { showMsg(V.msg, 'warn', '한 번 더 눌러 주세요.'); return; }
  if (result === 'error') { showMsg(V.msg, 'err', '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
  const rec = { ...mine.rec, [kind === 'save' ? 'savedAt' : 'sentAt']: Date.now() };
  try {
    await db.put(rec);
    upsertRecord(rec);
    mine.rec = rec;
    renderAll();
    if (vw === mine) viewerTitles(rec);
  } catch {
    // 상태 표시만 못 바꿀 뿐 공유는 끝났다
  }
  if (vw === mine) showMsg(V.msg, 'ok', resultText(kind, result));
}

async function viewerDelete() {
  if (!vw) return;
  if (!window.confirm('이 사진을 기록에서 지울까요? 앨범에 저장한 사진은 그대로 남아요.')) return;
  const { id } = vw.rec;
  try {
    await db.remove(id);
  } catch {
    showMsg(V.msg, 'err', '지우지 못했어요. 잠시 후 다시 시도해 주세요.');
    return;
  }
  forgetThumb(id);
  state.records = state.records.filter((r) => r.id !== id);
  closeViewer();
  renderAll();
}

function bindViewer() {
  $('#vw-save').addEventListener('click', () => viewerShare('save'));
  $('#vw-send').addEventListener('click', () => viewerShare('send'));
  $('#vw-del').addEventListener('click', viewerDelete);
}

init();
