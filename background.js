// Service Worker script for Chrome Plugin Bookmark Checker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Chrome Bookmark Checker extension installed successfully.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_SCAN') {
    handleScan(request.bookmarks);
    sendResponse({ started: true });
  }
  return true;
});

async function handleScan(bookmarks) {
  const urlMap = new Map();
  const results = [];
  const total = bookmarks.length;

  // First pass: mark duplicates
  bookmarks.forEach(bm => {
    const normalizedUrl = normalizeUrl(bm.url);
    if (urlMap.has(normalizedUrl)) {
      urlMap.get(normalizedUrl).push(bm.id);
    } else {
      urlMap.set(normalizedUrl, [bm.id]);
    }
  });

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const normalized = normalizeUrl(bm.url);
    const isDuplicate = (urlMap.get(normalized) || []).length > 1;

    let status = 'ok';
    let statusCode = 200;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(bm.url, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors'
      });
      clearTimeout(timeoutId);

      if (response.status >= 400) {
        status = 'broken';
        statusCode = response.status;
      }
    } catch (err) {
      status = 'broken';
      statusCode = 0; // Network / CORS / Aborted error
    }

    results.push({
      id: bm.id,
      title: bm.title,
      url: bm.url,
      status,
      statusCode,
      isDuplicate
    });

    // Notify popup of progress
    chrome.runtime.sendMessage({
      action: 'SCAN_PROGRESS',
      scanned: i + 1,
      total,
      results
    }).catch(() => {
      // Popup might be closed by user; ignore message target closed error
    });
  }

  chrome.runtime.sendMessage({
    action: 'SCAN_COMPLETE',
    results
  }).catch(() => {});
}

function normalizeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (u.origin + u.pathname).replace(/\/$/, '').toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
}
