# NVIDIA DLI KPI Accelerator

Chrome 擴充功能（Manifest V3），用於在 NVIDIA DLI 課程頁面自動掃描未完成節點並透過 API 完成標記。**專為資安／API 交互測試情境設計**，預設於課程內頁注入腳本並搭配彈出視窗啟動流程。

## 功能概要

- 在 `learn.nvidia.com` 課程內頁讀取課程大綱 API，列出未完成之 `html`／`video` 區塊。
- 依序對各節點發送完成請求（含 CSRF），並在請求間加入 **5～12 秒隨機延遲**，以降低簡易流量監控誤判。
- 流程結束後提示重新整理頁面以查看結果。

## 需求

- Google Chrome（或其他支援 Manifest V3 的 Chromium 瀏覽器）
- 已登入 NVIDIA DLI（`learn.nvidia.com`），且當前分頁為課程頁面（URL 含 `learn.nvidia.com/courses/course`）

## 安裝（開發模式）

1. 複製或下載本專案資料夾。
2. 開啟 Chrome，前往 `chrome://extensions/`。
3. 開啟右上「開發人員模式」。
4. 點選「載入未封裝項目」，選取本專案根目錄（內含 `manifest.json`）。

## 使用方式

1. 在瀏覽器中開啟 NVIDIA DLI **課程內頁**（網址需符合 `https://learn.nvidia.com/courses/course*`）。
2. 點選擴充功能圖示，在彈出視窗中按 **「開始自動化流程」**。
3. 請在開發者工具 Console 觀察日誌；完成後依提示重新整理頁面。

若目前分頁不是課程頁，擴充功能會提示需在 DLI 課程頁面使用。

## 專案結構

| 檔案 | 說明 |
|------|------|
| `manifest.json` | 擴充功能設定、權限、content script 匹配規則 |
| `popup.html` / `popup.js` | 工具列彈出視窗 UI 與啟動訊息 |
| `content.js` | 注入課程頁：讀取 cookie／課程 API、驅動完成流程 |

## 權限說明

- **storage**：預留（目前邏輯可視需求擴充）。
- **activeTab**、**scripting**：與目前分頁互動。
- **host_permissions**：`learn.nvidia.com` 與 `learn.learn.nvidia.com` 相關 API／頁面請求。

## 免責與合規

本工具僅供**授權環境下的安全測試與教育用途**。使用前請確認符合 NVIDIA DLI 服務條款、公司政策與當地法規；不當使用可能違反平台規範或觸法，風險由使用者自行承擔。

## 授權

若未另行註明，請以專案內 `LICENSE` 或上游儲存庫設定為準。
