import {
  WEEKDAYS, MEALS, fmtClock, monthDay, dayKey, fromDayKey, fileStamp,
  relDay, mealLabel, mealFor, toLocalInput, fromLocalInput,
} from './format.js?v=100';
import { readExifDate } from './exif.js?v=100';
import { drawStamp, characterBox, SEAL_RING, SEAL_DISC, STYLES, COLORS, styleUsesColor } from './stamp.js?v=100';
import * as db from './db.js?v=100';

// 배포할 때 scripts/bump-version.sh 가 함께 올린다
const APP_VERSION = '100';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 저장본: 정사각형, 한 변 1080~1620px (캐릭터 그림이 흐려지지 않는 크기, 카카오톡 전송에도 충분)
const OUT_MIN = 1080;
const OUT_MAX = 1620;
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
  photoTime: true, // 사진에 남은 촬영 시각(EXIF)을 쓴다. 끄면 지금 시각
  effects: true,
  stampStyle: null, // 마지막에 쓴 스탬프 (즉시 저장도 이걸로). 처음엔 그날의 캐릭터
  stampColor: 'white',
};
try { Object.assign(settings, JSON.parse(local.get(SETTINGS_KEY) || '{}')); } catch { /* 기본값 사용 */ }
if (!COLORS[settings.stampColor]) settings.stampColor = 'white';
const saveSettings = () => local.set(SETTINGS_KEY, JSON.stringify(settings));

/* ── 마스코트: 앱을 열 때마다 지난번과 다른 친구가 나온다 ── */

const ART = {
  odung: {
    camera: 'assets/mascots/odung-camera-v2.png',
    face: 'assets/mascots/odung-calendar-face-v7.png',
    hero: 'assets/art/odung-hero.png', // 앱 아이콘과 같은 그림 (첫 화면 · 시작 화면)
    empty: 'assets/art/odung-empty.png', // 빈 접시 (사진이 없는 끼니 · 날)
    album: 'assets/art/album/odung.png', // 카메라를 길게 누르면 뜨는 ‘앨범에서 고르기’: 앨범 든 오둥이
  },
  perpeng: {
    camera: 'assets/mascots/perpeng-camera-v2.png',
    face: 'assets/mascots/perpeng-calendar-face-v4.png',
    hero: 'assets/art/perpeng-hero.png',
    empty: 'assets/art/perpeng-empty.png',
    album: 'assets/art/album/perpeng.png',
  },
};

// 캐릭터 스탬프에 그때그때 다르게 나오는 모습들 (PT Note 디자인 시스템 그림)
const POSES = {
  odung: ['assets/mascots/odung-camera-v2.png', ...['summary', 'strength', 'running', 'stairs', 'pt', 'solo', 'fullbody'].map((p) => `assets/poses/odung-${p}.png`)],
  perpeng: ['assets/mascots/perpeng-camera-v2.png', ...['summary', 'running', 'stairs', 'pt', 'solo', 'fullbody', 'chest', 'arms'].map((p) => `assets/poses/perpeng-${p}.png`)],
};

function chooseFamily() {
  const next = local.get('timestamp:family') === 'odung' ? 'perpeng' : 'odung';
  local.set('timestamp:family', next);
  return next;
}

const FILTERS = [['all', '전체'], ...MEALS];

const state = {
  family: chooseFamily(),
  chars: {}, // 카메라 든 오둥이·퍼펭이 (캐릭터 스탬프에 쓴다)
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

// 캐릭터 스탬프가 기본: 처음이거나 예전 ‘마스코트’를 쓰던 사람은 그날의 캐릭터로 시작한다
if (!settings.charDefault || !STYLES.some((s) => s.id === settings.stampStyle)) {
  settings.stampStyle = state.family;
  settings.charDefault = true;
  local.set(SETTINGS_KEY, JSON.stringify(settings));
}

// 새로고침(당기기 · 새 버전 자동 적용)해도 보던 자리로 돌아온다. 앱을 새로 켜면 앨범부터.
const PLACE_KEY = 'timestamp:place';
function rememberPlace() {
  if (!state.month) return;
  const place = { view: state.view, month: state.month.getTime(), day: state.selectedDay, y: Math.round(window.scrollY) };
  try { sessionStorage.setItem(PLACE_KEY, JSON.stringify(place)); } catch { /* 못 남겨도 동작에는 지장 없음 */ }
}
function recallPlace() {
  try { return JSON.parse(sessionStorage.getItem(PLACE_KEY) || 'null'); } catch { return null; }
}
function reload() {
  rememberPlace();
  location.reload();
}

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
  const place = recallPlace();
  if (place) {
    if (Number.isFinite(place.month)) state.month = clampMonth(new Date(place.month));
    if (/^\d{4}-\d{2}-\d{2}$/.test(place.day || '') && place.day >= dayKey(FIRST_MONTH)) state.selectedDay = place.day;
    if (place.view === 'calendar') showView('calendar', { keepScroll: true });
  }

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

  charsReady();
  fontsReady();
  await loadRecords();
  renderAll();
  if (place?.y > 0) window.scrollTo({ top: place.y });
  window.addEventListener('pagehide', rememberPlace);

  setInterval(() => tick(), 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { state.hiddenAt = Date.now(); rememberPlace(); return; }
    tick();
    checkForUpdate();
    if (settings.launchCamera && !openSheets.length && state.hiddenAt && Date.now() - state.hiddenAt > RELAUNCH_AFTER) openLaunch();
  });
  setTimeout(checkForUpdate, 3000);

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// 앱으로 돌아올 때마다 새 버전이 있는지 보고, 있으면 그 자리에서 새로 불러온다.
// (홈 화면 앱은 켜 둔 채로 돌아오면 예전 화면이 그대로 남아 있기 때문)
let checkingUpdate = false;
async function checkForUpdate() {
  if (checkingUpdate || navigator.onLine === false) return;
  checkingUpdate = true;
  try {
    const res = await fetch(`index.html?check=${Date.now()}`, { cache: 'no-store' });
    const html = res.ok ? await res.text() : '';
    const latest = /app\.js\?v=(\d+)/.exec(html)?.[1];
    if (latest && latest !== APP_VERSION && !openSheets.length && !refreshing) {
      reload();
      return;
    }
  } catch { /* 확인 못 해도 지금 버전으로 계속 쓴다 */ }
  checkingUpdate = false;
}

// 캐릭터 스탬프에 쓸 여러 모습의 오둥이·퍼펭이를 모두 미리 받아 둔다
let charsLoading = null;
function charsReady() {
  if (!charsLoading) {
    // 고무 도장 고리와, 그 바깥선을 따라 만든 원판 (못 받으면 반듯한 원 + 가는 선 고리로)
    const sealPart = (holder, src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { holder.img = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
    const seal = [sealPart(SEAL_RING, 'assets/art/seal-ring-rough.png'), sealPart(SEAL_DISC, 'assets/art/seal-disc-rough.png')];
    charsLoading = Promise.all([...seal, ...Object.entries(POSES).flatMap(([who, list]) => list.map((src, i) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { (state.chars[who] ||= [])[i] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    })))]);
  }
  return charsLoading;
}

// 무작위로 한 모습. 바로 전과 같은 모습은 피한다.
function randomPose(who, avoid = -1) {
  const n = POSES[who].length;
  if (n < 2) return 0;
  let i = Math.floor(Math.random() * n);
  if (i === avoid) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
  return i;
}

function poseImages(pick) {
  const out = {};
  for (const who of Object.keys(POSES)) {
    const list = (state.chars[who] || []).filter(Boolean);
    out[who] = state.chars[who]?.[pick[who]] || list[0] || null;
  }
  return out;
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
    if (state.selectedDay === state.todayKey) {
      state.selectedDay = key;
      const now = new Date();
      state.month = new Date(now.getFullYear(), now.getMonth(), 1); // 자정에 달이 바뀌면 달력도 이번 달로
    }
    state.todayKey = key;
    renderAll();
  }
  renderTodayCard(state.records.length > 0, state.todayKey); // 끼니가 바뀌면 오늘 카드 문구도
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

const PULL_READY = 78; // 화면이 이만큼 내려오면 놓을 준비가 된다
const PULL_HOLD = 66; // 새로고침하는 동안 내려와 있는 높이 (알약이 딱 제자리에 오는 높이, 알약 아래 16px 틈)
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
  const update = () => {
    queued = false;
    const head = $('.view:not([hidden]) .page-head');
    root.classList.toggle('is-scrolled', window.scrollY > (head ? head.offsetHeight - 2 : 2));
  };
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
  reload();
}

