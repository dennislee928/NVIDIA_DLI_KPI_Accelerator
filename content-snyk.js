// Snyk Learn: 逐 section 停留 10 秒 → Quiz 逐選項嘗試直到 Correct!
if (window.__snykLoaded) {
  /* already injected */
} else {
window.__snykLoaded = true;

const SNYK_STORAGE_KEY = 'snyk_automation_running';
const IS_TOP = window === window.top;

const SECTION_DWELL_MS = 10000;   // 每個 section 停留時間
const QUIZ_FEEDBACK_MS = 2000;    // 點 Confirm 後等待回應
const QUIZ_SELECT_MS = 500;       // 選取選項後的短暫等待

// "Correct!" 前一字元不可為英文字母，避免誤判 "Incorrect!"
const CORRECT_RE = /(?:^|[^a-z])correct!/i;

let state = {
  isRunning: false,
  shouldStop: false,
  phase: 'idle',
  current: 0,
  total: 0,
  quizSolved: 0
};

function sendStatusUpdate(log = null, logType = 'info') {
  if (!IS_TOP) return;
  chrome.runtime.sendMessage({
    action: 'UPDATE_PROGRESS',
    target: 'snyk',
    state: {
      isRunning: state.isRunning,
      current: state.current,
      total: state.total,
      phase: state.phase,
      quizSolved: state.quizSolved
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

/** 課程頁的 section 目錄連結（同頁 anchor） */
function getSectionLinks() {
  const links = [];
  const seen = new Set();
  const addLink = (a, hash) => {
    if (!hash || hash === '#') return;
    if (!isVisible(a)) return;
    const text = normalizeText(a) || String(a.getAttribute('title') || '').trim().toLowerCase() || hash;
    if (seen.has(hash)) return;
    seen.add(hash);
    links.push({ el: a, hash, text });
  };

  // Snyk Learn TOC：<a class="tableOfContents__row-title" href="/lesson/xxx/#step-<uuid>">
  document.querySelectorAll('a[href*="#step-"], a.tableOfContents__row-title').forEach((a) => {
    try {
      const u = new URL(a.getAttribute('href') || '', location.href);
      if (u.hash) addLink(a, u.hash);
    } catch {}
  });
  if (links.length) return links;

  // 通用 fallback：同頁 anchor（pathname 忽略尾斜線差異）
  const normPath = (p) => (p || '').replace(/\/+$/, '');
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    let hash = null;
    if (href.startsWith('#')) {
      hash = href;
    } else {
      try {
        const u = new URL(href, location.href);
        if (u.origin === location.origin && normPath(u.pathname) === normPath(location.pathname) && u.hash) {
          hash = u.hash;
        }
      } catch {}
    }
    if (hash) addLink(a, hash);
  });
  return links;
}

/** 在 section 內由上往下漸進捲動並停留，觸發閱讀時間 / 已讀標記 */
async function dwellInSection(hash, dwellMs) {
  const id = (hash || '').replace(/^#/, '');
  const sectionEl = id ? document.getElementById(id) : null;
  const steps = 5;
  const stepMs = Math.floor(dwellMs / steps);

  for (let i = 0; i < steps; i++) {
    if (state.shouldStop) return false;
    try {
      if (sectionEl) {
        const rect = sectionEl.getBoundingClientRect();
        const absTop = window.scrollY + rect.top;
        const maxTarget = absTop + Math.max(rect.height - window.innerHeight * 0.5, 0);
        const target = Math.min(absTop + (rect.height * i) / steps, maxTarget);
        window.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
      } else {
        window.scrollBy({ top: i % 2 ? -60 : 60, behavior: 'smooth' });
      }
      window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    } catch {}
    if (!(await sleep(stepMs))) return false;
  }
  return true;
}

/* ---------- Quiz ---------- */

function getQuizGroups() {
  const byName = new Map();
  const byContainer = new Map();
  document.querySelectorAll('input[type="radio"]').forEach((r) => {
    // 樣式化 radio 常會隱藏 input 本身，改以 label / 容器判斷可見性
    const label = r.closest('label') || (r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null);
    if (!isVisible(r) && !isVisible(label)) return;
    const container =
      r.closest('form, fieldset, [class*="quiz" i], [data-testid*="quiz" i]') ||
      r.closest('section, article') ||
      document.body;
    const map = r.name ? byName : byContainer;
    const key = r.name ? r.name : container;
    if (!map.has(key)) map.set(key, { radios: [], labels: [], container });
    const g = map.get(key);
    g.radios.push(r);
    g.labels.push(label);
  });
  return [...byName.values(), ...byContainer.values()].filter((g) => g.radios.length >= 2);
}

function containerHasCorrect(container) {
  try {
    return CORRECT_RE.test((container.innerText || '').toLowerCase());
  } catch {
    return false;
  }
}

function selectOption(radio, label) {
  const target = label || radio;
  clickElement(target);
  try {
    if (!radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {}
}

function findButtonIn(scope, pred) {
  const candidates = scope.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
  for (const el of candidates) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (!isVisible(el)) continue;
    if (pred(normalizeText(el), el)) return el;
  }
  return null;
}

function findConfirmButton(container) {
  const pred = (t) => t === 'confirm' || t.startsWith('confirm') || t === 'submit' || t === 'check answer';
  return findButtonIn(container, pred) || findButtonIn(document, pred);
}

function findRetryButton(container) {
  const pred = (t) => t === 'try again' || t.startsWith('try again') || t === 'retry';
  return findButtonIn(container, pred) || findButtonIn(document, pred);
}

/** 逐一嘗試選項直到出現 Correct! */
async function solveQuizGroup(group, index) {
  if (containerHasCorrect(group.container)) {
    sendStatusUpdate(`ℹ️ Quiz #${index + 1} 已是 Correct，跳過`);
    return true;
  }

  for (let i = 0; i < group.radios.length; i++) {
    if (state.shouldStop) return false;

    const optionText = normalizeText(group.labels[i]) || `option ${i + 1}`;
    sendStatusUpdate(`📝 Quiz #${index + 1}: 嘗試選項 ${i + 1}「${optionText.slice(0, 40)}」`);
    selectOption(group.radios[i], group.labels[i]);
    if (!(await sleep(QUIZ_SELECT_MS))) return false;

    const confirmBtn = findConfirmButton(group.container);
    if (!confirmBtn) {
      sendStatusUpdate(`⚠️ Quiz #${index + 1}: 找不到 Confirm 按鈕`, 'error');
      return false;
    }
    clickElement(confirmBtn);
    if (!(await sleep(QUIZ_FEEDBACK_MS))) return false;

    if (containerHasCorrect(group.container)) {
      state.quizSolved++;
      sendStatusUpdate(`✅ Quiz #${index + 1}: Correct!（選項 ${i + 1}）`, 'success');
      return true;
    }

    sendStatusUpdate(`❎ Quiz #${index + 1}: 選項 ${i + 1} 不正確，換下一個`);
    const retryBtn = findRetryButton(group.container);
    if (retryBtn) {
      clickElement(retryBtn);
      if (!(await sleep(800))) return false;
    }
  }

  sendStatusUpdate(`⚠️ Quiz #${index + 1}: 所有選項都試過仍未出現 Correct!`, 'error');
  return false;
}

async function solveAllQuizzes() {
  const groups = getQuizGroups();
  if (!groups.length) {
    sendStatusUpdate('ℹ️ 頁面上找不到 Quiz 選項');
    return false;
  }
  let any = false;
  for (let i = 0; i < groups.length; i++) {
    if (state.shouldStop) return any;
    const ok = await solveQuizGroup(groups[i], i);
    any = any || ok;
  }
  return any;
}

/* ---------- 主流程 ---------- */

async function runLesson() {
  state.phase = 'section';
  let links = getSectionLinks();
  let quizHandled = false;

  if (links.length) {
    state.total = links.length;
    sendStatusUpdate(`📚 發現 ${links.length} 個 section`);

    for (let i = 0; i < links.length; i++) {
      if (state.shouldStop) return false;
      const { el, hash, text } = links[i];
      state.current = i + 1;
      state.phase = 'section';
      sendStatusUpdate(`📖 前往 section (${i + 1}/${links.length}): ${text}，停留 10 秒`);
      clickElement(el);
      if (!(await sleep(800))) return false;
      if (!(await dwellInSection(hash, SECTION_DWELL_MS))) return false;

      if (text.includes('quiz')) {
        state.phase = 'quiz';
        quizHandled = (await solveAllQuizzes()) || quizHandled;
        if (state.shouldStop) return false;
      }
    }
  } else {
    // fallback：沒有目錄連結時，逐標題捲動
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(isVisible);
    state.total = headings.length;
    sendStatusUpdate(`ℹ️ 找不到 section 目錄，改以 ${headings.length} 個標題逐段捲動`);
    for (let i = 0; i < headings.length; i++) {
      if (state.shouldStop) return false;
      state.current = i + 1;
      sendStatusUpdate(`📖 捲動至 (${i + 1}/${headings.length}): ${normalizeText(headings[i]).slice(0, 40)}，停留 10 秒`);
      try {
        headings[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
      if (!(await sleep(SECTION_DWELL_MS))) return false;
    }
  }

  // 目錄裡沒有 Quiz section 時，最後再掃一次頁面上的 Quiz
  if (!quizHandled && !state.shouldStop) {
    state.phase = 'quiz';
    await solveAllQuizzes();
  }
  return !state.shouldStop;
}

async function persistRunning(running) {
  try {
    await chrome.storage.session.set({ [SNYK_STORAGE_KEY]: running });
  } catch {
    await chrome.storage.local.set({ [SNYK_STORAGE_KEY]: running });
  }
}

async function readRunningFlag() {
  try {
    const session = await chrome.storage.session.get(SNYK_STORAGE_KEY);
    if (typeof session[SNYK_STORAGE_KEY] === 'boolean') return session[SNYK_STORAGE_KEY];
  } catch {}
  const local = await chrome.storage.local.get(SNYK_STORAGE_KEY);
  return !!local[SNYK_STORAGE_KEY];
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
  state.current = 0;
  state.total = 0;
  state.quizSolved = 0;
  await persistRunning(true);
  sendStatusUpdate('🚀 Snyk Learn 自動化已啟動');

  try {
    const finished = await runLesson();
    if (state.shouldStop) {
      sendStatusUpdate('🛑 流程已由使用者停止', 'error');
    } else if (finished) {
      sendStatusUpdate(`🏁 課程流程完成（Quiz 通過 ${state.quizSolved} 題）`, 'success');
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

  if (request.action === 'RUN_SNYK_ACCELERATOR') {
    startAutomation();
    sendResponse({ status: 'started' });
    return true;
  }
  if (request.action === 'STOP_SNYK_ACCELERATOR') {
    stopAutomation();
    sendResponse({ status: 'stopping' });
    return true;
  }
  if (request.action === 'GET_STATUS') {
    sendResponse({
      isRunning: state.isRunning,
      current: state.current,
      total: state.total,
      phase: state.phase,
      quizSolved: state.quizSolved,
      target: 'snyk'
    });
    return true;
  }
  return false;
});

if (IS_TOP) {
  readRunningFlag().then((wasRunning) => {
    if (wasRunning && !state.isRunning) {
      sendStatusUpdate('♻️ 偵測到進行中狀態，自動接續...');
      startAutomation();
    }
  });
}

} // end __snykLoaded guard
