// CrowdStrike University / Articulate Rise: Continue 按鈕自動化
if (window.__csuLoaded) {
  /* already injected */
} else {
window.__csuLoaded = true;

const CS_STORAGE_KEY = 'csu_automation_running';
const CONTINUE_WAIT_MS = 2500;
const IS_TOP = window === window.top;

const CONTINUE_SELECTORS = [
  'button.continue-btn',
  'button[data-continue-btn]',
  'button[data-testid="continue-btn"]',
  '[data-testid="continue-btn"]',
  '[data-continue-btn]',
  '.continue-btn'
].join(',');

let state = {
  isRunning: false,
  shouldStop: false,
  phase: 'idle',
  continueClicks: 0
};

function sendStatusUpdate(log = null, logType = 'info') {
  if (!IS_TOP) return; // 只由 top frame 更新 popup，避免刷屏
  chrome.runtime.sendMessage({
    action: 'UPDATE_PROGRESS',
    target: 'crowdstrike',
    state: {
      isRunning: state.isRunning,
      current: state.continueClicks,
      total: 0,
      phase: state.phase,
      continueClicks: state.continueClicks
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

function isProbablyInteractable(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function collectRoots() {
  const roots = [document];
  const walk = (node) => {
    if (!node?.querySelectorAll) return;
    try {
      node.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      });
    } catch {}
  };
  walk(document);
  return roots;
}

/** 本 frame 內尋找 Continue 按鈕 */
function findContinueButtonLocal() {
  const roots = collectRoots();

  for (const root of roots) {
    let nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll(CONTINUE_SELECTORS));
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (!isProbablyInteractable(el)) continue;
      const btn = el.closest('button') || (el.tagName === 'BUTTON' ? el : null) || el;
      return btn;
    }
  }

  // Fallback：任何文字為 continue 的 button
  for (const root of roots) {
    let buttons = [];
    try {
      buttons = Array.from(root.querySelectorAll('button'));
    } catch {
      continue;
    }
    for (const el of buttons) {
      if (!isProbablyInteractable(el)) continue;
      if (normalizeText(el) === 'continue') return el;
    }
  }

  // Fallback：含 CONTINUE 文字的節點，往上找 button
  for (const root of roots) {
    try {
      const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (node.childElementCount === 0 || normalizeText(node) === 'continue') {
          if (normalizeText(node) === 'continue') {
            const btn = node.closest?.('button') || node.closest?.('[data-testid="continue-btn"]');
            if (btn && isProbablyInteractable(btn)) return btn;
          }
        }
        node = walker.nextNode();
      }
    } catch {}
  }

  return null;
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

async function persistRunning(running) {
  try {
    await chrome.storage.session.set({ [CS_STORAGE_KEY]: running });
  } catch {
    await chrome.storage.local.set({ [CS_STORAGE_KEY]: running });
  }
}

async function readRunningFlag() {
  try {
    const session = await chrome.storage.session.get(CS_STORAGE_KEY);
    if (typeof session[CS_STORAGE_KEY] === 'boolean') return session[CS_STORAGE_KEY];
  } catch {}
  const local = await chrome.storage.local.get(CS_STORAGE_KEY);
  return !!local[CS_STORAGE_KEY];
}

function scrollToPageEnd() {
  try {
    const el = document.scrollingElement || document.documentElement;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    el.scrollTop = el.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  } catch {}

  try {
    document.querySelectorAll('*').forEach((el) => {
      try {
        if (el.scrollHeight > el.clientHeight + 20) {
          el.scrollTop = el.scrollHeight;
        }
      } catch {}
    });
  } catch {}
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

/** 透過 background 在所有 frame（MAIN world）尋找並點擊 Continue */
async function findAndClickContinueAcrossFrames() {
  const result = await runtimeSend({ action: 'CSU_CLICK_CONTINUE' });
  if (result?.clicked) return result;

  // fallback：本 frame content script
  const local = findContinueButtonLocal();
  if (local) {
    clickElement(local);
    return { clicked: true, where: location.href };
  }
  return result || { clicked: false };
}

async function runContinueLoop() {
  state.phase = 'continue';
  sendStatusUpdate('🔁 滾動到底並尋找 Continue（含 iframe）...');

  while (!state.shouldStop) {
    sendStatusUpdate('⬇️ 滾動至頁面底部...');
    scrollToPageEnd();
    await runtimeSend({ action: 'CSU_SCROLL_ALL' });

    let ok = await sleep(CONTINUE_WAIT_MS);
    if (!ok) return false;

    scrollToPageEnd();
    await runtimeSend({ action: 'CSU_SCROLL_ALL' });

    const result = await findAndClickContinueAcrossFrames();
    if (!result.clicked) {
      const detail = result.debug || result.error || '';
      sendStatusUpdate(
        `ℹ️ 找不到 Continue${detail ? `（${detail}）` : ''}`,
        'info'
      );
      return true;
    }

    state.continueClicks++;
    sendStatusUpdate(`▶️ 點擊 Continue (#${state.continueClicks})`, 'success');

    ok = await sleep(CONTINUE_WAIT_MS);
    if (!ok) return false;
  }
  return false;
}

function stopAutomation() {
  state.shouldStop = true;
  persistRunning(false);
  sendStatusUpdate('⏳ 正在停止...');
}

async function startAutomation() {
  if (!IS_TOP) return; // 協調只在 top frame
  if (state.isRunning) return;

  state.isRunning = true;
  state.shouldStop = false;
  state.continueClicks = 0;
  await persistRunning(true);
  sendStatusUpdate('🚀 CrowdStrike University 自動化已啟動');

  try {
    await runContinueLoop();
    if (state.shouldStop) {
      sendStatusUpdate('🛑 流程已由使用者停止', 'error');
    } else {
      sendStatusUpdate('🏁 Continue 迴圈完成', 'success');
    }
  } catch (err) {
    sendStatusUpdate(`🔥 錯誤: ${err.message}`, 'error');
  } finally {
    state.isRunning = false;
    state.phase = 'idle';
    await persistRunning(false);
    sendStatusUpdate(null); // 同步 isRunning:false 到 popup
  }
}

// 所有 frame：回應本地尋找 / 點擊 / 滾動
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CSU_LOCAL_FIND_CONTINUE') {
    const btn = findContinueButtonLocal();
    sendResponse({ found: !!btn, where: location.href });
    return false;
  }

  if (request.action === 'CSU_LOCAL_CLICK_CONTINUE') {
    const btn = findContinueButtonLocal();
    if (btn) {
      clickElement(btn);
      sendResponse({ clicked: true, where: location.href });
    } else {
      sendResponse({ clicked: false });
    }
    return false;
  }

  if (request.action === 'CSU_LOCAL_SCROLL') {
    scrollToPageEnd();
    sendResponse({ ok: true });
    return false;
  }

  if (!IS_TOP) return false;

  if (request.action === 'RUN_CSU_ACCELERATOR') {
    startAutomation();
    sendResponse({ status: 'started' });
    return true;
  }
  if (request.action === 'STOP_CSU_ACCELERATOR') {
    stopAutomation();
    sendResponse({ status: 'stopping' });
    return true;
  }
  if (request.action === 'GET_STATUS') {
    sendResponse({
      isRunning: state.isRunning,
      current: state.continueClicks,
      total: 0,
      phase: state.phase,
      continueClicks: state.continueClicks,
      target: 'crowdstrike'
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

} // end __csuLoaded guard
