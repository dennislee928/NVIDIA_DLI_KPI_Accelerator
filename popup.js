document.getElementById('startBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab.url.includes("learn.nvidia.com/courses/course")) {
    chrome.tabs.sendMessage(tab.id, { action: "RUN_ACCELERATOR" });
    window.close();
  } else {
    alert("請在 NVIDIA DLI 課程頁面中使用此插件。");
  }
});