/* ── 이벤트 ── */

function bindEvents() {
  document.addEventListener('pointerdown', unlockAudio, { capture: true });

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) { showView(tab.dataset.view); return; }
    const filter = e.target.closest('[data-filter]');
    if (filter) { setFilter(filter.dataset.filter); return; }
    if (e.target.closest('[data-add]')) { openInput('#input-camera'); return; }
    const slot = e.target.closest('[data-slot]');
    if (slot) { pickForSlot(slot); return; }
    const photo = e.target.closest('[data-id]');
    if (photo) { openViewer(photo.dataset.id); return; }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      state.selectedDay = day.dataset.day;
      renderCalendar();
      renderDay();
    }
  });

  // 가운데 카메라는 바로 촬영. 앨범에서 고르기는 앨범 탭 위 버튼으로 (자주 쓰지 않으니까)
  bindAddButton();
  $('#input-photo').addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  $('#input-camera').addEventListener('change', (e) => handleFile(e.target.files?.[0], { camera: true }));

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


  for (const sheet of $$('.sheet')) {
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close]')) requestClose(sheet);
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(sheet); }
    });
  }
}

// 가운데 카메라: 누르면 바로 촬영. 길게 누르면 버튼이 톡 튀며(안드로이드는 진동도) 바로 위에 ‘앨범에서 고르기’가 뜬다.
// 손을 뗀 뒤 그 버튼을 누른다. 아이폰은 ‘끌어서 놓기’로는 사진 고르기 창을 열어 주지 않아서(탭이어야 함),
// 누른 채 올려서 놓으면 메뉴를 그대로 띄워 두고 눌러 주기를 기다린다. 바깥을 누르면 닫힌다
const HOLD_MS = 420;
function bindAddButton() {
  const add = $('#add');
  const pop = $('#add-pop');
  const album = $('#add-album');
  let timer = 0;
  let held = false;
  let start = null;
  const overAlbum = (e) => Boolean(document.elementFromPoint(e.clientX, e.clientY)?.closest('#add-album'));
  const isOpen = () => !pop.hidden && !pop.classList.contains('is-closing');
  let closeTimer = 0;
  const openPop = () => {
    clearTimeout(closeTimer);
    pop.classList.remove('is-closing'); // 닫히며 내려가던 중이면 다시 솟아오른다
    pop.hidden = false;
    add.setAttribute('aria-expanded', 'true');
  };
  // 닫을 때는 카메라 버튼 뒤로 다시 들어간 다음에 숨긴다
  const closePop = () => {
    album.classList.remove('is-over');
    add.setAttribute('aria-expanded', 'false');
    if (!isOpen()) return;
    pop.classList.add('is-closing');
    closeTimer = setTimeout(() => { pop.hidden = true; pop.classList.remove('is-closing'); }, 200);
  };
  add.addEventListener('pointerdown', (e) => {
    held = false;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      held = true;
      buzz();
      add.classList.remove('is-held');
      void add.offsetWidth; // 다시 누를 때도 튀는 움직임이 처음부터
      add.classList.add('is-held');
      openPop();
    }, HOLD_MS);
  });
  add.addEventListener('pointermove', (e) => {
    if (!held && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) clearTimeout(timer); // 끌면 길게 누르기 취소
    if (held) album.classList.toggle('is-over', overAlbum(e));
  });
  add.addEventListener('pointerup', () => {
    clearTimeout(timer);
    start = null;
    album.classList.remove('is-over'); // 올려서 놓았어도 메뉴는 남겨 두고, 눌러서 고른다
  });
  add.addEventListener('pointercancel', () => { clearTimeout(timer); start = null; });
  add.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!held) { held = true; openPop(); } }); // 마우스 오른쪽 · 키보드 메뉴 키
  add.addEventListener('click', (e) => {
    if (held) { e.preventDefault(); held = false; return; } // 길게 누른 뒤의 클릭은 촬영이 아니다
    if (isOpen()) { closePop(); return; }
    openInput('#input-camera');
  });
  album.addEventListener('click', () => { closePop(); openInput('#input-photo'); });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !e.target.closest('#add-pop, #add')) closePop();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closePop(); });
}

// 살짝 진동: 진동을 허락하는 브라우저(안드로이드)에서만. 아이폰 웹앱은 누르고 있는 동안 진동을 낼 수 없다
function buzz() {
  try { navigator.vibrate?.(12); } catch { /* 진동이 없는 기기 */ }
}

// #input-photo: 사진 보관함에서 고른다
// #input-camera: 기본 카메라를 바로 연다
// target: 달력의 끼니 칸에서 열었을 때 그 날 · 끼니. 다른 곳에서 열면 지워져서 엉뚱한 칸에 들어가지 않는다
let pendingTarget = null;
function openInput(sel, { target = null } = {}) {
  pendingTarget = target;
  const input = $(sel);
  input.value = '';
  input.click();
}

function handleFile(file, { camera = false } = {}) {
  const target = pendingTarget;
  pendingTarget = null;
  if (!file) return;
  // 끼니 칸에서 고른 사진은 스탬프 화면 없이 그 칸에 바로 (있던 사진은 새 사진으로 바뀐다)
  if (target) quickSave(file, { target });
  else if (settings.instantSave) quickSave(file);
  else startEdit(file, { camera });
}

// 달력의 끼니 칸: 그림은 그대로 두고, 누르면 사진을 골라 그 칸에 바로 넣는다. 빈 칸은 올리기, 사진이 있는 칸은 바꾸기.
// 누른 순간에만 옅은 테두리가 잠깐 켜졌다 사라진다
// 오늘 칸은 아직 안 온 끼니를 미리 채우지 않게, 끼니 시간보다 2시간 앞서 열린다 (지난날은 언제든)
const SLOT_OPEN = { breakfast: 3, lunch: 9, dinner: 15 };
function slotOpensAt(day, meal) {
  if (day !== dayKey(new Date())) return null;
  const at = fromDayKey(day);
  at.setHours(SLOT_OPEN[meal] ?? 0, 0, 0, 0);
  return at.getTime() > Date.now() ? at : null;
}
const slotOpenNote = (meal, at) => {
  const h = at.getHours();
  return `${mealLabel(meal)}은 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시부터 올릴 수 있어요`;
};

function pickForSlot(el) {
  const meal = el.dataset.slot;
  const opens = slotOpensAt(state.selectedDay, meal);
  if (opens) { showToast(slotOpenNote(meal, opens)); return; }
  clearTimeout(el.tapTimer);
  el.classList.remove('is-tapped');
  void el.offsetWidth; // 연달아 눌러도 처음부터
  el.classList.add('is-tapped');
  el.tapTimer = setTimeout(() => el.classList.remove('is-tapped'), 800); // 사진 고르기 창이 떠 있는 동안에도 확실히 지운다
  openInput('#input-photo', { target: { day: state.selectedDay, meal: el.dataset.slot } });
}

// 끼니 칸에 넣은 사진이 다른 날 사진(또는 시각이 없는 사진)이면, 그 날의 끼니 시각으로 둔다. 오늘인데 아직 안 온 시각이면 지금
const SLOT_TIME = { breakfast: [8, 0], lunch: [12, 30], dinner: [18, 30] };
function slotTime({ day, meal }) {
  const d = fromDayKey(day);
  const [h, m] = SLOT_TIME[meal] || [12, 0];
  d.setHours(h, m, 0, 0);
  return d.getTime() > Date.now() ? new Date() : d;
}

function showView(view, { keepScroll = false } = {}) {
  state.view = view;
  $('#view-album').hidden = view !== 'album';
  $('#view-calendar').hidden = view !== 'calendar';
  for (const tab of $$('.tab')) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('on', on);
    if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  if (!keepScroll) window.scrollTo({ top: 0 });
  rememberPlace();
}

function setFilter(id) {
  state.filter = id;
  local.set('timestamp:filter', id);
  renderAlbum();
}

// 달력은 앱을 낸 달(2026년 11월)부터 이번 달까지만 넘긴다
const FIRST_MONTH = new Date(2026, 10, 1);
function clampMonth(d) {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d < FIRST_MONTH) return new Date(FIRST_MONTH);
  if (d > thisMonth) return thisMonth;
  return d;
}

