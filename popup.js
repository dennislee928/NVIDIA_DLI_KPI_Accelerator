let currentTabId = null;
let currentTarget = null; // 'dli' | 'crowdstrike' | 'attackiq' | 'snyk' | null

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusBadge = document.getElementById('statusBadge');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPercent = document.getElementById('progressPercent');
const logContainer = document.getElementById('log');
const titleHeading = document.getElementById('titleHeading');
const titleText = document.getElementById('titleText');
const noteDli = document.getElementById('noteDli');
const noteCsu = document.getElementById('noteCsu');
const noteAiq = document.getElementById('noteAiq');
const noteSnyk = document.getElementById('noteSnyk');

function detectTarget(url = '') {
  if (url.includes('learn.snyk.io')) return 'snyk';
  if (url.includes('academy.attackiq.com')) return 'attackiq';
  if (url.includes('university.crowdstrike.com')) return 'crowdstrike';
  if (url.includes('learn.nvidia.com/courses/course')) return 'dli';
  return null;
}

const THEMES = {
  dli:        { cls: 'dli',  title: 'DLI Accelerator',    btn: '開始自動化流程',    note: null },
  crowdstrike:{ cls: 'csu',  title: 'CSU Accelerator',    btn: '開始 CSU 自動化',   note: null },
  attackiq:   { cls: 'aiq',  title: 'AIQ Accelerator',    btn: '開始 AIQ 自動化',   note: null },
  snyk:       { cls: 'snyk', title: 'Snyk Accelerator',   btn: '開始 Snyk 自動化',  note: null }
};

function applyTargetTheme(target) {
  currentTarget = target;

  THEMES.dli.note = noteDli;
  THEMES.crowdstrike.note = noteCsu;
  THEMES.attackiq.note = noteAiq;
  THEMES.snyk.note = noteSnyk;

  const theme = THEMES[target] || { ...THEMES.dli, title: 'Course Accelerator' };
  titleHeading.className = theme.cls;
  titleText.textContent = theme.title;
  startBtn.className = theme.cls;
  startBtn.textContent = theme.btn;

  [noteDli, noteCsu, noteAiq, noteSnyk].forEach((n) => n.classList.add('hidden'));
  (theme.note || noteDli).classList.remove('hidden');

  progressFill.classList.remove('csu', 'aiq', 'snyk');
  if (theme.cls !== 'dli') progressFill.classList.add(theme.cls);
}

