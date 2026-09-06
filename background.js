// 將 CSU 指令廣播到分頁內所有 frame（含 Articulate Rise iframe）
async function broadcastToAllFrames(tabId, message) {
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    frames = [{ frameId: 0 }];
  }

  if (!frames || frames.length === 0) {
    frames = [{ frameId: 0 }];
  }

  const results = await Promise.all(
    frames.map(
      (frame) =>
        new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(response || null);
          });
        })
    )
  );

  return results.filter(Boolean);
}

/** 在頁面 MAIN world 搜尋並點擊 Continue（可穿過多數 iframe / 框架綁定） */
async function mainWorldClickContinue(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        const selectors = [
          'button.continue-btn',
          'button[data-continue-btn]',
          'button[data-testid="continue-btn"]',
          '[data-testid="continue-btn"]',
          '[data-continue-btn]',
          '.continue-btn'
        ];

        const norm = (el) =>
          String(el?.innerText || el?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        // 滾到底（本 frame）
        try {
          const se = document.scrollingElement || document.documentElement;
          se.scrollTop = se.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
        } catch {}

        for (const sel of selectors) {
          const nodes = Array.from(document.querySelectorAll(sel));
          for (const el of nodes) {
            const btn = el.tagName === 'BUTTON' ? el : el.closest('button') || el;
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
            const t = norm(btn);
            if (
              btn.classList?.contains('continue-btn') ||
              btn.hasAttribute('data-continue-btn') ||
              btn.getAttribute('data-testid') === 'continue-btn' ||
              t === 'continue' ||
              t.startsWith('continue')
            ) {
              btn.scrollIntoView({ block: 'center', inline: 'nearest' });
              btn.click();
              return { clicked: true, href: location.href, via: sel };
            }
          }
        }

        const byText = Array.from(document.querySelectorAll('button')).find(
          (b) => norm(b) === 'continue'
        );
        if (byText) {
          byText.scrollIntoView({ block: 'center', inline: 'nearest' });
          byText.click();
          return { clicked: true, href: location.href, via: 'text' };
        }

        return {
          clicked: false,
          href: location.href,
          buttons: document.querySelectorAll('button').length,
          continueSel: document.querySelectorAll('button.continue-btn, [data-testid="continue-btn"]').length
        };
      }
    });

    const outcomes = (results || []).map((r) => r.result).filter(Boolean);
    const hit = outcomes.find((r) => r.clicked);
    if (hit) return hit;

    return {
      clicked: false,
      debug: outcomes.map((o) => `${o.href}: btn=${o.buttons} cont=${o.continueSel}`).join(' | ')
    };
  } catch (err) {
    return { clicked: false, error: String(err) };
  }
}

async function mainWorldScrollAll(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          const se = document.scrollingElement || document.documentElement;
          se.scrollTop = se.scrollHeight;
          window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, se.scrollHeight));
          document.querySelectorAll('*').forEach((el) => {
            try {
              if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight;
            } catch {}
          });
        } catch {}
        return true;
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** AttackIQ Academy：在所有 frame（MAIN world）播放影片 / 點擊播放鍵 */
async function mainWorldPlayVideo(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        let videos = 0;
        let played = false;

        document.querySelectorAll('video').forEach((v) => {
          videos++;
          try {
            v.muted = true;
            if (v.paused) {
              const p = v.play();
              if (p && p.catch) p.catch(() => {});
            }
            played = true;
          } catch {}
        });

        // 若沒有直接可控的 video，嘗試點擊播放按鈕（避免點到暫停鍵）
        if (!played) {
          const selectors = [
            '.vjs-big-play-button',
            '.jw-display-icon-container',
            '.plyr__control--overlaid',
            'button[aria-label*="play" i]:not([aria-label*="pause" i])',
            'button[title*="play" i]:not([title*="pause" i])'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                el.click();
                played = true;
                break;
              }
            }
          }
        }

        return { played, videos, href: location.href };
      }
    });

    const outcomes = (results || []).map((r) => r.result).filter(Boolean);
    const hit = outcomes.find((r) => r.played);
    if (hit) return hit;
    return { played: false, debug: outcomes.map((o) => `${o.href}: videos=${o.videos}`).join(' | ') };
  } catch (err) {
    return { played: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'AIQ_PLAY_VIDEO' && sender.tab?.id != null) {
    mainWorldPlayVideo(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message.action === 'CSU_BROADCAST' && message.tabId != null) {
    broadcastToAllFrames(message.tabId, message.payload).then(sendResponse);
    return true;
  }

  if (message.action === 'CSU_PROBE_CONTINUE' && sender.tab?.id != null) {
    broadcastToAllFrames(sender.tab.id, { action: 'CSU_LOCAL_FIND_CONTINUE' }).then((results) => {
      const hit = results.find((r) => r && r.found);
      sendResponse(hit || { found: false });
    });
    return true;
  }

  if (message.action === 'CSU_CLICK_CONTINUE' && sender.tab?.id != null) {
    // 優先 MAIN world（最可靠）
    mainWorldClickContinue(sender.tab.id).then(async (mainResult) => {
      if (mainResult.clicked) {
        sendResponse(mainResult);
        return;
      }
      // fallback：content script 通道
      const results = await broadcastToAllFrames(sender.tab.id, {
        action: 'CSU_LOCAL_CLICK_CONTINUE'
      });
      const hit = results.find((r) => r && r.clicked);
      sendResponse(hit || mainResult || { clicked: false });
    });
    return true;
  }

  if (message.action === 'CSU_SCROLL_ALL' && sender.tab?.id != null) {
    mainWorldScrollAll(sender.tab.id).then(sendResponse);
    return true;
  }

  return false;
});