function shiftMonth(delta) {
  const m = state.month;
  state.month = clampMonth(new Date(m.getFullYear(), m.getMonth() + delta, 1));
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

// 잘 됐을 때는 그날의 캐릭터 얼굴과 함께
function showMsg(slot, kind, text) {
  const face = kind === 'ok' ? `<img class="msg-face" src="${art.face}" alt="" aria-hidden="true">` : '';
  slot.innerHTML = text ? `<p class="msg ${kind}"${kind === 'err' ? ' role="alert"' : ''}>${face}<span>${escapeHtml(text)}</span></p>` : '';
}

function openLaunch() {
  const now = new Date();
  $('#launch-t').innerHTML = `${mealLabel(mealFor(now))} 사진을<br>찍어 볼까요?`;
  $('#launch-date').textContent = `${monthDay(now)} ${fmtClock(now)}`;
  openSheet($('#launch'));
}

/* ── 알림 ── */

let toastTimer = 0;

// 알림 한 줄 (공유 화면은 열지 않는다: 남긴 사진은 이미 앱에 있고, 사진 앱 저장은 사진 보기에서 길게 눌러 아이폰 메뉴로)
function showToast(text, { pop = false, stay = false } = {}) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  $('#toast-text').textContent = text;
  el.classList.remove('pop');
  el.hidden = false;
  if (pop && settings.effects && !reducedMotion()) {
    void el.offsetWidth;
    el.classList.add('pop');
  }
  if (!stay) toastTimer = setTimeout(hideToast, 3000);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

/* ── 기록 데이터 ── */

const recordsOn = (key) => state.records.filter((r) => r.day === key).sort((a, b) => a.takenAt - b.takenAt); // 이른 사진부터

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

// 아이폰 사파리는 저장소에서 꺼낸 사진(Blob)을 같은 기록에 그대로 다시 넣으면, 덮어쓰면서 원래 파일을 지워
// 사진이 깨질 수 있다. 끼니 · 공유 표시만 바꿀 때도 사진은 새 Blob으로 복사해서 넣는다
async function freshBlobs(rec) {
  const out = { ...rec };
  for (const key of ['blob', 'thumb', 'original']) {
    const b = rec[key];
    if (!(b instanceof Blob)) continue;
    const data = await b.arrayBuffer();
    out[key] = b instanceof File
      ? new File([data], b.name, { type: b.type, lastModified: b.lastModified })
      : new Blob([data], { type: b.type });
  }
  return out;
}

// 저장에 성공하면 실제로 저장된 기록(새 Blob)을, 못 하면 null을 돌려준다
async function updateRecord(rec) {
  let saved;
  try {
    saved = await freshBlobs(rec);
    await db.put(saved);
  } catch {
    return null;
  }
  upsertRecord(saved);
  renderAll();
  return saved;
}

// 한 끼니에 한 장: 같은 날 같은 끼니(아침 · 점심 · 저녁)에 이미 있는 사진. 간식 · 끼니 없음은 여러 장이어도 된다
function mealTaken(day, meal, exceptId = null) {
  if (!['breakfast', 'lunch', 'dinner'].includes(meal)) return null;
  return state.records.find((r) => r.day === day && r.meal === meal && r.id !== exceptId) || null;
}

async function removeRecord(id) {
  try { await db.remove(id); } catch { return false; }
  forgetThumb(id);
  state.records = state.records.filter((r) => r.id !== id);
  return true;
}

const stampedName = (date) => `TimeStamp_${fileStamp(date)}.jpg`;

/* ── 화면 그리기 ── */

function renderAll() {
  renderAlbum();
  renderCalendar();
  renderDay();
}

// 오늘 카드: 지금 끼니를 아직 안 찍었으면 권하고, 찍었으면 칭찬한다. 사진이 있고 ‘전체’를 볼 때만
function renderTodayCard(has, todayKey) {
  const card = $('#today-card');
  card.hidden = !has || state.filter !== 'all';
  if (card.hidden) return;
  const now = new Date();
  const meal = mealFor(now);
  const today = recordsOn(todayKey);
  const done = today.some((r) => r.meal === meal);
  const title = done ? `${mealLabel(meal)} 사진까지 남겼어요` : `${mealLabel(meal)} 사진을 찍어 볼까요?`;
  const sub = today.length ? `오늘 ${today.length}장 남겼어요` : '찍는 순간의 날짜와 시각이 함께 남아요';
  $('#today-t').textContent = title;
  $('#today-s').textContent = sub;
  card.classList.toggle('is-done', done);
}

// 날짜 머리글: 오늘 · 어제는 그 말이 제목이고 날짜는 옆에 작게, 그 밖의 날은 날짜만
function dayHeading(d) {
  const rel = relDay(d);
  return rel === '오늘' || rel === '어제' ? `${rel}<small>${monthDay(d)}</small>` : monthDay(d);
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
  $('#album-meta').textContent = has ? `총 ${state.records.length}장` : '';

  const counts = { all: state.records.length };
  for (const r of state.records) if (r.meal) counts[r.meal] = (counts[r.meal] || 0) + 1;
  // 끼니 거르기: 하나의 세그먼트, 흰 손잡이가 미끄러져 옮겨 간다
  const filters = $('#filters');
  filters.style.setProperty('--i', String(Math.max(0, FILTERS.findIndex(([id]) => id === state.filter))));
  filters.innerHTML = FILTERS.map(([id, label]) =>
    `<button type="button" data-filter="${id}" aria-pressed="${state.filter === id}" aria-label="${label} ${counts[id] || 0}장">${label}</button>`).join('');

  const list = state.records.filter((r) => state.filter === 'all' || r.meal === state.filter);
  const byDay = new Map();
  for (const r of list) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  const todayKey = dayKey(new Date());
  const keys = [...byDay.keys()].sort().reverse();
  renderTodayCard(has, todayKey);
  const animate = settings.effects && !reducedMotion();
  $('#album-grid').innerHTML = keys.map((key) => {
    const items = (byDay.get(key) || []).sort((a, b) => a.takenAt - b.takenAt); // 하루 안에서는 아침 → 점심 → 저녁 순
    const d = fromDayKey(key);
    const count = items.length ? `<b>${items.length}</b>장` : '아직 없어요';
    const tiles = items.length ? items.map((r) => tileHtml(r, animate)).join('')
      : `<button class="tile tile-add" type="button" data-add aria-label="오늘 사진 찍기">${CAMERA_SVG}</button>`;
    return `<section aria-label="${monthDay(d)}"><div class="grid-day${key === todayKey ? ' is-today' : ''}"><h2>${dayHeading(d)}</h2><span>${count}</span></div>`
      + `<div class="grid">${tiles}</div></section>`;
  }).join('');

  const emptyFilter = has && list.length === 0;
  $('#filter-empty').hidden = !emptyFilter;
  if (emptyFilter) $('#filter-empty-text').textContent = `아직 ${mealLabel(state.filter)} 사진이 없어요.`;
  state.fresh.clear();
}

// 끼니 체크: 아침 · 점심 · 저녁 세 칸. 간식과 끼니 없는 사진은 체크에 들어가지 않는다
const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];