function addLog(msg, type = 'info') {
  logContainer.style.display = 'block';
  const entry = document.createElement('div');
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  if (type === 'error') entry.style.color = '#ff4444';
  if (type === 'success') {
    entry.style.color =
      currentTarget === 'crowdstrike' ? '#fc0' :
      currentTarget === 'attackiq' ? '#f60' :
      currentTarget === 'snyk' ? '#a78bfa' : '#76b900';
  }
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateUI(state) {
  if (state.isRunning) {
    startBtn.disabled = true;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    statusBadge.textContent = 'Running';
    statusBadge.classList.add('active');
    statusBadge.classList.toggle('csu', currentTarget === 'crowdstrike');
    statusBadge.classList.toggle('aiq', currentTarget === 'attackiq');
    statusBadge.classList.toggle('snyk', currentTarget === 'snyk');
    progressContainer.style.display = 'block';
  } else {
    startBtn.disabled = false;
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    statusBadge.textContent = 'Ready';
    statusBadge.classList.remove('active', 'csu', 'aiq', 'snyk');
  }

  if (currentTarget === 'snyk') {
    const phaseLabel =
      state.phase === 'section' ? 'Section 停留中' :
      state.phase === 'quiz' ? 'Quiz 作答中' :
      state.isRunning ? '執行中' : '待命';
    const quiz = state.quizSolved || 0;
    if (state.total > 0) {
      const percent = Math.round((state.current / state.total) * 100);
      progressFill.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressLabel.textContent = `${phaseLabel} ${state.current}/${state.total} | Quiz: ${quiz}`;
    } else {
      progressFill.style.width = '100%';
      progressPercent.textContent = state.isRunning ? '∞' : '';
      progressLabel.textContent = `${phaseLabel} | Quiz: ${quiz}`;
    }
    return;
  }

  if (currentTarget === 'attackiq') {
    const lessons = state.lessonsCompleted || 0;
    const phaseLabel =
      state.phase === 'play' ? '播放影片' :
      state.phase === 'countdown' ? '等待倒數' :
      state.phase === 'scan' ? '檢查課程' :
      state.isRunning ? '執行中' : '待命';
    progressLabel.textContent = `${phaseLabel} | 已完成課程: ${lessons}`;
    progressPercent.textContent = state.isRunning ? '∞' : '';
    progressFill.style.width = '100%';
    return;
  }

  if (currentTarget === 'crowdstrike') {
    const cont = state.continueClicks || 0;
    const phaseLabel =
      state.phase === 'continue' ? 'Continue 迴圈' :
      state.isRunning ? '執行中' : '待命';
    progressLabel.textContent = `${phaseLabel} | 已點擊: ${cont}`;
    progressPercent.textContent = state.isRunning ? '∞' : '';
    progressFill.style.width = '100%';
    return;
  }

  if (state.total > 0) {
    const percent = Math.round((state.current / state.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressLabel.textContent = `處理中: ${state.current} / ${state.total}`;
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  const target = detectTarget(tab.url || '');
  applyTargetTheme(target);

  if (!target) {
    startBtn.disabled = true;
    addLog('請在 NVIDIA DLI 或 CrowdStrike University 課程頁面使用', 'error');
    return;
  }

  if (target === 'crowdstrike') {
    addLog('已切換至 CrowdStrike University 模式');
  }

  if (target === 'attackiq') {
    addLog('已切換至 AttackIQ Academy 模式');
  }

  if (target === 'snyk') {
    addLog('已切換至 Snyk Learn 模式');
  }

  try {
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        addLog('正在等待頁面響應...', 'info');
        return;
      }
      if (response) updateUI(response);
    });
  } catch (e) {}
}

startBtn.addEventListener('click', async () => {
  if (!currentTarget) return;

  if (currentTarget === 'snyk') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content-snyk.js']
      });
    } catch (e) {
      console.warn('inject:', e);
    }

    chrome.tabs.sendMessage(currentTabId, { action: 'RUN_SNYK_ACCELERATOR' }, () => {
      if (chrome.runtime.lastError) {
        alert('無法發送指令，請重新整理課程頁面。');
        return;
      }
      updateUI({ isRunning: true, current: 0, total: 0, quizSolved: 0, phase: 'section' });
      addLog('Snyk 流程已啟動');
    });
    return;
  }

  if (currentTarget === 'attackiq') {
    try {
      // 強制注入（防止安裝/更新後尚未載入 content script）
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId, allFrames: true },
        files: ['content-attackiq.js']
      });
    } catch (e) {
      console.warn('inject frames:', e);
    }

    chrome.tabs.sendMessage(currentTabId, { action: 'RUN_AIQ_ACCELERATOR' }, () => {
      if (chrome.runtime.lastError) {
        alert('無法發送指令，請重新整理課程頁面。');
        return;
      }
      updateUI({ isRunning: true, current: 0, total: 0, lessonsCompleted: 0, phase: 'scan' });
      addLog('AIQ 流程已啟動');
    });
    return;
  }

  if (currentTarget === 'crowdstrike') {
    try {
      // 強制注入所有 frame（含動態載入的 Rise iframe）
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId, allFrames: true },
        files: ['content-crowdstrike.js']
      });
    } catch (e) {
      console.warn('inject frames:', e);
    }

    chrome.runtime.sendMessage(
      {
        action: 'CSU_BROADCAST',
        tabId: currentTabId,
        payload: { action: 'RUN_CSU_ACCELERATOR' }
      },
      (results) => {
        if (chrome.runtime.lastError || !results || results.length === 0) {
          chrome.tabs.sendMessage(currentTabId, { action: 'RUN_CSU_ACCELERATOR' }, () => {
            if (chrome.runtime.lastError) {
              alert('無法發送指令，請重新整理課程頁面。');
            }
          });
        }
        updateUI({ isRunning: true, current: 0, total: 0, continueClicks: 0, phase: 'continue' });
        addLog('CSU 流程已啟動（含所有 iframe）');
      }
    );
    return;
  }

  chrome.tabs.sendMessage(currentTabId, { action: 'RUN_ACCELERATOR' }, () => {
    if (chrome.runtime.lastError) {
      alert('無法發送指令，請重新整理課程頁面。');
      return;
    }
    updateUI({ isRunning: true, current: 0, total: 0 });
    addLog('流程已啟動');
  });
});

stopBtn.addEventListener('click', () => {
  if (!currentTarget) return;
  if (currentTarget === 'snyk') {
    chrome.tabs.sendMessage(currentTabId, { action: 'STOP_SNYK_ACCELERATOR' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
    addLog('正在停止...');
    return;
  }
  if (currentTarget === 'attackiq') {
    chrome.tabs.sendMessage(currentTabId, { action: 'STOP_AIQ_ACCELERATOR' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
    addLog('正在停止...');
    return;
  }
  if (currentTarget === 'crowdstrike') {
    chrome.runtime.sendMessage({
      action: 'CSU_BROADCAST',
      tabId: currentTabId,
      payload: { action: 'STOP_CSU_ACCELERATOR' }
    });
    addLog('正在停止...');
    return;
  }
  chrome.tabs.sendMessage(currentTabId, { action: 'STOP_ACCELERATOR' }, () => {
    addLog('正在停止...');
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'UPDATE_PROGRESS') return;
  if (message.target && message.target !== currentTarget) return;
  if (!message.target && currentTarget !== 'dli') return;

  updateUI(message.state);
  if (message.log) addLog(message.log, message.logType);
});

init();
