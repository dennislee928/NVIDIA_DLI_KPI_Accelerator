let currentTabId = null;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusBadge = document.getElementById('statusBadge');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPercent = document.getElementById('progressPercent');
const logContainer = document.getElementById('log');

function addLog(msg, type = 'info') {
  logContainer.style.display = 'block';
  const entry = document.createElement('div');
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  if (type === 'error') entry.style.color = '#ff4444';
  if (type === 'success') entry.style.color = '#76b900';
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
    progressContainer.style.display = 'block';
  } else {
    startBtn.disabled = false;
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    statusBadge.textContent = 'Ready';
    statusBadge.classList.remove('active');
  }

  if (state.total > 0) {
    const percent = Math.round((state.current / state.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressLabel.textContent = `處理中: ${state.current} / ${state.total}`;
  }
}

// 初始化：檢查當前狀態
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  if (!tab.url.includes("learn.nvidia.com/courses/course")) {
    startBtn.disabled = true;
    addLog("請在 DLI 課程頁面使用", "error");
    return;
  }

  // 嘗試獲取 content script 狀態
  try {
    chrome.tabs.sendMessage(currentTabId, { action: "GET_STATUS" }, (response) => {
      if (chrome.runtime.lastError) {
        addLog("正在等待頁面響應...", "info");
        return;
      }
      if (response) updateUI(response);
    });
  } catch (e) {}
}

startBtn.addEventListener('click', () => {
  chrome.tabs.sendMessage(currentTabId, { action: "RUN_ACCELERATOR" }, (response) => {
    if (chrome.runtime.lastError) {
      alert("無法發送指令，請重新整理課程頁面。");
      return;
    }
    updateUI({ isRunning: true, current: 0, total: 0 });
    addLog("流程已啟動");
  });
});

stopBtn.addEventListener('click', () => {
  chrome.tabs.sendMessage(currentTabId, { action: "STOP_ACCELERATOR" }, (response) => {
    addLog("正在停止...");
  });
});

// 監聽來自 content script 的進度更新
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "UPDATE_PROGRESS") {
    updateUI(message.state);
    if (message.log) addLog(message.log, message.logType);
  }
});

init();