// 세 끼를 다 채운 날의 잉크 도장 6종 (오둥이 하늘 잉크 · 퍼펭이 민트 잉크). 날짜마다 정해진 하나가 살짝 기울어 찍힌다
const DAY_STAMPS = ['odung', 'perpeng'].flatMap((who) => ['smile', 'yum', 'wink'].map((f) => `assets/art/stamp/${who}-${f}.png`));
function dayHash(key) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const dayTilt = (key) => Math.round((dayHash(`${key}~`) - 0.5) * 26); // -13° ~ 13°
const dayStamp = (key) => ({
  src: DAY_STAMPS[Math.floor(dayHash(key) * DAY_STAMPS.length)],
  tilt: dayTilt(key),
});
// 못 채운 날(11월 1일부터 어제까지, 세 끼를 다 못 채운 날)의 회색 도장 4종.
// 캐릭터는 웃는 도장과 같은 방식(날짜 해시)으로 정하고, 그 캐릭터의 두 표정(아쉬움 · 배고픔)을 날짜마다 번갈아 쓴다.
// 날짜로만 정해져서 다시 그려도 바뀌지 않는다
const dayWho = (key) => (Math.floor(dayHash(key) * DAY_STAMPS.length) < 3 ? 'odung' : 'perpeng'); // DAY_STAMPS 앞 3개가 오둥이
const missFaces = new Map();
const missStamp = (key) => {
  const who = dayWho(key);
  // 11월 1일부터 이 날까지 같은 캐릭터가 정해진 날을 세어, 그 캐릭터 안에서 아쉬움 · 배고픔을 번갈아 (날짜만 보고 정한다)
  let face = missFaces.get(key);
  if (!face) {
    let n = 0;
    for (const d = new Date(FIRST_MONTH); dayKey(d) <= key; d.setDate(d.getDate() + 1)) if (dayWho(dayKey(d)) === who) n++;
    face = n % 2 ? 'sad' : 'hungry';
    missFaces.set(key, face);
  }
  return { src: `assets/art/stamp/${who}-miss-${face}.png`, tilt: dayTilt(key) };
};
// 밥상 카드의 캐릭터: 아직 안 먹은 날은 빈 그릇, 먹은 끼니가 있으면 마지막 끼니를 먹는 모습, 세 끼 다면 배부른 모습
const mealArt = (pose) => (pose ? `assets/art/meal/${state.family}-${pose}.png` : art.empty);
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l5 5l10 -10"/></svg>';

// 날마다 남긴 끼니 (day → Set). 사진은 있는데 세 끼가 하나도 없는 날도 빈 Set으로 들어간다
function mealsByDay() {
  const map = new Map();
  for (const r of state.records) {
    if (!map.has(r.day)) map.set(r.day, new Set());
    if (MAIN_MEALS.includes(r.meal)) map.get(r.day).add(r.meal);
  }
  return map;
}

// 세 끼를 다 채운 날이 며칠 이어졌는지 (오늘을 아직 못 채웠으면 어제부터 센다)
function fullStreak(meals) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  if (meals.get(dayKey(d))?.size !== 3) d.setDate(d.getDate() - 1);
  let n = 0;
  while (meals.get(dayKey(d))?.size === 3) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// 달력: 남긴 끼니만큼 점이 차고(아침 · 점심 · 저녁 순), 세 끼를 다 채운 날엔 마스코트 얼굴 도장
