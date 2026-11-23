import {
  WEEKDAYS, MEALS, fmtClock, monthDay, dayKey, fromDayKey, fileStamp,
  relDay, mealLabel, mealFor, toLocalInput, fromLocalInput,
} from './format.js?v=8';
import { readExifDate } from './exif.js?v=8';
import { drawStamp, STYLES, COLORS, styleUsesColor } from './stamp.js?v=8';
import * as db from './db.js?v=8';

// 배포할 때 scripts/bump-version.sh 가 함께 올린다
const APP_VERSION = '8';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 저장본: 정사각형, 한 변 1080~2160px
const OUT_MIN = 1080;
const OUT_MAX = 2160;
const MAX_ZOOM = 3;
const JPEG_QUALITY = 0.92;
const RELAUNCH_AFTER = 3 * 60 * 1000; // 이만큼 쉬었다 돌아오면 ‘앱 열면 바로 카메라’를 다시 띄운다

/* ── 이 기기에만 남는 값 ── */

const local = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};

const SETTINGS_KEY = 'timestamp:settings';
const settings = {
  launchCamera: false,
  instantSave: false,
  saveOriginal: false,
  effects: true,
  stampStyle: 'basic', // 마지막에 쓴 스탬프 (즉시 저장도 이걸로)
  stampColor: 'white',
};
try { Object.assign(settings, JSON.parse(local.get(SETTINGS_KEY) || '{}')); } catch { /* 기본값 사용 */ }
if (!STYLES.some((s) => s.id === settings.stampStyle)) settings.stampStyle = 'basic';
if (!COLORS[settings.stampColor]) settings.stampColor = 'white';
const saveSettings = () => local.set(SETTINGS_KEY, JSON.stringify(settings));

/* ── 마스코트: 앱을 열 때마다 지난번과 다른 친구가 나온다 ── */

const ART = {
  odung: {
    camera: 'assets/mascots/odung-camera-v2.png',
    face: 'assets/mascots/odung-calendar-face-v7.png',
  },
  perpeng: {
    camera: 'assets/mascots/perpeng-camera-v2.png',
    face: 'assets/mascots/perpeng-calendar-face-v4.png',
  },
};

function chooseFamily() {
  const next = local.get('timestamp:family') === 'odung' ? 'perpeng' : 'odung';
  local.set('timestamp:family', next);
  return next;
}

const FILTERS = [['all', '전체'], ...MEALS];

const state = {
  family: chooseFamily(),
  face: null,
  records: [],
  thumbUrls: new Map(),
  fresh: new Set(),
  dbOk: true,
  view: 'album',
  filter: FILTERS.some(([id]) => id === local.get('timestamp:filter')) ? local.get('timestamp:filter') : 'all',
  month: null,
  selectedDay: null,
  todayKey: dayKey(new Date()),
  hiddenAt: 0,
};
const art = ART[state.family];

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
  bindPull();
  bindScrollState();
  bindEditor();
  bindViewer();
  fillSettings();
  renderAll();
  $('#app-version').textContent = `TimeStamp 버전 ${APP_VERSION}. 화면을 아래로 당기면 새로고침하면서 새 버전도 받아요.`;
  window.__tsBooted = true;
  try { sessionStorage.removeItem('timestamp:healed'); } catch { /* 없어도 된다 */ }
  if (settings.launchCamera) openLaunch();

  faceReady();
  fontsReady();
  await loadRecords();
  renderAll();

  setInterval(() => tick(), 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { state.hiddenAt = Date.now(); return; }
    tick();
    if (settings.launchCamera && !openSheets.length && state.hiddenAt && Date.now() - state.hiddenAt > RELAUNCH_AFTER) openLaunch();
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// 마스코트 스탬프에 쓸 얼굴
let faceLoading = null;
function faceReady() {
  if (!faceLoading) {
    faceLoading = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { state.face = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = art.face;
    });
  }
  return faceLoading;
}

// 캔버스에 쓸 글꼴을 미리 받아 둔다
let fontsLoading = null;
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  if (!fontsLoading) {
    const sample = '0123456789:() ·년월일화수목금토오전후아침점심저녁간식사';
    const family = '"Pretendard Variable"';
    fontsLoading = Promise.race([
      Promise.all([600, 700, 800].map((w) => document.fonts.load(`${w} 44px ${family}`, sample))),
      wait(2500),
    ]).catch(() => {});
  }
  return fontsLoading;
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
  }
}

/* ── 셔터 소리 · 스탬프 효과 ── */

let audioCtx = null;

