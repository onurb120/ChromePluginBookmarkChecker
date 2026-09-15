document.addEventListener('DOMContentLoaded', () => {
  const startScanBtn = document.getElementById('startScanBtn');
  const cancelScanBtn = document.getElementById('cancelScanBtn');
  const statusLabel = document.getElementById('statusLabel');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  const statusDetails = document.getElementById('statusDetails');

  const totalCountEl = document.getElementById('totalCount');
  const validCountEl = document.getElementById('validCount');
  const duplicateCountEl = document.getElementById('duplicateCount');
  const brokenCountEl = document.getElementById('brokenCount');
  const resultsList = document.getElementById('resultsList');
  const tabBtns = document.querySelectorAll('.tab-btn');

  let activeTab = 'all';
  let bookmarkResults = [];

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeTab = e.target.dataset.tab;
      renderResults();
    });
  });

  // Start Scan handler
  startScanBtn.addEventListener('click', async () => {
    startScanBtn.disabled = true;
    cancelScanBtn.disabled = false;
    statusLabel.textContent = 'Status: Scanning...';

    // Query Chrome bookmarks API
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      const tree = await chrome.bookmarks.getTree();
      const allBookmarks = extractBookmarkUrls(tree);
      totalCountEl.textContent = allBookmarks.length;

      chrome.runtime.sendMessage({ action: 'START_SCAN', bookmarks: allBookmarks });
    } else {
      // Demo / fallback mode for testing layout without chrome extension context
      statusDetails.textContent = 'Chrome extension API not detected. Running mock scan...';
      mockScan();
    }
  });

  // Listen for background service worker updates
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'SCAN_PROGRESS') {
        const { scanned, total, results } = message;
        const percent = Math.round((scanned / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        statusDetails.textContent = `Scanned ${scanned} of ${total} bookmarks...`;
        
        bookmarkResults = results;
        updateCounts();
        renderResults();
      } else if (message.action === 'SCAN_COMPLETE') {
        startScanBtn.disabled = false;
        cancelScanBtn.disabled = true;
        statusLabel.textContent = 'Status: Complete';
        statusDetails.textContent = 'Scan complete! View results below.';
      }
    });
  }

  function extractBookmarkUrls(nodes) {
    let urls = [];
    function traverse(items) {
      for (const item of items) {
        if (item.url) {
          urls.push({ id: item.id, title: item.title, url: item.url });
        }
        if (item.children) {
          traverse(item.children);
        }
      }
    }
    traverse(nodes);
    return urls;
  }

  function updateCounts() {
    const valid = bookmarkResults.filter(r => r.status === 'ok').length;
    const duplicates = bookmarkResults.filter(r => r.isDuplicate).length;
    const broken = bookmarkResults.filter(r => r.status === 'broken').length;

    validCountEl.textContent = valid;
    duplicateCountEl.textContent = duplicates;
    brokenCountEl.textContent = broken;
  }

  function renderResults() {
    resultsList.innerHTML = '';

    let filtered = bookmarkResults;
    if (activeTab === 'broken') {
      filtered = bookmarkResults.filter(r => r.status === 'broken');
    } else if (activeTab === 'duplicates') {
      filtered = bookmarkResults.filter(r => r.isDuplicate);
    }

    if (filtered.length === 0) {
      resultsList.innerHTML = '<li class="empty-state">No bookmarks found for this view.</li>';
      return;
    }

    filtered.forEach(item => {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.innerHTML = `
        <div style="font-weight: 600;">${escapeHtml(item.title || 'Untitled')}</div>
        <div style="color: var(--text-muted); font-size: 11px; word-break: break-all;">${escapeHtml(item.url)}</div>
        <div style="font-size: 11px; margin-top: 4px;">
          <span style="color: ${item.status === 'ok' ? 'var(--success)' : 'var(--danger)'};">
            ${item.statusCode ? 'HTTP ' + item.statusCode : item.status.toUpperCase()}
          </span>
          ${item.isDuplicate ? '<span style="color: var(--warning); margin-left: 8px;">[Duplicate]</span>' : ''}
        </div>
      `;
      resultsList.appendChild(li);
    });
  }

  function mockScan() {
    let scanned = 0;
    const total = 5;
    const mockData = [
      { id: '1', title: 'Google', url: 'https://www.google.com', status: 'ok', statusCode: 200 },
      { id: '2', title: 'Broken Link Example', url: 'https://example.invalid/404', status: 'broken', statusCode: 404 },
      { id: '3', title: 'Google Mirror', url: 'https://www.google.com', status: 'ok', statusCode: 200, isDuplicate: true },
      { id: '4', title: 'GitHub', url: 'https://github.com', status: 'ok', statusCode: 200 },
      { id: '5', title: 'Dead Endpoint', url: 'https://httpstat.us/500', status: 'broken', statusCode: 500 }
    ];

    const interval = setInterval(() => {
      scanned++;
      const currentResults = mockData.slice(0, scanned);
      const percent = Math.round((scanned / total) * 100);
      progressBar.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      statusDetails.textContent = `Scanned ${scanned} of ${total} bookmarks...`;
      totalCountEl.textContent = total;

      bookmarkResults = currentResults;
      updateCounts();
      renderResults();

      if (scanned === total) {
        clearInterval(interval);
        startScanBtn.disabled = false;
        cancelScanBtn.disabled = true;
        statusLabel.textContent = 'Status: Complete';
        statusDetails.textContent = 'Mock scan completed!';
      }
    }, 400);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, match => {
      const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return chars[match];
    });
  }
});
