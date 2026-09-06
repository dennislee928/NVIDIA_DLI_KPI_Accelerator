// AttackIQ Academy: 播放影片 → 等倒數 00:00 → Complete → Next Lesson 自動化
if (window.__aiqLoaded) {
  /* already injected */
} else {
window.__aiqLoaded = true;

const AIQ_STORAGE_KEY = 'aiq_automation_running';
const IS_TOP = window === window.top;

const COMPLETE_DELAY_MS = 1500;   // 倒數歸零後等待
const NEXT_DELAY_MS = 2000;       // 點 Complete 後等待
const LESSON_LOAD_MS = 3000;      // 點 Next Lesson 後等待新課載入
const POLL_MS = 1000;             // 倒數輪詢間隔

const TIMER_RE = /^\s*\d{1,3}:\d{2}\s*$/;
const TIMER_ZERO_RE = /^\s*0{1,3}:00\s*$/;
// 排除影片播放器內部的時間顯示（進度時間、tooltip 等）
const PLAYER_ANCESTOR_SELECTOR = [
  'video', 'audio',
  '[class*="player" i]', '[class*="video" i]', '[class*="controls" i]',
  '[class*="jw-" i]', '[class*="vjs-" i]', '[class*="plyr" i]', '[class*="mejs" i]'
].join(',');

let state = {
  isRunning: false,
  shouldStop: false,
  phase: 'idle',
  lessonsCompleted: 0
};

function sendStatusUpdate(log = null, logType = 'info') {
  if (!IS_TOP) return;
  chrome.runtime.sendMessage({
    action: 'UPDATE_PROGRESS',
    target: 'attackiq',
    state: {
      isRunning: state.isRunning,
      current: state.lessonsCompleted,
      total: 0,
      phase: state.phase,
      lessonsCompleted: state.lessonsCompleted
    },
    log,
    logType
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (state.shouldStop) {
        resolve(false);
        return;
      }
      if (Date.now() - start >= ms) {
        resolve(true);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

function normalizeText(el) {
  if (!el) return '';
  return String(el.innerText || el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function clickElement(el) {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {}
  el.focus?.();
  ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    } catch {}
  });
  try {
    el.click();
  } catch {}
}

function findButton(pred) {
  const candidates = document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    if (pred(normalizeText(el), el)) return el;
  }
  return null;
}

const findCompleteButton = () => findButton((t) => t === 'complete');
const findNextLessonButton = () => findButton((t) => t === 'next lesson' || t.startsWith('next lesson'));

/** 是否已到 Final Exam（停止條件）：Lab Exercise 與一般課程相同流程，直接照常處理 */
function isFinalExamLesson() {
  for (const h of document.querySelectorAll('h1, h2')) {
    const t = normalizeText(h);
    if (t.includes('final exam')) return true;
  }
  const examBtn = findButton((t) => /^(start|begin|take|launch)\b.*\bexam\b/.test(t));
  return !!examBtn;
}

/** 尋找課程要求的倒數計時（非播放器內的時間） */
function getCountdownTexts() {
  const matches = [];
  try {
    document.querySelectorAll('body *').forEach((el) => {
      if (el.childElementCount > 0) return;
      const t = (el.textContent || '').trim();
      if (!TIMER_RE.test(t)) return;
      if (el.closest(PLAYER_ANCESTOR_SELECTOR)) return;
      if (!isVisible(el)) return;
      matches.push(t);
    });
  } catch {}
  return matches;
}

/** true = 倒數已歸零, false = 還在倒數, null = 找不到倒數元素 */
function countdownDone() {
  const texts = getCountdownTexts();
  if (!texts.length) return null;
  return texts.every((t) => TIMER_ZERO_RE.test(t));
}

function pageShowsCompleted() {
  try {
    return /completed!/i.test(document.body.innerText || '');
  } catch {
    return false;
  }
}

function runtimeSend(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

/** 透過 background 於所有 frame（MAIN world）播放影片 */
async function playVideos() {
  const result = await runtimeSend({ action: 'AIQ_PLAY_VIDEO' });
  if (result?.played) return result;

  // fallback：本 frame 直接播放
  let played = false;
  document.querySelectorAll('video').forEach((v) => {
    try {
      v.muted = true;
      if (v.paused) v.play().catch(() => {});
      played = true;
    } catch {}
  });
  if (!played) {
    const playBtn = findButton((t, el) => {
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
      return label.includes('play') && !label.includes('pause');
    });
    if (playBtn) {
      clickElement(playBtn);
      played = true;
    }
  }
  return { played };
}

async function persistRunning(running) {
  try {
    await chrome.storage.session.set({ [AIQ_STORAGE_KEY]: running });
  } catch {
    await chrome.storage.local.set({ [AIQ_STORAGE_KEY]: running });
  }
}

async function readRunningFlag() {
  try {
    const session = await chrome.storage.session.get(AIQ_STORAGE_KEY);
    if (typeof session[AIQ_STORAGE_KEY] === 'boolean') return session[AIQ_STORAGE_KEY];
  } catch {}
  const local = await chrome.storage.local.get(AIQ_STORAGE_KEY);
  return !!local[AIQ_STORAGE_KEY];
}

async function runLessonLoop() {
  while (!state.shouldStop) {
    state.phase = 'scan';
    sendStatusUpdate('🔍 檢查目前課程...');

    if (isFinalExamLesson()) {
      sendStatusUpdate('🎓 偵測到 Final Exam，自動化停止', 'success');
      return true;
    }

    // 1) 點擊播放
    state.phase = 'play';
    const playResult = await playVideos();
    sendStatusUpdate(playResult?.played ? '▶️ 已觸發影片播放' : 'ℹ️ 找不到影片，直接等待倒數/Complete');

    // 2) 等倒數到 00:00（或 Complete 按鈕可用 / 已完成）
    state.phase = 'countdown';
    sendStatusUpdate('⏳ 等待倒數計時歸零...');
    let ticks = 0;
    while (!state.shouldStop) {
      const done = countdownDone();
      if (done === true) {
        sendStatusUpdate('⏱️ 倒數已歸零 (00:00)');
        break;
      }
      if (done === null && (findCompleteButton() || pageShowsCompleted())) {
        sendStatusUpdate('ℹ️ 無倒數計時，Complete 已可用');
        break;
      }
      // 每 10 秒重新確保影片持續播放（避免被暫停）
      ticks++;
      if (ticks % 10 === 0) await playVideos();
      if (!(await sleep(POLL_MS))) return false;
    }
    if (state.shouldStop) return false;

    // 3) 等 1.5 秒 → 點 Complete
    if (!(await sleep(COMPLETE_DELAY_MS))) return false;
    const completeBtn = findCompleteButton();
    if (completeBtn) {
      clickElement(completeBtn);
      state.lessonsCompleted++;
      sendStatusUpdate(`✅ 已點擊 Complete (#${state.lessonsCompleted})`, 'success');
    } else if (pageShowsCompleted()) {
      sendStatusUpdate('ℹ️ 本課已是 COMPLETED，跳過 Complete');
    } else {
      sendStatusUpdate('⚠️ 找不到 Complete 按鈕', 'error');
    }

    // 4) 等 2 秒 → 點 Next Lesson
    if (!(await sleep(NEXT_DELAY_MS))) return false;
    let nextBtn = null;
    for (let i = 0; i < 10 && !nextBtn && !state.shouldStop; i++) {
      nextBtn = findNextLessonButton();
      if (!nextBtn && !(await sleep(1000))) return false;
    }
    if (state.shouldStop) return false;
    if (!nextBtn) {
      sendStatusUpdate('🏁 找不到 Next Lesson，流程結束', 'success');
      return true;
    }
    clickElement(nextBtn);
    sendStatusUpdate('➡️ 已點擊 Next Lesson');

    if (!(await sleep(LESSON_LOAD_MS))) return false;
  }
  return false;
}

function stopAutomation() {
  state.shouldStop = true;
  persistRunning(false);
  sendStatusUpdate('⏳ 正在停止...');
}

async function startAutomation() {
  if (!IS_TOP) return;
  if (state.isRunning) return;

  state.isRunning = true;
  state.shouldStop = false;
  state.lessonsCompleted = 0;
  await persistRunning(true);
  sendStatusUpdate('🚀 AttackIQ Academy 自動化已啟動');

  try {
    const finished = await runLessonLoop();
    if (state.shouldStop) {
      sendStatusUpdate('🛑 流程已由使用者停止', 'error');
    } else if (finished) {
      sendStatusUpdate(`🏁 自動化結束，共完成 ${state.lessonsCompleted} 課`, 'success');
    }
  } catch (err) {
    sendStatusUpdate(`🔥 錯誤: ${err.message}`, 'error');
  } finally {
    state.isRunning = false;
    state.phase = 'idle';
    await persistRunning(false);
    sendStatusUpdate(null);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!IS_TOP) return false;

  if (request.action === 'RUN_AIQ_ACCELERATOR') {
    startAutomation();
    sendResponse({ status: 'started' });
    return true;
  }
  if (request.action === 'STOP_AIQ_ACCELERATOR') {
    stopAutomation();
    sendResponse({ status: 'stopping' });
    return true;
  }
  if (request.action === 'GET_STATUS') {
    sendResponse({
      isRunning: state.isRunning,
      current: state.lessonsCompleted,
      total: 0,
      phase: state.phase,
      lessonsCompleted: state.lessonsCompleted,
      target: 'attackiq'
    });
    return true;
  }
  return false;
});

// 頁面重新載入時，若先前正在執行則自動接續（SPA 換課通常不會重載，此為保險）
if (IS_TOP) {
  readRunningFlag().then((wasRunning) => {
    if (wasRunning && !state.isRunning) {
      sendStatusUpdate('♻️ 偵測到進行中狀態，自動接續...');
      startAutomation();
    }
  });
}

} // end __aiqLoaded guard
