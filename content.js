
const API_CONFIG = {
  COMPLETION_BASE: 'https://learn.learn.nvidia.com/api/ibl/completion/course_outline/'
};

// 提取 Cookie
function getCookie(name) {
  let value = "; " + document.cookie;
  let parts = value.split("; " + name + "=");
  if (parts.length === 2) return parts.pop().split(";").shift();
}

// 遞歸展開所有未完成節點
function flattenBlocks(children, list = []) {
  children.forEach(child => {
    if ((child.type === 'html' || child.type === 'video') && child.completion < 1.0) {
      list.push({ id: child.id, type: child.type, name: child.display_name });
    }
    if (child.children) flattenBlocks(child.children, list);
  });
  return list;
}

// 執行爆破邏輯
async function startAutomation() {
  const urlParams = new URLSearchParams(window.location.search);
  const courseId = urlParams.get('course_id');
  const csrf = getCookie('csrftoken');

  if (!courseId || !csrf) {
    console.error('❌ 無法獲取 Course ID 或 CSRF Token');
    return;
  }

  console.log(`🔍 正在掃描課程: ${courseId}`);
  
  try {
    const response = await fetch(`${API_CONFIG.COMPLETION_BASE}${courseId}`);
    const data = await response.json();
    const incompleteBlocks = flattenBlocks(data.children);

    console.log(`📊 發現 ${incompleteBlocks.length} 個待處理節點`);

    for (const block of incompleteBlocks) {
      console.log(`⏳ 正在處理 [${block.type}] ${block.name}...`);
      
      // 隨機延遲 5~12 秒，模擬人類行為以避開簡單的流量監控
      const jitter = Math.floor(Math.random() * 7000) + 5000;
      await new Promise(r => setTimeout(r, jitter));

      const targetUrl = `https://learn.learn.nvidia.com/courses/${courseId}/xblock/${block.id}/handler/publish_completion`;
      
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ "completion": 1.0 })
      });

      if (res.ok) {
        console.log(`✅ 已完成: ${block.name}`);
      } else {
        console.warn(`⚠️ 節點 ${block.name} 回傳狀態碼: ${res.status}`);
      }
    }
    console.log('🏁 所有節點處理完畢！');
    alert('自動化流程結束，請重新整理頁面查看結果。');
  } catch (err) {
    console.error('🔥 執行過程中發生錯誤:', err);
  }
}

// 監聽來自 Popup 的指令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "RUN_ACCELERATOR") {
    startAutomation();
    sendResponse({status: "started"});
  }
});