// 아이폰은 손가락으로 누른 순간에만 소리를 켤 수 있다
function unlockAudio() {
  if (!settings.effects) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

// ‘탁’ 하는 도장 소리: 낮게 떨어지는 울림 + 짧은 마찰음
function playStampSound() {
  if (!settings.effects || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime + 0.01;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(58, t + 0.13);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  const len = Math.floor(audioCtx.sampleRate * 0.045);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1700;
  const ngain = audioCtx.createGain();
  ngain.gain.value = 0.28;
  noise.connect(filter).connect(ngain).connect(audioCtx.destination);
  noise.start(t);
}

const easeOutBack = (p) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

/* ── 당겨서 새로고침 (PT Note) ──
   맨 위에서 당기면 화면 전체가 고무줄처럼 무겁게 따라 내려오고, 다음 마스코트 얼굴이 굴러 들어온다.
   덜 당기고 놓으면 튕기듯 제자리로, 충분히 당기고 놓으면 조금 내려온 채로 새로고침한다. */

const PULL_READY = 72; // 화면이 이만큼 내려오면 놓을 준비가 된다
const PULL_HOLD = 60; // 새로고침하는 동안 내려와 있는 높이 (알약이 딱 제자리에 오는 높이)
const SPRING = 'transform .42s cubic-bezier(.22, .8, .25, 1)'; // PT Note 탭 렌즈 곡선, 넘치지 않는다
let refreshing = false;
let pillTimer = 0;

function setRefreshState(s) {
  if (s) document.documentElement.dataset.refreshState = s;
  else delete document.documentElement.dataset.refreshState;
}

// 헤더까지 포함한 화면 전체가 내려온다. 맨 위에서는 헤더가 투명해서 배경과 끊기지 않는다.
// 알약은 드러난 틈 안에서 칩보다 16px 위를 따라 내려오다가 잡는 높이에서 제자리에 멈춘다.
function setPullOffset(y, animate) {
  const main = $('#main');
  const pill = $('#pull');
  const spring = animate && !reducedMotion();
  main.style.transition = spring ? SPRING : 'none';
  main.style.transform = y > 0 ? `translate3d(0, ${y.toFixed(1)}px, 0)` : '';
  pill.style.transition = spring ? `${SPRING}, opacity .3s ease` : 'none';
  pill.style.transform = `translate3d(0, ${Math.min(0, y - PULL_HOLD).toFixed(1)}px, 0)`;
  pill.style.opacity = clamp((y - 12) / 36, 0, 1).toFixed(3);
}

function hidePillSoon() {
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => {
    if (refreshing || document.documentElement.dataset.refreshState) return;
    const pill = $('#pull');
    pill.hidden = true;
    for (const p of ['transform', 'opacity', 'transition']) pill.style.removeProperty(p);
  }, 450);
}

// 맨 위에서는 헤더가 투명, 사진이 밑으로 지나가면 유리 + 가는 선
function bindScrollState() {
  const root = document.documentElement;
  let queued = false;
  const update = () => { queued = false; root.classList.toggle('is-scrolled', window.scrollY > 2); };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function bindPull() {
  const pill = $('#pull');
  const label = $('#pull-label');
  const next = state.family === 'odung' ? 'perpeng' : 'odung';
  const name = next === 'odung' ? '오둥이' : '퍼펭이';
  pill.dataset.family = next;
  $('#pull-face').src = ART[next].face;
  pill.refreshLabel = `${name} 오는 중`;

  let startY = null;
  let pulling = false;
  let ready = false;

  // 아이폰의 고무줄 공식: 당길수록 덜 따라온다
  const rubber = (dy) => {
    const d = window.innerHeight || 800;
    return (1 - 1 / ((dy * 0.55) / d + 1)) * d;
  };

  const release = () => {
    startY = null;
    pulling = false;
    ready = false;
    if (refreshing) return;
    setRefreshState(null);
    setPullOffset(0, true);
    hidePillSoon();
  };

  document.addEventListener('touchstart', (e) => {
    if (refreshing || openSheets.length || e.touches.length !== 1 || window.scrollY > 0) { startY = null; return; }
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY === null || refreshing) return;
    if (e.touches.length !== 1) { if (pulling) release(); return; }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (pulling) release(); return; }
    pulling = true;
    clearTimeout(pillTimer);
    const offset = rubber(dy);
    setPullOffset(offset, false);
    pill.style.setProperty('--pull', Math.min(1, offset / PULL_READY).toFixed(3));
    pill.hidden = false;
    const nowReady = offset >= PULL_READY;
    if (nowReady !== ready || !document.documentElement.dataset.refreshState) {
      ready = nowReady;
      setRefreshState(ready ? 'ready' : 'pulling');
      label.textContent = ready ? `놓으면 ${name}가 와요` : `당겨서 ${name} 부르기`;
    }
  }, { passive: true });

  const end = () => {
    if (!pulling) { startY = null; return; }
    if (ready) { startY = null; pulling = false; refreshApp(); } else release();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', release, { passive: true });

  $('#refresh-now').addEventListener('click', () => { closeSheet($('#settings')); refreshApp(); });
}

async function refreshApp() {
  if (refreshing) return;
  refreshing = true;
  const pill = $('#pull');
  const label = $('#pull-label');
  clearTimeout(pillTimer);
  pill.style.setProperty('--pull', '1');
  // 설정 › 새로고침으로 왔을 때: 화면과 함께 위에서 미끄러져 들어온다
  if (pill.hidden) { setPullOffset(0, false); pill.hidden = false; void pill.offsetWidth; }
  setPullOffset(PULL_HOLD, true);

  if (navigator.onLine === false) {
    setRefreshState('error');
    label.textContent = '연결을 확인해 주세요';
    await wait(1600);
    refreshing = false;
    setRefreshState(null);
    setPullOffset(0, true);
    hidePillSoon();
    return;
  }

  setRefreshState('refreshing');
  label.textContent = pill.refreshLabel;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await Promise.race([reg?.update(), wait(1500)]);
  } catch { /* 새 버전 확인은 못 해도 다시 불러오면 된다 */ }
  await wait(650); // 마스코트가 뒤뚱거리는 모습이 잠깐 보이도록
  setRefreshState('settling');
  location.reload();
}

