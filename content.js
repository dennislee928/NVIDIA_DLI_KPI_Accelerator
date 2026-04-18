const API_CONFIG = {
  COMPLETION_BASE: 'https://learn.learn.nvidia.com/api/ibl/completion/course_outline/'
};

// 狀態追蹤
let state = {
  isRunning: false,
  total: 0,
  current: 0,
  shouldStop: false
};

function sendStatusUpdate(log = null, logType = 'info') {
  chrome.runtime.sendMessage({
    action: "UPDATE_PROGRESS",
    state: state,
    log: log,
    logType: logType
  }).catch(() => {
    // 忽略 Popup 關閉導致的錯誤
  });
}

function getCookie(name) {
  let value = "; " + document.cookie;
  let parts = value.split("; " + name + "=");
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function flattenBlocks(children, list = []) {
  children.forEach(child => {
    if ((child.type === 'html' || child.type === 'video') && child.completion < 1.0) {
      list.push({ id: child.id, type: child.type, name: child.display_name });
    }
    if (child.children) flattenBlocks(child.children, list);
  });
  return list;
}

async function startAutomation() {
  if (state.isRunning) return;
  
  // 修正：直接從 URL 提取 course_id 以避免 '+' 被轉為空格
  const courseIdMatch = window.location.search.match(/[?&]course_id=([^&]+)/);
  const courseId = courseIdMatch ? decodeURIComponent(courseIdMatch[1]) : null;
  // 如果解碼後還是有空格，嘗試將其轉回 '+' (DLI ID 慣例)
  const normalizedCourseId = courseId ? courseId.replace(/\s/g, '+') : null;
  
  const csrf = getCookie('csrftoken');

  if (!normalizedCourseId || !csrf) {
    const errorMsg = '❌ 無法獲取 Course ID 或 CSRF Token';
    console.error(errorMsg);
    sendStatusUpdate(errorMsg, 'error');
    return;
  }

  state.isRunning = true;
  state.shouldStop = false;
  state.current = 0;
  sendStatusUpdate(`🔍 掃描課程: ${normalizedCourseId}`);
  
  try {
    // 修正：包含 course_id query parameter 並加入 CSRF Token 與 credentials 以解決 401
    const apiUrl = `${API_CONFIG.COMPLETION_BASE}${normalizedCourseId}?course_id=${encodeURIComponent(normalizedCourseId)}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-CSRFToken': csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/plain, */*'
      },
      credentials: 'include' // 重要：跨網域 (subdomain) 傳遞 Session Cookie
    });

    if (response.status === 401) {
      throw new Error("401 Unauthorized: 請檢查是否已登入 NVIDIA DLI 且 Session 有效");
    }

    if (!response.ok) throw new Error(`無法讀取課程大綱 (Status: ${response.status})`);

    
    const data = await response.json();
    const incompleteBlocks = flattenBlocks(data.children);

    state.total = incompleteBlocks.length;
    if (state.total === 0) {
      state.isRunning = false;
      sendStatusUpdate('✅ 沒有發現未完成的節點', 'success');
      return;
    }

    sendStatusUpdate(`📊 發現 ${state.total} 個待處理節點`);

    for (const block of incompleteBlocks) {
      if (state.shouldStop) {
        sendStatusUpdate('🛑 流程已由使用者停止', 'error');
        break;
      }

      state.current++;
      sendStatusUpdate(`⏳ 正在處理: ${block.name}`);
      
      // 隨機延遲 5~12 秒
      const jitter = Math.floor(Math.random() * 7000) + 5000;
      await new Promise(r => setTimeout(r, jitter));

      if (state.shouldStop) {
        sendStatusUpdate('🛑 流程已於延遲中停止', 'error');
        break;
      }

      const targetUrl = `https://learn.learn.nvidia.com/courses/${normalizedCourseId}/xblock/${block.id}/handler/publish_completion?course_id=${encodeURIComponent(normalizedCourseId)}`;
      
      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrf,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include',
          body: JSON.stringify({ "completion": 1.0 })
        });

        if (res.ok) {
          sendStatusUpdate(`✅ 完成: ${block.name}`, 'success');
        } else {
          sendStatusUpdate(`⚠️ 失敗: ${block.name} (${res.status})`, 'error');
        }
      } catch (postErr) {
        sendStatusUpdate(`❌ 請求錯誤: ${block.name}`, 'error');
      }
    }
    
    state.isRunning = false;
    if (!state.shouldStop) {
      sendStatusUpdate('🏁 所有節點處理完畢！', 'success');
      alert('自動化流程結束，請重新整理頁面查看結果。');
    }
  } catch (err) {
    state.isRunning = false;
    console.error('🔥 發生錯誤:', err);
    sendStatusUpdate(`🔥 錯誤: ${err.message}`, 'error');
  }
}

// 監聽來自 Popup 的指令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "RUN_ACCELERATOR") {
    startAutomation();
    sendResponse({status: "started"});
  } else if (request.action === "STOP_ACCELERATOR") {
    state.shouldStop = true;
    sendResponse({status: "stopping"});
  } else if (request.action === "GET_STATUS") {
    sendResponse(state);
  }
  return true;
});