function renderCalendar() {
  const m = state.month;
  const y = m.getFullYear();
  const mo = m.getMonth();
  const now = new Date();
  const prefix = `${y}-${String(mo + 1).padStart(2, '0')}`;
  $('#mon-t').textContent = `${y}년 ${mo + 1}월`;
  $('#mon-prev').disabled = m <= FIRST_MONTH;
  $('#mon-next').disabled = y === now.getFullYear() && mo === now.getMonth();

  const meals = mealsByDay();
  const monthKeys = [...meals.keys()].filter((k) => k.startsWith(prefix));
  const monthFull = monthKeys.filter((k) => meals.get(k).size === 3).length;
  $('#mon-sum').innerHTML = monthKeys.length ? `<span>도장 <b>${monthFull}개</b></span>` : '기록 없음';
  const streak = fullStreak(meals);
  $('#cal-meta').textContent = streak >= 2 ? `${streak}일 연속` : '';

  const todayKey = dayKey(now);
  const firstKey = dayKey(FIRST_MONTH);
  const first = new Date(y, mo, 1).getDay();
  const last = new Date(y, mo + 1, 0).getDate();

  let html = WEEKDAYS.map((w, i) => `<div class="hd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" aria-hidden="true">${w}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div aria-hidden="true"></div>';
  for (let d = 1; d <= last; d++) {
    const key = dayKey(new Date(y, mo, d));
    const got = meals.get(key);
    const full = got?.size === 3;
    const future = key > todayKey;
    const selected = key === state.selectedDay;
    const cls = ['num', key === todayKey && 'today', selected && 'selected', future && 'off', got && 'has'].filter(Boolean).join(' ');
    // 지난날인데 세 끼를 다 못 채웠으면 ‘못 채운 날’ 도장 (오늘 · 앞날은 아직 아니다)
    const missed = !full && key < todayKey && key >= firstKey;
    const said = full ? ', 세 끼 다 남김'
      : got?.size ? `, ${MAIN_MEALS.filter((m) => got.has(m)).map(mealLabel).join(' · ')} 남김`
        : got ? ', 간식만 남김' : '';
    const st = full ? dayStamp(key) : missed ? missStamp(key) : null;
    const mark = st ? `<img class="day-seal${missed ? ' is-miss' : ''}" src="${st.src}" style="--tilt:${st.tilt}deg" alt="" aria-hidden="true">`
      : got ? `<span class="day-dots" aria-hidden="true">${MAIN_MEALS.map((m) => `<i${got.has(m) ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
    html += `<button class="day" type="button" data-day="${key}" aria-pressed="${selected}" aria-label="${mo + 1}월 ${d}일${said}${missed ? ', 못 채운 날' : ''}"${future ? ' disabled' : ''}>`
      + `<span class="${cls}">${d}</span>${mark}</button>`;
  }
  $('#cal').innerHTML = html;
}

// 밥상 카드 오른쪽 위 한 줄 (아침 · 점심 · 저녁은 모두 받침이 있어 ‘이 · 을’)
function daySay(got, isToday) {
  if (got.size === 3) return '세 끼 다 채웠어요';
  if (!got.size) return isToday ? '첫 끼를 찍어 볼까요?' : '남긴 끼니가 없어요';
  if (isToday) {
    const left = MAIN_MEALS.filter((m) => !got.has(m)).map(mealLabel);
    return `${left.join(' · ')}${left.length === 1 ? '만' : '이'} 남았어요`;
  }
  return `${MAIN_MEALS.filter((m) => got.has(m)).map(mealLabel).join(' · ')}을 남겼어요`;
}

// 고른 날의 밥상: 캐릭터 + 세 칸. 사진이 있으면 그 사진과 체크(누르면 바꾸기), 없으면 그릇 그림(누르면 올리기)
function renderDay() {
  const key = state.selectedDay;
  const d = fromDayKey(key);
  const list = recordsOn(key); // 이른 사진부터
  const isToday = key === dayKey(new Date());
  const main = list.filter((r) => MAIN_MEALS.includes(r.meal));
  const got = new Set(main.map((r) => r.meal));
  $('#day-title').innerHTML = dayHeading(d);
  $('#day-say').textContent = daySay(got, isToday);
  const pose = got.size === 3 ? 'full' : main.length ? main[main.length - 1].meal : null;
  const char = $('#day-char');
  const src = mealArt(pose);
  if (char.getAttribute('src') !== src) char.src = src;
  $('#day-slots').innerHTML = MAIN_MEALS.map((m) => {
    const label = mealLabel(m);
    const items = list.filter((r) => r.meal === m);
    if (items.length) {
      const r = items[0];
      const t = fmtClock(new Date(r.takenAt));
      const more = items.length > 1 ? `<span class="slot-more">+${items.length - 1}</span>` : '';
      return `<div class="slot"><button class="slot-ph" type="button" data-slot="${m}" aria-label="${label} ${t} 사진 바꾸기"><img src="${thumbUrl(r)}" alt="">${more}</button>`
        + `<p class="slot-lb">${CHECK_SVG}${label}</p></div>`;
    }
    // 빈 칸: 아직 비어 있는 그릇 그림만 (글씨 없이). 누르면 이 끼니 사진을 올린다
    return `<div class="slot"><button class="slot-ph is-empty${isToday ? ' is-today' : ''}" type="button" data-slot="${m}" aria-label="${label} 사진 올리기"><img class="slot-dish" src="assets/art/slot/${m}.png" alt=""></button>`
      + `<p class="slot-lb is-wait">${label}</p></div>`;
  }).join('');
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
  const useTime = settings.photoTime !== false; // 설정에서 끄면 사진의 시각은 보지 않는다
  const [{ img, url }, exifDate] = await Promise.all([loadPhoto(file), useTime ? readExifDate(file) : null, fontsReady(), charsReady()]);
  let takenAt;
  let timeSource;
  if (!useTime) { takenAt = new Date(); timeSource = 'set'; } // 지금 시각 (스탬프 화면에서 바꿀 수 있다)
  else if (exifDate) { takenAt = exifDate; timeSource = 'exif'; }
  else if (file.lastModified && Math.abs(Date.now() - file.lastModified) > 60000) { takenAt = new Date(file.lastModified); timeSource = 'file'; }
  else { takenAt = new Date(); timeSource = 'now'; }
  return { img, url, takenAt, timeSource, W0: img.naturalWidth, H0: img.naturalHeight };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality);
  });
}

// 원본 좌표의 정사각형 r을 S×S에 그린다. 사진을 줄여 전체가 보일 때는 남는 곳을 같은 사진을 흐리게 깔아 채운다.
function drawCrop(ctx, src, k, r, S, W0, H0, backdrop) {
  ctx.imageSmoothingQuality = 'high';
  const e = 1e-6;
  if (r.x >= -e && r.y >= -e && r.x + r.side <= W0 + e && r.y + r.side <= H0 + e) {
    const side = Math.min(r.side, W0, H0);
    const x = clamp(r.x, 0, W0 - side);
    const y = clamp(r.y, 0, H0 - side);
    ctx.drawImage(src, x * k, y * k, side * k, side * k, 0, 0, S, S);
    return;
  }
  if (backdrop) ctx.drawImage(backdrop, 0, 0, S, S);
  else { ctx.fillStyle = '#eef3f9'; ctx.fillRect(0, 0, S, S); }
  const s = S / r.side;
  ctx.drawImage(src, -r.x * s, -r.y * s, W0 * s, H0 * s);
}

// 흐린 바탕: 아주 작게 줄였다가 여러 번 나눠 키우면 어느 브라우저에서나 부드럽게 번진다
function makeBackdrop(src) {
  const w = src.width;
  const h = src.height;
  const m = Math.min(w, h);
  let prev = document.createElement('canvas');
  prev.width = prev.height = 20;
  const p0 = prev.getContext('2d');
  p0.imageSmoothingQuality = 'high';
  p0.drawImage(src, (w - m) / 2, (h - m) / 2, m, m, 0, 0, 20, 20);
  for (const size of [60, 180, 400]) {
    const next = document.createElement('canvas');
    next.width = next.height = size;
    const nctx = next.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(prev, 0, 0, size, size);
    prev = next;
  }
  const ctx = prev.getContext('2d');
  ctx.fillStyle = 'rgba(25, 31, 40, 0.14)';
  ctx.fillRect(0, 0, prev.width, prev.height);
  return prev;
}

const minZoom = (e) => Math.min(e.W0, e.H0) / Math.max(e.W0, e.H0); // 이만큼 줄이면 사진 전체가 들어온다

async function renderStamped(img, rect, info, look, frame = {}) {
  const S = clamp(Math.round(rect.side), OUT_MIN, OUT_MAX);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  drawCrop(ctx, img, 1, rect, S, frame.W0 ?? img.naturalWidth ?? img.width, frame.H0 ?? img.naturalHeight ?? img.height, frame.backdrop);
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

/* ── 즉시 저장: 스탬프 화면 없이, 가운데를 정사각형으로, 마지막에 쓴 스탬프로 ── */

// target: 달력의 끼니 칸이나 사진 보기의 ‘바꾸기’에서 골랐을 때 그 날 · 끼니(· 바꿀 사진). 스탬프 화면 없이 바로 넣고,
// 있던 사진은 새 사진으로 바꾼다
async function quickSave(file, { target = null } = {}) {
  showToast('사진을 남기고 있어요', { stay: true });
  let photo;
  try {
    photo = await readPhoto(file);
    // 2026년 11월 1일 전이나 미래에 찍힌 사진은 어디로 넣든 받지 않는다.
    // 달력 칸 · 사진 교체하기에서 그 날 시각으로 옮기기 전에, 사진에 남은 원래 시각으로 먼저 본다
    if (timeBlocked(photo.takenAt)) { showToast(blockNote(photo.takenAt)); return; }
    // 바뀔 사진: 사진 보기의 ‘바꾸기’면 그 사진, 달력 칸이면 그 칸에 있던 사진
    const prev = target
      ? (target.replaceOf ? state.records.find((r) => r.id === target.replaceOf) : mealTaken(target.day, target.meal)) || null
      : null;
    // 그 날 사진이 아니면(시각이 없는 사진 포함) 바뀔 사진의 시각, 빈 칸이면 그 날의 끼니 시각으로
    if (target && dayKey(photo.takenAt) !== target.day) photo.takenAt = prev ? new Date(prev.takenAt) : slotTime(target);
    const side = Math.min(photo.W0, photo.H0);
    const rect = { x: (photo.W0 - side) / 2, y: (photo.H0 - side) / 2, side };
    if (timeBlocked(photo.takenAt)) { showToast(blockNote(photo.takenAt)); return; }
    const meal = target ? target.meal : mealFor(photo.takenAt);
    const replacing = prev;
    if (!target && mealTaken(dayKey(photo.takenAt), meal)) {
      URL.revokeObjectURL(photo.url);
      photo = null;
      showToast(`이날 ${mealLabel(meal)} 사진이 이미 있어서 스탬프 화면을 열었어요`);
      startEdit(file);
      return;
    }
    const look = { style: settings.stampStyle, color: settings.stampColor };
    const pick = { odung: randomPose('odung'), perpeng: randomPose('perpeng') };
    const out = await renderStamped(photo.img, rect, { date: photo.takenAt, meal, chars: poseImages(pick) }, look);
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
      original: null,
      createdAt: Date.now(),
      savedAt: null,
      sentAt: null,
    };
    let kept = false;
    if (state.dbOk) {
      try { await db.put(rec); kept = true; } catch { kept = false; }
    }
    if (kept) {
      if (replacing) await removeRecord(replacing.id); // 그 칸에 있던 사진은 앱에서만 뺀다 (아이폰 앨범의 사진은 그대로)
      upsertRecord(rec);
      state.fresh.add(rec.id);
      if (target) {
        renderAll(); // 달력은 그대로 두고, 그 칸에 새 사진
      } else {
        if (state.view !== 'album') showView('album');
        if (state.filter !== 'all' && state.filter !== meal) state.filter = 'all';
        renderAll();
        window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
    playStampSound();
    const done = target
      ? `${mealLabel(meal) ? `${mealLabel(meal)} ` : ''}사진을 ${replacing ? '교체했어요' : '남겼어요'}`
      : `${fmtClock(photo.takenAt)} 사진을 남겼어요`;
    showToast(kept ? done : '이 기기에는 남기지 못했어요', { pop: true });
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
  skelText: $('#preview-skel span'),
  canvas: $('#preview-canvas'),
  hint: $('#ed-hint'),
  reset: $('#crop-reset'),
  fit: $('#ed-fit'),
  strip: $('#style-strip'),
  swatches: $('#swatches'),
  time: $('#ed-time'),
  timeText: $('#ed-time-text'),
  timePill: $('#ed-time-pill'),
  seg: $('#meal-seg'),
  done: $('#ed-done'),
  save: $('#ed-save'),
};

// 미래 사진은 남기지 않는다: 지금보다 2시간 넘게 뒤의 시각이면 미래로 본다
// (2시간까지는 기기 시계 · 시간대가 조금 어긋난 것으로 보고 받아 준다)
// 지난 쪽은 앱을 낸 2026년 11월 1일(FIRST_MONTH)부터만 받는다. 그 전 사진은 달력에도 없는 달이라 남기지 않는다
const FUTURE_SLACK = 2 * 60 * 60 * 1000;
const isFuture = (d) => d.getTime() > Date.now() + FUTURE_SLACK;
const isTooEarly = (d) => d < FIRST_MONTH;
const timeBlocked = (d) => isFuture(d) || isTooEarly(d);
const shortWhen = (d) => `${d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월 ${d.getDate()}일 ${fmtClock(d)}`;
// 바로 남기기 알림 · 스탬프 화면 안내 · 시각 고치기 알림
const blockNote = (d) => (isFuture(d)
  ? `미래 시각(${shortWhen(d)})에 찍힌 사진이라 남길 수 없어요`
  : `11월 1일 전(${shortWhen(d)})에 찍힌 사진이라 남길 수 없어요`);
const blockDetail = (d) => `${shortWhen(d)}에 찍힌 사진이에요.\n${isFuture(d)
  ? '지금보다 2시간 넘게 뒤는 미래라서 남길 수 없어요.'
  : '2026년 11월 1일부터 찍은 사진만 남길 수 있어요.'}`;
const editBlockNote = (d) => (isFuture(d)
  ? '지금보다 2시간 넘게 뒤는 미래라서 넣을 수 없어요'
  : '2026년 11월 1일 전 시각은 넣을 수 없어요');

// 시각을 지어내지 않는다: 사진에 시각이 없을 때만 알려 준다
const TIME_NOTES = {
  file: '파일에 남은 시각이에요. 맞는지 확인해 주세요',
  now: '촬영 시각이 없어 지금 시각을 넣었어요',
};

const infoOf = (e) => ({ date: e.takenAt, meal: e.meal, chars: poseImages(e.pose), charPos: e.charPos });
const lookOf = (e, pop = null) => ({ style: e.style, color: e.color, pop });

async function startEdit(file, { camera = false } = {}) {
  const mine = {
    id: uid(), createdAt: Date.now(), version: 0, job: null, timer: 0, source: file,
    file: null, thumb: null, savedAt: null, sentAt: null, persistedVersion: null,
    meal: null, mealAuto: true, ready: false, crop: null, cropMoved: false,
    style: settings.stampStyle, color: settings.stampColor,
    pose: { odung: randomPose('odung'), perpeng: randomPose('perpeng') }, // 사진마다 다른 모습
    charPos: null, // 캐릭터를 옮긴 자리 (없으면 도장에 붙어 있다)
  };
  ed = mine;
  E.canvas.hidden = true;
  E.skel.hidden = false;
  E.reset.hidden = true;
  E.done.disabled = true;
  E.save.disabled = true;
  E.timeText.textContent = '';
  E.timePill.classList.remove('is-guess');
  E.skel.classList.remove('is-err');
  E.skelText.textContent = '사진을 준비하고 있어요';
  E.hint.textContent = STYLES.find((s) => s.id === mine.style)?.character
    ? '사진과 캐릭터를 끌어서 옮겨요' : '끌어서 옮기고, 두 손가락으로 줄이거나 키워요';
  E.hint.classList.remove('gone');
  buildStrip();
  openSheet(E.sheet);

  try {
    const photo = await readPhoto(file);
    if (ed !== mine) { URL.revokeObjectURL(photo.url); return; }
    if (timeBlocked(photo.takenAt)) {
      URL.revokeObjectURL(photo.url);
      E.skel.classList.add('is-err');
      E.hint.classList.add('gone');
      E.skelText.textContent = blockDetail(photo.takenAt);
      return;
    }
    Object.assign(mine, photo);
    // 방금 카메라로 찍은 사진이면 지금 시각이 곧 찍은 시각이다
    if (camera && mine.timeSource !== 'exif') mine.timeSource = 'camera';
    mine.meal = mealFor(mine.takenAt);
    mine.crop = { cx: mine.W0 / 2, cy: mine.H0 / 2, z: 1 };

    buildPreview(mine);
    mine.ready = true;

    E.skel.hidden = true;
    E.canvas.hidden = false;
    E.done.disabled = false;
    E.save.disabled = false;
    fillFields();
    stampIn();
    markDirty();
    if (TIME_NOTES[mine.timeSource]) showToast(TIME_NOTES[mine.timeSource]);
    setTimeout(() => { if (ed === mine) E.hint.classList.add('gone'); }, 2600);
  } catch {
    if (ed !== mine) return;
    E.skel.classList.add('is-err');
    E.hint.classList.add('gone');
    E.skelText.textContent = '사진을 열지 못했어요.\n다른 사진으로 다시 시도해 주세요.';
  }
}

// 스탬프 고르기: 작은 그림 타일 일곱 개가 한 줄에. 결과는 위의 큰 사진에서 바로 보인다.
// 캐릭터는 얼굴, 나머지는 모양을 닮은 작은 표시. 고른 캐릭터를 한 번 더 누르면 다른 포즈
const STYLE_GLYPH = {
  basic: '<span class="g-basic"><i></i><i></i></span>',
  big: '<b class="g-big">7:46</b>',
  film: '<b class="g-film">\'26</b>',
  meal: '<span class="g-mix"><b></b><i></i><i></i></span>', // 끼니 꼬리표 + 시각 + 날짜를 섞은 모양
  capsule: '<span class="g-capsule"></span>',
};
function buildStrip() {
  E.strip.innerHTML = STYLES.map((s) =>
    `<button class="st-tile" type="button" role="radio" data-style="${s.id}" aria-checked="${s.id === ed.style}" aria-label="${s.label}"${s.character ? ' aria-description="한 번 더 누르면 다른 포즈"' : ''}>`
    + `<span class="t-box" aria-hidden="true">${s.character ? `<img src="${ART[s.id].face}" alt="">` : STYLE_GLYPH[s.id] || ''}</span>`
    + `<span class="t-name" aria-hidden="true">${s.label}</span></button>`).join('');
}

function fillLook() {
  for (const b of $$('[data-style]', E.strip)) {
    const on = b.dataset.style === ed.style;
    b.setAttribute('aria-checked', String(on));
    if (on) {
      const l = b.offsetLeft - 10;
      const r = b.offsetLeft + b.offsetWidth + 34 - E.strip.clientWidth;
      if (E.strip.scrollLeft > l) E.strip.scrollLeft = l;
      else if (E.strip.scrollLeft < r) E.strip.scrollLeft = r;
    }
  }
  for (const b of $$('[data-color]', E.swatches)) b.setAttribute('aria-checked', String(b.dataset.color === ed.color));
  E.swatches.classList.toggle('is-off', !styleUsesColor(ed.style));
}

// 다른 모습의 오둥이·퍼펭이로 바꾼다
function shufflePose() {
  if (!ed?.ready || !POSES[ed.style]) return;
  ed.pose = { ...ed.pose, [ed.style]: randomPose(ed.style, ed.pose[ed.style]) };
  stampIn();
  markDirty();
}

function fillFields() {
  const d = ed.takenAt;
  const [ampm, hm] = fmtClock(d).split(' ');
  E.timeText.innerHTML = `${d.getMonth() + 1}월 ${d.getDate()}일 <small>${ampm}</small> ${hm}`;
  E.time.setAttribute('aria-label', `촬영 시각 ${monthDay(d)} ${fmtClock(d)}`);
  E.time.value = toLocalInput(d);
  E.time.min = toLocalInput(FIRST_MONTH);
  E.time.max = toLocalInput(new Date(Date.now() + FUTURE_SLACK));
  E.timePill.classList.toggle('is-guess', Boolean(TIME_NOTES[ed.timeSource]));
  edMealBar.show();
  fillLook();
}

// 끼니 막대: 다섯 칸(아침 · 점심 · 저녁 · 간식 · 없음)의 이름이 막대 안에 있다.
// 흰 손잡이를 끌면 손가락을 따라가고, 놓으면 가까운 칸에 붙는다. 손잡이 위 이름이 고른 끼니.
// 스탬프 화면(끄는 동안 바로 바뀜)과 사진 보기(놓을 때 한 번 저장)에서 같이 쓴다
const MEAL_STOPS = ['breakfast', 'lunch', 'dinner', 'snack', null];
const stopLabel = (m) => mealLabel(m) || '끼니 없음';
function mealBar(track, { current, choose, ready, live }) {
  const n = MEAL_STOPS.length;
  const labels = $$('.mp-labels > span', track);
  const paint = (p) => {
    const i = clamp(Math.round(p), 0, n - 1);
    track.style.setProperty('--p', String(p / (n - 1)));
    labels.forEach((el, k) => {
      el.classList.toggle('on', k === i);
      el.classList.toggle('past', k < i);
    });
    track.setAttribute('aria-valuenow', String(i));
    track.setAttribute('aria-valuetext', stopLabel(MEAL_STOPS[i]));
  };
  const show = () => paint(MEAL_STOPS.indexOf(current() ?? null));
  const pick = (i) => {
    const meal = MEAL_STOPS[i];
    if (ready() && meal !== (current() ?? null)) choose(meal);
  };
  const at = (e) => {
    const r = track.getBoundingClientRect();
    const w = (r.width - 8) / n; // 한 칸 너비 = 손잡이 너비
    return clamp((e.clientX - r.left - 4 - w / 2) / Math.max(1, w * (n - 1)), 0, 1) * (n - 1);
  };
  let drag = null;
  let last = 0;
  track.addEventListener('pointerdown', (e) => {
    if (!ready()) return;
    e.preventDefault();
    e.stopPropagation();
    try { track.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 움직임은 받는다 */ }
    drag = e.pointerId;
    track.classList.add('is-dragging');
    last = at(e);
    paint(last);
    if (live) pick(Math.round(last));
  });
  track.addEventListener('pointermove', (e) => {
    if (drag !== e.pointerId) return;
    last = at(e);
    paint(last);
    if (live) pick(Math.round(last));
  });
  const end = (e) => {
    if (drag !== e.pointerId) return;
    drag = null;
    track.classList.remove('is-dragging');
    if (e.type === 'pointerup') pick(Math.round(last));
    show(); // 가까운 칸에 붙는다 (못 바꿨으면 원래 칸으로)
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    if (!ready()) return;
    const now = MEAL_STOPS.indexOf(current() ?? null);
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    const next = step ? now + step : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    pick(clamp(next, 0, n - 1));
    show();
  });
  return { show };
}

const edMealBar = mealBar($('#meal-track'), {
  current: () => ed?.meal,
  ready: () => Boolean(ed?.ready),
  live: true, // 끄는 동안 사진 속 도장 글씨도 바로 바뀐다
  choose: (meal) => {
    ed.meal = meal;
    ed.mealAuto = false;
    changed(); // 혼합 스탬프 · 도장에는 끼니가 찍힌다
  },
});

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
  e.backdrop = makeBackdrop(base);
}

// 원본 좌표의 정사각형 자르기 영역.
// 채울 때(z ≥ 1)는 사진 밖으로 나가지 않게, 줄였을 때(z < 1)는 사진이 정사각형 밖으로 나가지 않게 붙잡는다.
const keepIn = (c, side, dim) => (side <= dim ? clamp(c, side / 2, dim - side / 2) : clamp(c, dim - side / 2, side / 2));
function cropRect(e) {
  e.crop.z = clamp(e.crop.z, minZoom(e), MAX_ZOOM);
  const side = Math.min(e.W0, e.H0) / e.crop.z;
  e.crop.cx = keepIn(e.crop.cx, side, e.W0);
  e.crop.cy = keepIn(e.crop.cy, side, e.H0);
  return { x: e.crop.cx - side / 2, y: e.crop.cy - side / 2, side };
}

// 사진이 정사각형이 아니면 ‘전체 보기’ 버튼을 보인다
const isFit = (e) => e.crop.z <= minZoom(e) + 0.001;
function fillFit() {
  const can = ed?.ready && minZoom(ed) < 0.995;
  E.fit.hidden = !can;
  if (!can) return;
  const fit = isFit(ed);
  E.fit.classList.toggle('is-fit', fit);
  E.fit.setAttribute('aria-label', fit ? '꽉 채우기' : '사진 전체 보기');
}

function toggleFit() {
  if (!ed?.ready || minZoom(ed) >= 0.995) return;
  const from = { ...ed.crop };
  const to = isFit(ed) ? { cx: ed.W0 / 2, cy: ed.H0 / 2, z: 1 } : { cx: ed.W0 / 2, cy: ed.H0 / 2, z: minZoom(ed) };
  ed.cropMoved = to.z !== 1;
  const mine = ed;
  const done = () => { if (ed !== mine) return; ed.crop = to; changed(); };
  if (!settings.effects || reducedMotion()) { done(); return; }
  const start = performance.now();
  const dur = 260;
  const step = (now) => {
    if (ed !== mine) return;
    const p = Math.min(1, (now - start) / dur);
    if (p >= 1) { done(); return; }
    const q = 1 - (1 - p) ** 3;
    ed.crop = { cx: from.cx + (to.cx - from.cx) * q, cy: from.cy + (to.cy - from.cy) * q, z: from.z * (to.z / from.z) ** q };
    drawPreview();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => { if (ed === mine && ed.crop !== to && performance.now() - start > dur + 100) done(); }, dur + 160);
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
  drawCrop(ctx, ed.base, ed.baseK, r, c.width, ed.W0, ed.H0, ed.backdrop);
  drawStamp(ctx, c.width, infoOf(ed), lookOf(ed, pop));
  E.reset.hidden = !ed.cropMoved && !ed.charPos;
  fillFit();
}

// 스탬프·시각·식사·위치가 바뀌면 저장본을 다시 만든다
function changed() {
  drawPreview();
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
  const p = renderStamped(e.img, cropRect(e), infoOf(e), lookOf(e), { W0: e.W0, H0: e.H0, backdrop: e.backdrop }).then((out) => {
    if (e.version !== v) return null;
    e.file = out.file;
    e.thumb = out.thumb;
    e.outSize = out.size;
    return e.file;
  });
  e.job = { v, p };
  return p;
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
    original: null,
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
  if (e.replaceId) { await removeRecord(e.replaceId); e.replaceId = null; } // 같은 끼니의 먼저 있던 사진은 앱에서 뺀다
  renderAll();
  return true;
}

// 스탬프 화면 아래 두 버튼과 위의 X
//  · 완료: 앱(앨범 탭 · 달력)에 남기고 닫는다
//  · 앨범 저장: 아이폰 공유 화면의 ‘이미지 저장’으로 사진 앱에 넣고, 앱에도 남기고 닫는다 (웹앱은 공유 화면 없이 바로 넣을 수 없다)
//  · X(닫기): 남기지 않고 닫는다
// 한 끼니에 한 장: 그날 그 끼니 사진이 이미 있으면 바꿀지 묻고, 취소하면 스탬프 화면에 그대로 남아 끼니를 고를 수 있다
function readyToKeep(e) {
  if (timeBlocked(e.takenAt)) { showToast(editBlockNote(e.takenAt)); return false; }
  // 오늘의 아직 안 열린 끼니(달력 칸과 같은 규칙: 아침 3시 · 점심 9시 · 저녁 15시)로는 남기지 않는다
  const day = dayKey(e.takenAt);
  const opens = MAIN_MEALS.includes(e.meal) ? slotOpensAt(day, e.meal) : null;
  if (opens) { showToast(slotOpenNote(e.meal, opens)); return false; }
  const taken = mealTaken(day, e.meal, e.id);
  // 앞서 바꾸기로 했던 사진이 지금 끼니 · 날과 겹치지 않으면 바꾸기는 취소 (끼니를 바꾼 뒤 엉뚱한 사진이 지워지지 않게)
  if (e.replaceId && e.replaceId !== taken?.id) e.replaceId = null;
  if (taken && e.replaceId !== taken.id) {
    if (!window.confirm(`이날 ${mealLabel(e.meal)} 사진이 이미 있어요.\n새 사진으로 바꿀까요?`)) {
      showToast('끼니를 바꾸면 따로 남길 수 있어요');
      return false;
    }
    e.replaceId = taken.id;
  }
  return true;
}

function editorDone() {
  const mine = ed;
  if (!mine?.ready || !readyToKeep(mine)) return;
  closeEditor({ keep: true });
}

async function editorSave() {
  const mine = ed;
  if (!mine?.ready || !readyToKeep(mine)) return;
  let file = mine.file;
  if (!file) {
    E.save.classList.add('is-busy');
    try { await exportFor(mine, mine.version); } catch { /* 아래에서 알린다 */ } finally { E.save.classList.remove('is-busy'); }
    file = mine.file;
    if (!file) { showToast('사진을 준비하지 못했어요. 다시 시도해 주세요'); return; }
  }
  const result = await shareFiles([file]);
  if (ed !== mine || result === 'cancelled') return;
  if (result === 'retry') { showToast('사진을 준비했어요. 한 번 더 눌러 주세요'); return; }
  if (result === 'error') { showToast('저장 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요'); return; }
  mine.savedAt = Date.now();
  closeEditor({ keep: true });
}

// 아이폰 공유 화면을 연다(‘이미지 저장’을 고르면 사진 앱에). 공유를 못 쓰는 브라우저에서는 파일로 내려받는다
async function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      if (err?.name === 'NotAllowedError') return 'retry';
      return 'error';
    }
  }
  for (const f of files) {
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

async function keepEdit(e) {
  try {
    if (!e.file) await exportFor(e, e.version);
  } catch { /* 아래에서 못 남겼다고 알린다 */ }
  const replacing = Boolean(e.replaceId);
  const kept = await persistEdit(e);
  const label = mealLabel(e.meal);
  showToast(kept ? `${label ? `${label} ` : ''}사진을 ${replacing ? '교체했어요' : '남겼어요'}` : '이 기기에는 기록을 남기지 못했어요');
  return kept;
}

// keep: 완료 · 앨범 저장에서만. X나 바깥을 눌러 닫으면 남기지 않는다
function closeEditor({ keep = false } = {}) {
  const mine = ed;
  if (mine) clearTimeout(mine.timer);
  ed = null;
  E.canvas.width = E.canvas.height = 1;
  closeSheet(E.sheet);
  const free = () => {
    if (!mine) return;
    if (mine.url) URL.revokeObjectURL(mine.url);
    if (mine.base) mine.base.width = mine.base.height = 1;
  };
  if (keep && mine?.ready) keepEdit(mine).finally(free); // 화면은 바로 닫고, 남기는 건 뒤에서
  else free();
}

function bindEditor() {
  $('#ed-close').addEventListener('click', () => closeEditor()); // 남기지 않고 닫기
  E.done.addEventListener('click', editorDone);
  E.save.addEventListener('click', editorSave);

  E.strip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-style]');
    if (!b || !ed?.ready) return;
    if (b.dataset.style === ed.style) { shufflePose(); return; } // 고른 캐릭터를 한 번 더 누르면 다른 모습
    {
      ed.style = b.dataset.style;
      settings.stampStyle = ed.style;
      saveSettings();
      fillLook();
      stampIn();
      markDirty();
    }
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


  E.time.addEventListener('change', () => {
    if (!ed?.ready) return;
    const d = fromLocalInput(E.time.value);
    if (!d) { fillFields(); return; }
    if (timeBlocked(d)) { showToast(editBlockNote(d)); fillFields(); return; } // 원래 시각으로 되돌린다
    ed.takenAt = d;
    ed.timeSource = 'edited';
    if (ed.mealAuto) ed.meal = mealFor(d);
    fillFields();
    changed();
  });

  E.fit.addEventListener('click', toggleFit);

  E.reset.addEventListener('click', () => {
    if (!ed?.ready) return;
    ed.crop = { cx: ed.W0 / 2, cy: ed.H0 / 2, z: 1 };
    ed.cropMoved = false;
    ed.charPos = null; // 캐릭터도 도장 옆으로
    changed();
  });

  // 한 손가락: 옮기기, 두 손가락: 키우기 · 줄이기
  const pointers = new Map();
  let gesture = null;
  let lastTap = 0;
  const center = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  const spread = (pts) => (pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0);

  const beginGesture = () => {
    const pts = [...pointers.values()];
    gesture = {
      n: pts.length, p: center(pts), d: spread(pts),
      cx: ed.crop.cx, cy: ed.crop.cy, z: ed.crop.z, moved: gesture?.moved || false,
    };
  };

  // 캐릭터를 집었는지: 그림 둘레의 투명 여백은 빼고 가운데 쪽만
  const charAt = (x, y) => {
    const box = characterBox(1, ed.style, infoOf(ed));
    if (!box) return null;
    const r = E.canvas.getBoundingClientRect();
    const nx = (x - r.left) / r.width;
    const ny = (y - r.top) / r.height;
    const pad = box.size * 0.16;
    if (nx < box.x + pad || nx > box.x + box.size - pad || ny < box.y + pad || ny > box.y + box.size - pad) return null;
    return { cx: box.x + box.size / 2, cy: box.y + box.size / 2, rect: r };
  };

  E.preview.addEventListener('pointerdown', (e) => {
    if (!ed?.ready || e.target.closest('button')) return;
    e.preventDefault();
    if (gesture?.mode === 'char') return; // 캐릭터를 옮기는 중엔 다른 손가락은 무시
    E.hint.classList.add('gone');
    if (!pointers.size) {
      const hit = charAt(e.clientX, e.clientY);
      if (hit) {
        try { E.preview.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 손가락 */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture = { mode: 'char', p: { x: e.clientX, y: e.clientY }, from: { x: hit.cx, y: hit.cy }, rect: hit.rect, moved: false };
        ed.gesturing = true;
        return;
      }
    }
    try { E.preview.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 손가락 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    E.preview.classList.add('grabbing');
    E.hint.classList.add('gone');
    ed.gesturing = true;
    beginGesture();
  });

  E.preview.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture || !ed?.ready) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.mode === 'char') {
      const dx = e.clientX - gesture.p.x;
      const dy = e.clientY - gesture.p.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      if (!gesture.moved) return;
      ed.charPos = {
        x: clamp(gesture.from.x + dx / gesture.rect.width, 0.08, 0.92),
        y: clamp(gesture.from.y + dy / gesture.rect.height, 0.08, 0.92),
      };
      schedulePreview();
      return;
    }
    const pts = [...pointers.values()];
    if (pts.length !== gesture.n) { beginGesture(); return; }
    const c = center(pts);
    let z = gesture.z;
    if (pts.length > 1 && gesture.d > 0) z = clamp(gesture.z * (spread(pts) / gesture.d), minZoom(ed), MAX_ZOOM);
    const cssSize = E.canvas.getBoundingClientRect().width || 1;
    const k = Math.min(ed.W0, ed.H0) / z / cssSize;
    ed.crop = { z, cx: gesture.cx - (c.x - gesture.p.x) * k, cy: gesture.cy - (c.y - gesture.p.y) * k };
    if (Math.abs(c.x - gesture.p.x) + Math.abs(c.y - gesture.p.y) > 2 || z !== gesture.z) gesture.moved = true;
    schedulePreview();
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture?.mode === 'char') {
      const moved = gesture.moved;
      gesture = null;
      E.preview.classList.remove('grabbing');
      if (!ed?.ready) return;
      ed.gesturing = false;
      lastTap = 0;
      if (moved) changed();
      else shufflePose(); // 캐릭터를 톡 누르면 다른 포즈
      return;
    }
    if (pointers.size) { beginGesture(); return; }
    E.preview.classList.remove('grabbing');
    const moved = gesture?.moved;
    gesture = null;
    if (!ed?.ready) return;
    ed.gesturing = false;
    if (moved) {
      lastTap = 0;
      ed.cropMoved = true;
      changed();
      return;
    }
    // 두 번 톡: 꽉 채우기 ↔ 사진 전체
    const now = performance.now();
    if (now - lastTap < 320) { lastTap = 0; toggleFit(); } else lastTap = now;
  };
  E.preview.addEventListener('pointerup', endPointer);
  E.preview.addEventListener('pointercancel', endPointer);

  // Mac 미리보기용: 휠로 확대
  E.preview.addEventListener('wheel', (e) => {
    if (!ed?.ready) return;
    e.preventDefault();
    ed.crop.z = clamp(ed.crop.z * Math.exp(-e.deltaY * 0.0015), minZoom(ed), MAX_ZOOM);
    ed.cropMoved = true;
    schedulePreview();
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
  // 끼니는 바꿀 수 없고 제목에 붙여 보여 준다 (끼니는 찍을 때 스탬프 화면에서 정한다)
  V.title.textContent = rec.meal ? `${monthDay(d)} ${mealLabel(rec.meal)}` : monthDay(d);
  V.sub.textContent = fmtClock(d);
}

function openViewer(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) return;
  const d = new Date(rec.takenAt);
  vw = {
    rec,
    url: URL.createObjectURL(rec.blob),
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

// 바꾸기: 이 사진 자리에 새 사진을 넣는다 (앱에 이미 남아 있는 사진이라 ‘저장’ 대신).
// 사진 보기를 닫고 바로 사진 고르기를 연다(아이폰은 누른 그 순간에 열어야 해서). 고르면 스탬프 화면 없이
// 같은 날 · 같은 끼니로 들어가고 이 사진은 앱에서 빠진다
function viewerReplace() {
  if (!vw) return;
  const { id, day, meal } = vw.rec;
  closeViewer();
  openInput('#input-photo', { target: { day, meal: meal ?? null, replaceOf: id } });
}

async function viewerDelete() {
  if (!vw) return;
  if (!window.confirm('이 사진을 앱에서 지울까요? 아이폰 사진 앱에 있는 사진은 그대로 남아요.')) return;
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
  $('#vw-replace').addEventListener('click', viewerReplace);
  $('#vw-del').addEventListener('click', viewerDelete);
}

init();