/* ── 이벤트 ── */

function bindEvents() {
  document.addEventListener('pointerdown', unlockAudio, { capture: true });

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) { showView(tab.dataset.view); return; }
    const filter = e.target.closest('[data-filter]');
    if (filter) { setFilter(filter.dataset.filter); return; }
    if (e.target.closest('[data-add]')) { openInput('#input-photo'); return; }
    const photo = e.target.closest('[data-id]');
    if (photo) { openViewer(photo.dataset.id); return; }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      state.selectedDay = day.dataset.day;
      renderCalendar();
      renderDay();
    }
  });

  $('#add').addEventListener('click', () => openInput('#input-photo'));
  $('#input-photo').addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  $('#input-camera').addEventListener('change', (e) => handleFile(e.target.files?.[0]));

  $('#launch-shoot').addEventListener('click', () => { closeSheet($('#launch')); openInput('#input-camera'); });
  $('#launch-album').addEventListener('click', () => { closeSheet($('#launch')); openInput('#input-photo'); });

  $('#open-settings').addEventListener('click', () => { renderStorageNote(); openSheet($('#settings')); });

  $('#mon-prev').addEventListener('click', () => shiftMonth(-1));
  $('#mon-next').addEventListener('click', () => shiftMonth(1));

  for (const input of $$('[data-setting]')) {
    input.addEventListener('change', () => {
      settings[input.dataset.setting] = input.checked;
      saveSettings();
      if (input.dataset.setting === 'effects' && input.checked) { unlockAudio(); playStampSound(); }
    });
  }

  $('#toast-send').addEventListener('click', toastSend);

  for (const sheet of $$('.sheet')) {
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close]')) requestClose(sheet);
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(sheet); }
    });
  }
}

// #input-photo: 아이폰이 ‘사진 보관함 · 사진 찍기 · 파일 선택’ 메뉴를 띄운다
// #input-camera: 기본 카메라를 바로 연다
function openInput(sel) {
  const input = $(sel);
  input.value = '';
  input.click();
}

function handleFile(file) {
  if (!file) return;
  if (settings.instantSave) quickSave(file);
  else startEdit(file);
}

