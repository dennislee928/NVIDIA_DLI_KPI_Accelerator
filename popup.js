let currentTabId = null;
let currentTarget = null; // 'dli' | 'crowdstrike' | null

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

function detectTarget(url = '') {
  if (url.includes('university.crowdstrike.com')) return 'crowdstrike';
  if (url.includes('learn.nvidia.com/courses/course')) return 'dli';
  return null;
}

function applyTargetTheme(target) {
  currentTarget = target;

  if (target === 'crowdstrike') {
    titleHeading.className = 'csu';
    titleText.textContent = 'CSU Accelerator';
    startBtn.className = 'csu';
    startBtn.textContent = '開始 CSU 自動化';
    noteDli.classList.add('hidden');
    noteCsu.classList.remove('hidden');
    progressFill.classList.add('csu');
  } else if (target === 'dli') {
    titleHeading.className = 'dli';
    titleText.textContent = 'DLI Accelerator';
    startBtn.className = 'dli';
    startBtn.textContent = '開始自動化流程';
    noteCsu.classList.add('hidden');
    noteDli.classList.remove('hidden');
    progressFill.classList.remove('csu');
  } else {
    titleHeading.className = 'dli';
    titleText.textContent = 'Course Accelerator';
    startBtn.className = 'dli';
    startBtn.textContent = '開始自動化流程';
    noteCsu.classList.add('hidden');
    noteDli.classList.remove('hidden');
    progressFill.classList.remove('csu');
  }
}

function addLog(msg, type = 'info') {
  logContainer.style.display = 'block';
  const entry = document.createElement('div');
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  if (type === 'error') entry.style.color = '#ff4444';
  if (type === 'success') entry.style.color = currentTarget === 'crowdstrike' ? '#fc0' : '#76b900';
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
    if (currentTarget === 'crowdstrike') statusBadge.classList.add('csu');
    else statusBadge.classList.remove('csu');
    progressContainer.style.display = 'block';
  } else {
    startBtn.disabled = false;
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    statusBadge.textContent = 'Ready';
    statusBadge.classList.remove('active', 'csu');
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
  if (message.target === 'crowdstrike' && currentTarget !== 'crowdstrike') return;
  if (!message.target && currentTarget === 'crowdstrike') return;

  updateUI(message.state);
  if (message.log) addLog(message.log, message.logType);
});

init();
