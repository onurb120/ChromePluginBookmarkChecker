// Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Bookmark Checker Extension Installed");
});

const MAX_BACKUPS = 5;

// Create a backup of the entire bookmark tree
async function createBackup() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const timestamp = new Date().toISOString();
      const backupObj = {
        timestamp: timestamp,
        data: tree
      };

      chrome.storage.local.get(['bookmarkBackups'], (result) => {
        let backups = result.bookmarkBackups || [];
        backups.unshift(backupObj);
        if (backups.length > MAX_BACKUPS) {
          backups = backups.slice(0, MAX_BACKUPS);
        }
        chrome.storage.local.set({ bookmarkBackups: backups }, () => {
          console.log(`Backup created at ${timestamp}. Total backups kept: ${backups.length}`);
          resolve(true);
        });
      });
    });
  });
}

// Fetch all bookmarks inside the selected folders
async function getBookmarksFromFolders(folderIds) {
  let allBookmarks = [];
  const visitedIds = new Set();
  const idsToProcess = Array.isArray(folderIds) && folderIds.length > 0 ? folderIds : ['1', '2'];
  
  for (const id of idsToProcess) {
    try {
      const subTree = await new Promise(resolve => {
        chrome.bookmarks.getSubTree(id, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('Error fetching subtree for folder', id, chrome.runtime.lastError);
            resolve([]);
          } else {
            resolve(res || []);
          }
        });
      });

      if (!subTree || !subTree[0]) continue;

      // Root of subtree is a folder
      const stack = [{ node: subTree[0], path: subTree[0].title || '' }];
      
      while (stack.length > 0) {
        const { node, path } = stack.pop();
        if (node.url && !visitedIds.has(node.id)) {
          // filter out javascript:, chrome://, data:, etc.
          if (node.url.startsWith('http://') || node.url.startsWith('https://')) {
            visitedIds.add(node.id);
            allBookmarks.push({ ...node, folderPath: path });
          }
        }
        if (node.children) {
          node.children.forEach(child => {
            const childPath = child.children ? (path ? `${path} / ${child.title}` : child.title) : path;
            stack.push({ node: child, path: childPath });
          });
        }
      }
    } catch (err) {
      console.error('Error in getBookmarksFromFolders for id:', id, err);
    }
  }
  return allBookmarks;
}

// Enhanced HTTP validation check
async function checkUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout
  
  try {
    let response;
    try {
      response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
      // If HEAD returns 405 (Method Not Allowed), 403 (WAF block), 400, or 503, fallback to GET
      if (!response.ok && (response.status === 405 || response.status === 403 || response.status === 400 || response.status === 503)) {
        response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
      }
    } catch (headErr) {
      if (!controller.signal.aborted) {
        // Fallback to GET on network/CORS issues with HEAD
        response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
      } else {
        throw headErr;
      }
    }
    
    clearTimeout(timeoutId);
    
    // Status interpretation:
    // 200-399: OK / Redirect
    // 401, 403: Alive (Protected / Login Required, not a broken link!)
    if (response.ok || response.status < 400 || response.status === 401 || response.status === 403) {
      return { isDead: false, statusText: 'OK' };
    }
    
    return {
      isDead: true,
      statusText: response.status === 404 ? 'HTTP 404 Not Found' : response.status === 410 ? 'HTTP 410 Gone' : `HTTP ${response.status}`
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { isDead: true, statusText: 'Timeout (12s)' };
    }
    return { isDead: true, statusText: 'Network / DNS Error' };
  }
}

let activeScanState = null;
let isCancelled = false;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_SCAN_STATUS') {
    sendResponse({ activeScan: activeScanState });
    return true;
  }
  
  if (message.action === 'CANCEL_SCAN') {
    isCancelled = true;
    sendResponse({ status: 'cancelled' });
    return true;
  }
  
  if (message.action === 'START_SCAN') {
    (async () => {
      try {
        isCancelled = false;
        console.log('Taking backup...');
        await createBackup();
        
        if (isCancelled) return;

        console.log('Fetching bookmarks...');
        const bookmarks = await getBookmarksFromFolders(message.selectedFolders);
        
        let total = bookmarks.length;
        let processed = 0;
        let dead = 0;
        let duplicates = 0;
        
        const seenUrls = new Set();
        const deadLinks = [];
        const duplicateLinks = [];
        
        activeScanState = { total, processed, dead, duplicates };

        // Broadcast initial state
        chrome.runtime.sendMessage({ 
          action: 'SCAN_PROGRESS', 
          progress: activeScanState 
        });

        // Batch processing to avoid memory/network saturation
        const BATCH_SIZE = 10;
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
          if (isCancelled) {
            console.log("Scan cancelled by user.");
            break;
          }
          
          const batch = bookmarks.slice(i, i + BATCH_SIZE);
          
          await Promise.all(batch.map(async (bookmark) => {
            // Check Duplicate
            if (seenUrls.has(bookmark.url)) {
              duplicates++;
              duplicateLinks.push(bookmark);
              return;
            }
            seenUrls.add(bookmark.url);
            
            // Check Dead Link
            const check = await checkUrl(bookmark.url);
            if (check.isDead) {
              dead++;
              deadLinks.push({ ...bookmark, statusText: check.statusText });
            }
          }));
          
          if (isCancelled) {
            console.log("Scan cancelled by user during batch.");
            break;
          }

          processed += batch.length;
          activeScanState = { total, processed, dead, duplicates };
          
          // Send progress update
          chrome.runtime.sendMessage({ 
            action: 'SCAN_PROGRESS', 
            progress: activeScanState 
          });
        }
        
        if (isCancelled) {
          activeScanState = null;
          chrome.runtime.sendMessage({ action: 'SCAN_CANCELLED' });
          return;
        }

        console.log('Scan complete.', { deadLinks, duplicateLinks });
        
        // Clear active scan state
        activeScanState = null;

        // Save results to storage so UI can read them
        chrome.storage.local.set({ 
          lastScanResults: { deadLinks, duplicateLinks, timestamp: new Date().toISOString() } 
        }, () => {
          chrome.runtime.sendMessage({ action: 'SCAN_COMPLETE' });
        });
        
      } catch (err) {
        console.error("Scan error:", err);
      }
    })();
    
    sendResponse({ status: 'Scan started' });
    return true;
  }
});