function showView(view) {
  state.view = view;
  $('#view-album').hidden = view !== 'album';
  $('#view-calendar').hidden = view !== 'calendar';
  for (const tab of $$('.tab')) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('on', on);
    if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

function setFilter(id) {
  state.filter = id;
  local.set('timestamp:filter', id);
  renderAlbum();
}

function shiftMonth(delta) {
  const m = state.month;
  state.month = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  renderCalendar();
}

function fillSettings() {
  for (const input of $$('[data-setting]')) input.checked = Boolean(settings[input.dataset.setting]);
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
    target?.focus({ preventScroll: true, focusVisible: false });
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

function openLaunch() {
  const now = new Date();
  $('#launch-t').innerHTML = `${mealLabel(mealFor(now))} 사진을<br>찍어 볼까요?`;
  $('#launch-date').textContent = `${monthDay(now)} ${fmtClock(now)}`;
  openSheet($('#launch'));
}

/* ── 알림 ── */

let toastTimer = 0;
let toastFile = null;
let toastRecordId = null;

function showToast(text, { file = null, recordId = null, pop = false, stay = false } = {}) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  $('#toast-text').textContent = text;
  toastFile = file;
  toastRecordId = recordId;
  $('#toast-send').hidden = !file;
  el.classList.remove('pop');
  el.hidden = false;
  if (pop && settings.effects && !reducedMotion()) {
    void el.offsetWidth;
    el.classList.add('pop');
  }
  if (!stay) toastTimer = setTimeout(hideToast, file ? 6000 : 3000);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
  toastFile = null;
  toastRecordId = null;
}

async function toastSend() {
  if (!toastFile) return;
  const file = toastFile;
  const id = toastRecordId;
  clearTimeout(toastTimer);
  const result = await shareFiles([file]);
  if (result === 'cancelled') { toastTimer = setTimeout(hideToast, 4000); return; }
  if (result === 'retry') { showToast('한 번 더 눌러 주세요', { file, recordId: id, stay: true }); return; }
  if (result === 'error') { showToast('공유 화면을 열지 못했어요'); return; }
  const rec = state.records.find((r) => r.id === id);
  if (rec) await updateRecord({ ...rec, sentAt: Date.now() });
  showToast(result === 'downloaded' ? '사진을 내려받았어요' : '보냈어요');
}

/* ── 기록 데이터 ── */

const recordsOn = (key) => state.records.filter((r) => r.day === key).sort((a, b) => b.takenAt - a.takenAt);

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

async function updateRecord(rec) {
  try {
    await db.put(rec);
  } catch {
    return false;
  }
  upsertRecord(rec);
  renderAll();
  return true;
}

function statusText(rec) {
  if (rec.sentAt) return '보냈어요';
  if (rec.savedAt) return '저장했어요';
  return '';
}

const stampedName = (date) => `TimeStamp_${fileStamp(date)}.jpg`;

function originalFile(blob, date) {
  const type = blob.type || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('heic') ? 'heic' : 'jpg';
  return new File([blob], `TimeStamp_${fileStamp(date)}_원본.${ext}`, { type });
}

/* ── 화면 그리기 ── */

function renderAll() {
  renderAlbum();
  renderCalendar();
  renderDay();
}

function tileHtml(r, animate) {
  const t = new Date(r.takenAt);
  const label = `${monthDay(t)} ${mealLabel(r.meal) || ''} ${fmtClock(t)} 사진 보기`.replace(/\s+/g, ' ');
  const fresh = animate && state.fresh.has(r.id) ? ' is-new' : '';
  return `<button class="tile${fresh}" type="button" data-id="${r.id}" aria-label="${label}"><img src="${thumbUrl(r)}" alt="" loading="lazy"></button>`;
}

const CAMERA_SVG = $('#add svg').outerHTML;

// 앨범: 윗줄엔 끼니 칩과 설정만. 오늘 날짜는 첫 묶음 머리글로 한 번만 (크게, 이게 화면의 제목)
function renderAlbum() {
  const has = state.records.length > 0;
  $('#album-intro').hidden = has;
  $('#filters').hidden = !has;

  const counts = { all: state.records.length };
  for (const r of state.records) if (r.meal) counts[r.meal] = (counts[r.meal] || 0) + 1;
  $('#filters').innerHTML = FILTERS.map(([id, label]) =>
    `<button class="chip" type="button" data-filter="${id}" aria-pressed="${state.filter === id}" aria-label="${label} ${counts[id] || 0}장">${label}<small>${counts[id] || 0}</small></button>`).join('');

  const list = state.records.filter((r) => state.filter === 'all' || r.meal === state.filter);
  const byDay = new Map();
  for (const r of list) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  const todayKey = dayKey(new Date());
  const keys = [...byDay.keys()].sort().reverse();
  // 오늘 아직 없으면 오늘 묶음에 ‘찍기’ 칸 하나
  if (has && state.filter === 'all' && !byDay.has(todayKey)) keys.unshift(todayKey);
  const animate = settings.effects && !reducedMotion();
  $('#album-grid').innerHTML = keys.map((key) => {
    const items = (byDay.get(key) || []).sort((a, b) => b.takenAt - a.takenAt);
    const d = fromDayKey(key);
    const rel = relDay(d);
    const badge = rel === '오늘' || rel === '어제' ? `<em>${rel}</em>` : '';
    const count = items.length ? `<b>${items.length}</b>장` : '아직 없어요';
    const tiles = items.length ? items.map((r) => tileHtml(r, animate)).join('')
      : `<button class="tile tile-add" type="button" data-add aria-label="오늘 사진 찍거나 고르기">${CAMERA_SVG}</button>`;
    return `<section aria-label="${monthDay(d)}"><div class="grid-day${key === todayKey ? ' is-today' : ''}"><h2>${monthDay(d)}${badge}</h2><span>${count}</span></div>`
      + `<div class="grid">${tiles}</div></section>`;
  }).join('');

  const emptyFilter = has && list.length === 0;
  $('#filter-empty').hidden = !emptyFilter;
  if (emptyFilter) $('#filter-empty-text').textContent = `아직 ${mealLabel(state.filter)} 사진이 없어요.`;
  state.fresh.clear();
}

// 달력: 사진을 남긴 날에는 마스코트 얼굴 스탬프 (PT Note 주간 스탬프처럼)
function renderCalendar() {
  const m = state.month;
  const y = m.getFullYear();
  const mo = m.getMonth();
  const now = new Date();
  const prefix = `${y}-${String(mo + 1).padStart(2, '0')}`;
  $('#mon-t').textContent = y === now.getFullYear() ? `${mo + 1}월` : `${y}년 ${mo + 1}월`;
  $('#mon-next').disabled = y === now.getFullYear() && mo === now.getMonth();

  const counts = new Map();
  for (const r of state.records) counts.set(r.day, (counts.get(r.day) || 0) + 1);
  const monthDays = [...counts.keys()].filter((k) => k.startsWith(prefix)).length;
  $('#mon-sum').innerHTML = monthDays ? `<b>${monthDays}</b>일 남겼어요` : '아직 기록이 없어요';

  const todayKey = dayKey(now);
  const first = new Date(y, mo, 1).getDay();
  const last = new Date(y, mo + 1, 0).getDate();

  let html = WEEKDAYS.map((w, i) => `<div class="hd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" aria-hidden="true">${w}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div aria-hidden="true"></div>';
  for (let d = 1; d <= last; d++) {
    const key = dayKey(new Date(y, mo, d));
    const n = counts.get(key) || 0;
    const future = key > todayKey;
    const selected = key === state.selectedDay;
    const cls = ['num', key === todayKey && 'today', selected && 'selected', future && 'off', n && 'has'].filter(Boolean).join(' ');
    const label = `${mo + 1}월 ${d}일${n ? `, 사진 ${n}장` : ''}`;
    html += `<button class="day" type="button" data-day="${key}" aria-pressed="${selected}" aria-label="${label}"${future ? ' disabled' : ''}>`
      + `<span class="${cls}">${d}</span>`
      + (n ? `<img class="day-stamp" src="${art.face}" alt="" aria-hidden="true">` : '')
      + '</button>';
  }
  $('#cal').innerHTML = html;
}

function renderDay() {
  const d = fromDayKey(state.selectedDay);
  const list = recordsOn(state.selectedDay);
  const rel = relDay(d);
  $('#day-title').innerHTML = `${monthDay(d)}${rel === '오늘' || rel === '어제' ? `<em>${rel}</em>` : ''}`;
  $('#day-count').innerHTML = list.length ? `<b>${list.length}</b>장` : '';
  $('#day-empty').hidden = list.length > 0;
  $('#day-grid').innerHTML = list.map((r) => tileHtml(r, false)).join('');
}

async function renderStorageNote() {
  const n = state.records.length;
  const originals = state.records.filter((r) => r.original).length;
  let size = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) size = ` · 약 ${Math.max(1, Math.round(est.usage / 1048576))}MB`;
  } catch { /* 크기는 못 보여 줘도 된다 */ }
  const base = n ? `사진 ${n}장${originals ? `(원본 ${originals}장 포함)` : ''}${size}` : '아직 남긴 사진이 없어요';
  $('#storage-note').textContent = `${base}. 이 아이폰에만 저장돼서 다른 기기에서는 보이지 않아요.`;
}

/* ── 사진 읽기 · 스탬프 찍기 (스탬프 화면과 즉시 저장이 함께 쓴다) ── */

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

// 촬영 시각: EXIF → 파일 시각(1분 넘게 차이 날 때만) → 지금
async function readPhoto(file) {
  const [{ img, url }, exifDate] = await Promise.all([loadPhoto(file), readExifDate(file), fontsReady(), faceReady()]);
  let takenAt;
  let timeSource;
  if (exifDate) { takenAt = exifDate; timeSource = 'exif'; }
  else if (file.lastModified && Math.abs(Date.now() - file.lastModified) > 60000) { takenAt = new Date(file.lastModified); timeSource = 'file'; }
  else { takenAt = new Date(); timeSource = 'now'; }
  return { img, url, takenAt, timeSource, W0: img.naturalWidth, H0: img.naturalHeight };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality);
  });
}

async function renderStamped(img, rect, info, look) {
  const S = clamp(Math.round(rect.side), OUT_MIN, OUT_MAX);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.side, rect.side, 0, 0, S, S);
  drawStamp(ctx, S, info, look);
  const blob = await canvasBlob(c, 'image/jpeg', JPEG_QUALITY);

  const t = document.createElement('canvas');
  t.width = 360;
  t.height = 360;
  const tctx = t.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(c, 0, 0, 360, 360);
  const thumb = await canvasBlob(t, 'image/jpeg', 0.8);
  c.width = c.height = 1;
  t.width = t.height = 1;
  return { file: new File([blob], stampedName(info.date), { type: 'image/jpeg', lastModified: info.date.getTime() }), thumb, size: S };
}

// 공유 화면을 연다. 공유를 못 쓰는 브라우저에서는 파일로 내려받는다.
async function shareFiles(files) {
  let list = files;
  if (navigator.canShare && list.length > 1 && !navigator.canShare({ files: list })) list = [files[0]];
  if (navigator.canShare && navigator.canShare({ files: list })) {
    try {
      await navigator.share({ files: list });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      if (err?.name === 'NotAllowedError') return 'retry';
      return 'error';
    }
  }
  for (const f of list) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return 'downloaded';
}

// ‘앨범에 저장’은 설정에 따라 원본도 함께, ‘보내기’는 스탬프 사진만
function filesFor(kind, stamped, original, date) {
  const files = [stamped];
  if (kind === 'save' && settings.saveOriginal && original) files.push(originalFile(original, date));
  return files;
}

function resultText(kind, result, count) {
  if (result === 'downloaded') return kind === 'send' ? '사진을 내려받았어요. 카카오톡에서 골라 보내 주세요.' : '사진을 내려받았어요.';
  if (kind === 'send') return '보냈어요.';
  return count > 1 ? '스탬프 사진과 원본을 저장했어요.' : '저장했어요.';
}

/* ── 즉시 저장: 스탬프 화면 없이, 가운데를 정사각형으로, 마지막에 쓴 스탬프로 ── */

async function quickSave(file) {
  showToast('사진을 남기고 있어요', { stay: true });
  let photo;
  try {
    photo = await readPhoto(file);
    const side = Math.min(photo.W0, photo.H0);
    const rect = { x: (photo.W0 - side) / 2, y: (photo.H0 - side) / 2, side };
    const meal = mealFor(photo.takenAt);
    const look = { style: settings.stampStyle, color: settings.stampColor };
    const out = await renderStamped(photo.img, rect, { date: photo.takenAt, meal, face: state.face }, look);
    const rec = {
      id: uid(),
      takenAt: photo.takenAt.getTime(),
      day: dayKey(photo.takenAt),
      meal,
      style: look.style,
      width: out.size,
      height: out.size,
      blob: out.file,
      thumb: out.thumb,
      original: settings.saveOriginal ? file : null,
      createdAt: Date.now(),
      savedAt: null,
      sentAt: null,
    };
    let kept = false;
    if (state.dbOk) {
      try { await db.put(rec); kept = true; } catch { kept = false; }
    }
    if (kept) {
      upsertRecord(rec);
      state.fresh.add(rec.id);
      if (state.view !== 'album') showView('album');
      if (state.filter !== 'all' && state.filter !== meal) state.filter = 'all';
      renderAll();
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    playStampSound();
    showToast(kept ? `${fmtClock(photo.takenAt)} 사진을 남겼어요` : '이 기기에는 남기지 못했어요', { file: out.file, recordId: kept ? rec.id : null, pop: true });
  } catch {
    showToast('사진을 열지 못했어요. 다시 시도해 주세요');
  } finally {
    if (photo?.url) URL.revokeObjectURL(photo.url);
  }
}

/* ── 스탬프 화면 ── */

let ed = null;
const E = {
  sheet: $('#editor'),
  preview: $('#preview'),
  skel: $('#preview-skel'),
  canvas: $('#preview-canvas'),
  hint: $('#ed-hint'),
  reset: $('#crop-reset'),
  strip: $('#style-strip'),
  swatches: $('#swatches'),
  time: $('#ed-time'),
  timeText: $('#ed-time-text'),
  timeNote: $('#ed-time-note'),
  seg: $('#meal-seg'),
  msg: $('#ed-msg'),
  save: $('#ed-save'),
  send: $('#ed-send'),
};

// 시각을 지어내지 않는다: 사진에 시각이 없을 때만 알려 준다
const TIME_NOTES = {
  file: '파일에 남은 시각이에요. 맞는지 확인해 주세요.',
  now: '사진에 촬영 시각이 없어 지금 시각을 넣었어요.',
};

const infoOf = (e) => ({ date: e.takenAt, meal: e.meal, face: state.face });
const lookOf = (e, pop = null) => ({ style: e.style, color: e.color, pop });

async function startEdit(file) {
  const mine = {
    id: uid(), createdAt: Date.now(), version: 0, job: null, timer: 0, source: file,
    file: null, thumb: null, savedAt: null, sentAt: null, persistedVersion: null,
    meal: null, mealAuto: true, ready: false, crop: null, cropMoved: false,
    style: settings.stampStyle, color: settings.stampColor,
  };
  ed = mine;
  E.canvas.hidden = true;
  E.skel.hidden = false;
  E.reset.hidden = true;
  E.save.disabled = true;
  E.send.disabled = true;
  E.timeText.textContent = '';
  E.timeNote.hidden = true;
  E.hint.classList.remove('gone');
  showMsg(E.msg, '', '');
  buildStrip();
  openSheet(E.sheet);

  try {
    const photo = await readPhoto(file);
    if (ed !== mine) { URL.revokeObjectURL(photo.url); return; }
    Object.assign(mine, photo);
    mine.meal = mealFor(mine.takenAt);
    mine.crop = { cx: mine.W0 / 2, cy: mine.H0 / 2, z: 1 };

    buildPreview(mine);
    mine.ready = true;

    E.skel.hidden = true;
    E.canvas.hidden = false;
    E.save.disabled = false;
    E.send.disabled = false;
    fillFields();
    stampIn();
    drawThumbs();
    markDirty();
    setTimeout(() => { if (ed === mine) E.hint.classList.add('gone'); }, 2600);
  } catch {
    if (ed !== mine) return;
    E.skel.hidden = true;
    showMsg(E.msg, 'err', '사진을 열지 못했어요. 다른 사진으로 다시 시도해 주세요.');
  }
}

// 스탬프 모양 고르기: 내 사진으로 그린 작은 미리보기 6개
function buildStrip() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const px = Math.round(66 * dpr);
  E.strip.innerHTML = STYLES.map((s) =>
    `<button class="style-btn" type="button" role="radio" data-style="${s.id}" aria-checked="${s.id === ed.style}"><canvas width="${px}" height="${px}" aria-hidden="true"></canvas>${s.label}</button>`).join('');
}

let thumbTimer = 0;
function drawThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (!ed?.base) return;
    const r = cropRect(ed);
    const k = ed.baseK;
    for (const btn of $$('.style-btn', E.strip)) {
      const c = btn.querySelector('canvas');
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(ed.base, r.x * k, r.y * k, r.side * k, r.side * k, 0, 0, c.width, c.height);
      drawStamp(ctx, c.width, infoOf(ed), { style: btn.dataset.style, color: ed.color });
    }
  }, 60);
}

function fillLook() {
  for (const b of $$('.style-btn', E.strip)) {
    const on = b.dataset.style === ed.style;
    b.setAttribute('aria-checked', String(on));
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  for (const b of $$('[data-color]', E.swatches)) b.setAttribute('aria-checked', String(b.dataset.color === ed.color));
  E.swatches.classList.toggle('is-off', !styleUsesColor(ed.style));
}

function fillFields() {
  const d = ed.takenAt;
  const [ampm, hm] = fmtClock(d).split(' ');
  E.timeText.innerHTML = `${monthDay(d)} <small>${ampm}</small> ${hm}`;
  E.time.value = toLocalInput(d);
  E.time.max = toLocalInput(new Date(Date.now() + 60000));
  const note = TIME_NOTES[ed.timeSource];
  E.timeNote.hidden = !note;
  E.timeNote.textContent = note || '';
  for (const b of $$('button', E.seg)) {
    const id = b.dataset.meal === 'none' ? null : b.dataset.meal;
    b.setAttribute('aria-pressed', String(id === ed.meal));
  }
  fillLook();
}

// 스탬프 효과: 글씨가 크게 내려앉았다가 제자리에 멈춘다
function stampIn() {
  playStampSound();
  if (!settings.effects || reducedMotion()) { drawPreview(); return; }
  const mine = ed;
  const start = performance.now();
  const dur = 380;
  drawPreview({ scale: 1.45, alpha: 0 });
  // 화면이 잠시 가려져 애니메이션이 멈춰도 스탬프는 반드시 제자리에 그려 둔다
  setTimeout(() => { if (ed === mine) drawPreview(); }, dur + 120);
  const step = (now) => {
    if (ed !== mine || mine.gesturing) { drawPreview(); return; }
    const p = Math.min(1, (now - start) / dur);
    if (p >= 1) { drawPreview(); return; }
    drawPreview({ scale: 1.45 - 0.45 * easeOutBack(Math.max(0, p)), alpha: clamp(p * 3, 0, 1) });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 확대해도 흐려지지 않을 만큼만 줄인 미리보기용 사본
function buildPreview(e) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const css = Math.max(200, E.preview.clientWidth || 402);
  const P = Math.round(css * dpr);
  E.canvas.width = P;
  E.canvas.height = P;

  const minSide = Math.min(e.W0, e.H0);
  const k = Math.min(1, (P * 2.5) / minSide);
  const base = document.createElement('canvas');
  base.width = Math.max(1, Math.round(e.W0 * k));
  base.height = Math.max(1, Math.round(e.H0 * k));
  const bctx = base.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(e.img, 0, 0, base.width, base.height);
  e.base = base;
  e.baseK = base.width / e.W0;
}

// 원본 좌표의 정사각형 자르기 영역. 사진 밖으로 나가지 않게 가운데를 붙잡는다.
function cropRect(e) {
  const side = Math.min(e.W0, e.H0) / e.crop.z;
  e.crop.cx = clamp(e.crop.cx, side / 2, e.W0 - side / 2);
  e.crop.cy = clamp(e.crop.cy, side / 2, e.H0 - side / 2);
  return { x: e.crop.cx - side / 2, y: e.crop.cy - side / 2, side };
}

let frame = 0;
function schedulePreview() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; drawPreview(); });
}

function drawPreview(pop = null) {
  if (!ed?.base) return;
  const c = E.canvas;
  const ctx = c.getContext('2d');
  const r = cropRect(ed);
  const k = ed.baseK;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(ed.base, r.x * k, r.y * k, r.side * k, r.side * k, 0, 0, c.width, c.height);
  drawStamp(ctx, c.width, infoOf(ed), lookOf(ed, pop));
  E.reset.hidden = !ed.cropMoved;
}

// 스탬프·시각·식사·위치가 바뀌면 저장본을 다시 만든다
function changed({ thumbs = true } = {}) {
  drawPreview();
  if (thumbs) drawThumbs();
  markDirty();
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
  const p = renderStamped(e.img, cropRect(e), infoOf(e), lookOf(e)).then((out) => {
    if (e.version !== v) return null;
    e.file = out.file;
    e.thumb = out.thumb;
    e.outSize = out.size;
    return e.file;
  });
  e.job = { v, p };
  return p;
}

async function readyFile() {
  if (ed.file) return ed.file;
  clearTimeout(ed.timer);
  await exportFor(ed, ed.version);
  return ed.file;
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
  const files = filesFor(kind, file, mine.source, mine.takenAt);
  const result = await shareFiles(files);
  if (ed !== mine || result === 'cancelled') return;
  if (result === 'retry') { showMsg(E.msg, 'warn', '사진을 준비했어요. 한 번 더 눌러 주세요.'); return; }
  if (result === 'error') { showMsg(E.msg, 'err', '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }

  if (kind === 'save') mine.savedAt = Date.now(); else mine.sentAt = Date.now();
  const kept = await persistEdit(mine);
  if (ed !== mine) return;
  showMsg(E.msg, kept ? 'ok' : 'warn', `${resultText(kind, result, files.length)} ${kept ? '앨범 탭에도 남겼어요.' : '이 기기에는 기록을 남기지 못했어요.'}`);
}

async function persistEdit(e) {
  if (!state.dbOk || !e.file) return false;
  const isNew = e.persistedVersion === null;
  const rec = {
    id: e.id,
    takenAt: e.takenAt.getTime(),
    day: dayKey(e.takenAt),
    meal: e.meal,
    style: e.style,
    width: e.outSize,
    height: e.outSize,
    blob: e.file,
    thumb: e.thumb,
    original: settings.saveOriginal ? e.source : null,
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
  if (isNew) state.fresh.add(rec.id);
  renderAll();
  return true;
}

function closeEditor() {
  if (ed?.ready) {
    if (ed.persistedVersion === null) {
      if (!window.confirm('이 사진은 아직 저장하지 않았어요. 닫을까요?')) return;
    } else if (ed.persistedVersion !== ed.version) {
      if (!window.confirm('저장한 뒤에 바꾼 내용은 앨범에 남지 않아요. 닫을까요?')) return;
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

  E.strip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-style]');
    if (!b || !ed?.ready || b.dataset.style === ed.style) return;
    ed.style = b.dataset.style;
    settings.stampStyle = ed.style;
    saveSettings();
    fillLook();
    stampIn();
    markDirty();
  });

  E.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || !ed?.ready || b.dataset.color === ed.color) return;
    ed.color = b.dataset.color;
    settings.stampColor = ed.color;
    saveSettings();
    fillLook();
    changed();
  });

  E.seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-meal]');
    if (!b || !ed?.ready) return;
    ed.meal = b.dataset.meal === 'none' ? null : b.dataset.meal;
    ed.mealAuto = false;
    fillFields();
    changed(); // 식단 스탬프에는 끼니가 찍힌다
  });

  E.time.addEventListener('change', () => {
    if (!ed?.ready) return;
    const d = fromLocalInput(E.time.value);
    if (!d) { fillFields(); return; }
    ed.takenAt = d;
    ed.timeSource = 'edited';
    if (ed.mealAuto) ed.meal = mealFor(d);
    fillFields();
    changed();
  });

  E.reset.addEventListener('click', () => {
    if (!ed?.ready) return;
    ed.crop = { cx: ed.W0 / 2, cy: ed.H0 / 2, z: 1 };
    ed.cropMoved = false;
    changed();
  });

  // 한 손가락: 옮기기, 두 손가락: 확대
  const pointers = new Map();
  let gesture = null;
  const center = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  const spread = (pts) => (pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0);

  const beginGesture = () => {
    const pts = [...pointers.values()];
    gesture = {
      n: pts.length, p: center(pts), d: spread(pts),
      cx: ed.crop.cx, cy: ed.crop.cy, z: ed.crop.z, moved: gesture?.moved || false,
    };
  };

  E.preview.addEventListener('pointerdown', (e) => {
    if (!ed?.ready) return;
    e.preventDefault();
    E.preview.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    E.preview.classList.add('grabbing');
    E.hint.classList.add('gone');
    ed.gesturing = true;
    beginGesture();
  });

  E.preview.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture || !ed?.ready) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length !== gesture.n) { beginGesture(); return; }
    const c = center(pts);
    let z = gesture.z;
    if (pts.length > 1 && gesture.d > 0) z = clamp(gesture.z * (spread(pts) / gesture.d), 1, MAX_ZOOM);
    const cssSize = E.canvas.getBoundingClientRect().width || 1;
    const k = Math.min(ed.W0, ed.H0) / z / cssSize;
    ed.crop = { z, cx: gesture.cx - (c.x - gesture.p.x) * k, cy: gesture.cy - (c.y - gesture.p.y) * k };
    if (Math.abs(c.x - gesture.p.x) + Math.abs(c.y - gesture.p.y) > 2 || z !== gesture.z) gesture.moved = true;
    schedulePreview();
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) { beginGesture(); return; }
    E.preview.classList.remove('grabbing');
    const moved = gesture?.moved;
    gesture = null;
    if (!ed?.ready) return;
    ed.gesturing = false;
    if (moved) {
      ed.cropMoved = true;
      changed();
    }
  };
  E.preview.addEventListener('pointerup', endPointer);
  E.preview.addEventListener('pointercancel', endPointer);

  // Mac 미리보기용: 휠로 확대
  E.preview.addEventListener('wheel', (e) => {
    if (!ed?.ready) return;
    e.preventDefault();
    ed.crop.z = clamp(ed.crop.z * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
    ed.cropMoved = true;
    schedulePreview();
    drawThumbs();
    markDirty();
  }, { passive: false });
}

/* ── 사진 보기 ── */

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
  V.sub.textContent = `${fmtClock(d)}${status ? ` · ${status}` : ''}`;
}

function openViewer(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) return;
  const d = new Date(rec.takenAt);
  vw = {
    rec,
    url: URL.createObjectURL(rec.blob),
    file: new File([rec.blob], stampedName(d), { type: 'image/jpeg', lastModified: rec.takenAt }),
  };
  viewerTitles(rec);
  V.img.src = vw.url;
  V.img.alt = `${monthDay(d)} ${fmtClock(d)}에 찍은 ${mealLabel(rec.meal) || ''} 사진`.replace(/\s+/g, ' ');
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
  const files = filesFor(kind, mine.file, mine.rec.original, new Date(mine.rec.takenAt));
  const result = await shareFiles(files);
  if (vw !== mine || result === 'cancelled') return;
  if (result === 'retry') { showMsg(V.msg, 'warn', '한 번 더 눌러 주세요.'); return; }
  if (result === 'error') { showMsg(V.msg, 'err', '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
  const rec = { ...mine.rec, [kind === 'save' ? 'savedAt' : 'sentAt']: Date.now() };
  if (await updateRecord(rec)) {
    mine.rec = rec;
    if (vw === mine) viewerTitles(rec);
  }
  if (vw === mine) showMsg(V.msg, 'ok', resultText(kind, result, files.length));
}

async function viewerDelete() {
  if (!vw) return;
  if (!window.confirm('이 사진을 앱에서 지울까요? 아이폰 앨범에 저장한 사진은 그대로 남아요.')) return;
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
