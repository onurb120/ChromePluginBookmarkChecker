import {
  checkBookmarkUrl,
  extractBookmarksForSelectedFolders,
  findDuplicates,
  getHostnameSafe,
  interleaveByHostname,
  partitionBookmarksForHealthCheck,
  runWithConcurrencyPool
} from './utils/bookmarkUtils.js';

// Background Service Worker

const MAX_BACKUPS = 5;
const SCAN_CONCURRENCY = 6;
const SCAN_MAX_PER_HOST = 2;
const RETRY_CONCURRENCY = 4;
const RETRY_MAX_PER_HOST = 1;
const PROGRESS_THROTTLE_MS = 150;
const KEEPALIVE_INTERVAL_MS = 20000;

let activeScanState = null;
let isCancelled = false;

function broadcastMessage(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch {
    // Ignore when no extension popup/dashboard listener is active
  }
}

function persistScanState(state) {
  activeScanState = state;
  try {
    if (chrome.storage?.session?.set) {
      const p = chrome.storage.session.set({ activeScanState: state });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    }
  } catch {
    // Ignore session storage errors in unsupported contexts
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Chrome Bookmark Checker Extension Installed');
  persistScanState(null);
});

chrome.runtime.onStartup?.addListener?.(() => {
  persistScanState(null);
});

// Create a backup of the entire bookmark tree
async function createBackup() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      if (chrome.runtime?.lastError || !tree) {
        console.warn('Backup skipped due to getTree error:', chrome.runtime?.lastError);
        resolve(false);
        return;
      }

      const timestamp = new Date().toISOString();
      const backupObj = {
        timestamp,
        data: tree
      };

      chrome.storage.local.get(['bookmarkBackups'], (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('Backup read error:', chrome.runtime.lastError);
          resolve(false);
          return;
        }
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

// Fetch all bookmarks matching selected folders from the full bookmark tree
async function getBookmarksFromFolders(folderIds, exactFolderMatch = false) {
  const tree = await new Promise((resolve) => {
    chrome.bookmarks.getTree((res) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.warn('Error fetching bookmark tree:', chrome.runtime.lastError);
        resolve([]);
      } else {
        resolve(res || []);
      }
    });
  });

  if (!tree || tree.length === 0) return [];
  const roots = (tree[0]?.id === '0' && Array.isArray(tree[0].children)) ? tree[0].children : tree;
  return extractBookmarksForSelectedFolders(roots, folderIds, { exactFolderMatch });
}

// Listen for messages from the popup / dashboard
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'GET_SCAN_STATUS') {
    if (activeScanState) {
      sendResponse({ activeScan: activeScanState });
      return false;
    }
    if (chrome.storage?.session?.get) {
      chrome.storage.session.get(['activeScanState'])
        .then((res) => sendResponse({ activeScan: res?.activeScanState || null }))
        .catch(() => sendResponse({ activeScan: null }));
      return true;
    }
    sendResponse({ activeScan: null });
    return false;
  }

  if (message.action === 'CANCEL_SCAN') {
    isCancelled = true;
    sendResponse({ status: 'cancelled' });
    return false;
  }

  if (message.action === 'START_SCAN') {
    if (activeScanState !== null) {
      sendResponse({ status: 'already_running', activeScan: activeScanState });
      return false;
    }

    isCancelled = false;
    persistScanState({
      total: 0,
      processed: 0,
      dead: 0,
      localUnreachable: 0,
      skippedLocalCount: 0,
      redirects: 0,
      duplicates: 0,
      phase: 'preparing',
      retryTotal: 0,
      retryProcessed: 0,
      recoveredOnRetry: 0
    });

    (async () => {
      let keepAliveTimer = null;
      try {
        keepAliveTimer = setInterval(() => {
          try {
            chrome.runtime.getPlatformInfo?.(() => {
              void chrome.runtime.lastError;
            });
          } catch {
            // Ignore keep-alive errors
          }
        }, KEEPALIVE_INTERVAL_MS);

        console.log('Taking backup...');
        await createBackup();

        if (isCancelled) {
          persistScanState(null);
          broadcastMessage({ action: 'SCAN_CANCELLED' });
          return;
        }

        const selectedFolders = message.selectedFolders;
        const exactFolderMatch = Boolean(message.exactFolderMatch);
        const checkDuplicates = message.options?.checkDuplicates ?? true;
        const checkDeadLinks = message.options?.checkDeadLinks ?? true;
        const includeLocalPrivate = Boolean(message.options?.includeLocalPrivate);

        console.log('Fetching bookmarks...');
        const bookmarks = await getBookmarksFromFolders(selectedFolders, exactFolderMatch);

        if (isCancelled) {
          persistScanState(null);
          broadcastMessage({ action: 'SCAN_CANCELLED' });
          return;
        }

        const duplicateLinks = checkDuplicates ? findDuplicates(bookmarks).duplicates : [];
        const deadLinks = [];
        const redirectedLinks = [];

        const { bookmarksToCheck, skippedLocalBookmarks } = checkDeadLinks
          ? partitionBookmarksForHealthCheck(bookmarks, { includeLocalPrivate })
          : { bookmarksToCheck: [], skippedLocalBookmarks: [] };
        const skippedLocalCount = skippedLocalBookmarks.length;

        const bookmarksByUrl = new Map();
        if (checkDeadLinks) {
          for (const bm of bookmarksToCheck) {
            if (!bookmarksByUrl.has(bm.url)) {
              bookmarksByUrl.set(bm.url, []);
            }
            bookmarksByUrl.get(bm.url).push(bm);
          }
        }

        const uniqueTargets = Array.from(bookmarksByUrl.keys(), (url) => ({ url }));
        const interleavedTargets = interleaveByHostname(uniqueTargets, (item) => item.url);
        const uniqueTotal = interleavedTargets.length;

        let processed = 0;
        let dead = 0;
        let localUnreachable = 0;
        let redirects = 0;
        let retryTotal = 0;
        let retryProcessed = 0;
        let recoveredOnRetry = 0;
        let lastProgressSentAt = 0;

        const emitProgress = (phase, force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressSentAt < PROGRESS_THROTTLE_MS) {
            return;
          }
          lastProgressSentAt = now;
          const progress = {
            total: uniqueTotal,
            processed,
            dead,
            localUnreachable,
            skippedLocalCount,
            redirects,
            duplicates: duplicateLinks.length,
            phase,
            retryTotal,
            retryProcessed,
            recoveredOnRetry
          };
          persistScanState(progress);
          broadcastMessage({
            action: 'SCAN_PROGRESS',
            progress
          });
        };

        const finalResultsByUrl = new Map();
        const retryCandidates = [];

        if (checkDeadLinks) {
          emitProgress('scanning', true);

          await runWithConcurrencyPool(
            interleavedTargets,
            (target) => checkBookmarkUrl(target.url, { attempt: 1 }),
            {
              concurrency: SCAN_CONCURRENCY,
              maxPerHost: SCAN_MAX_PER_HOST,
              getHost: (target) => getHostnameSafe(target.url),
              shouldCancel: () => isCancelled,
              onItemDone: (res, target) => {
                if (!res) return;
                processed++;
                finalResultsByUrl.set(target.url, res);

                const countForUrl = bookmarksByUrl.get(target.url)?.length || 1;
                if (res.isDead) {
                  if (res.isLocalPrivate) {
                    localUnreachable += countForUrl;
                  } else {
                    dead += countForUrl;
                  }
                  if (res.isRetryable && !res.isLocalPrivate) {
                    retryCandidates.push({ url: target.url, firstResult: res });
                  }
                } else if (res.redirectedToHomepage) {
                  redirects += countForUrl;
                }

                emitProgress('scanning', processed === uniqueTotal);
              }
            }
          );
        }

        if (isCancelled) {
          persistScanState(null);
          broadcastMessage({ action: 'SCAN_CANCELLED' });
          return;
        }

        // Pass 2: Automatic retry for timed-out / 5xx / transient network errors
        if (checkDeadLinks && retryCandidates.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));

          if (isCancelled) {
            persistScanState(null);
            broadcastMessage({ action: 'SCAN_CANCELLED' });
            return;
          }

          const interleavedRetries = interleaveByHostname(retryCandidates, (item) => item.url);
          retryTotal = interleavedRetries.length;
          emitProgress('retrying', true);

          await runWithConcurrencyPool(
            interleavedRetries,
            (item) =>
              checkBookmarkUrl(item.url, {
                skipHead: true,
                getTimeoutMs: 15000,
                noCorsTimeoutMs: 6000,
                attempt: 2
              }),
            {
              concurrency: RETRY_CONCURRENCY,
              maxPerHost: RETRY_MAX_PER_HOST,
              getHost: (item) => getHostnameSafe(item.url),
              shouldCancel: () => isCancelled,
              onItemDone: (retryRes, item) => {
                if (!retryRes) return;
                retryProcessed++;

                const firstDiag = item.firstResult?.diagnostics || {};
                const mergedDiagnostics = {
                  ...retryRes.diagnostics,
                  headStatus: retryRes.diagnostics?.headStatus ?? firstDiag.headStatus ?? null,
                  headError: retryRes.diagnostics?.headError ?? firstDiag.headError ?? null,
                  headDurationMs: retryRes.diagnostics?.headDurationMs ?? firstDiag.headDurationMs ?? null,
                  firstPassStatusText: item.firstResult?.statusText || null,
                  attempts: 2,
                  retried: true
                };

                const finalRes = {
                  ...retryRes,
                  diagnostics: mergedDiagnostics
                };
                finalResultsByUrl.set(item.url, finalRes);

                const countForUrl = bookmarksByUrl.get(item.url)?.length || 1;
                if (!finalRes.isDead) {
                  recoveredOnRetry++;
                  dead = Math.max(0, dead - countForUrl);
                  if (finalRes.redirectedToHomepage) {
                    redirects += countForUrl;
                  }
                }

                emitProgress('retrying', true);
              }
            }
          );
        }

        if (isCancelled) {
          persistScanState(null);
          broadcastMessage({ action: 'SCAN_CANCELLED' });
          return;
        }

        if (checkDeadLinks) {
          for (const bm of bookmarksToCheck) {
            const res = finalResultsByUrl.get(bm.url);
            if (!res) continue;

            if (res.isDead) {
              deadLinks.push({
                ...bm,
                statusText: res.statusText,
                category: res.category,
                isLocalPrivate: Boolean(res.isLocalPrivate),
                diagnostics: res.diagnostics || null
              });
            } else if (res.redirectedToHomepage) {
              redirectedLinks.push({
                ...bm,
                statusText: 'Redirected to Homepage',
                category: 'redirect-homepage',
                finalUrl: res.diagnostics?.finalUrl || null,
                diagnostics: res.diagnostics || null
              });
            }
          }
        }

        const localUnreachableCount = deadLinks.filter((item) => item.isLocalPrivate).length;
        const deadCount = deadLinks.length - localUnreachableCount;
        const summary = {
          totalBookmarks: bookmarks.length,
          uniqueUrlsScanned: checkDeadLinks ? uniqueTotal : 0,
          deadCount,
          localUnreachableCount,
          skippedLocalCount,
          includeLocalPrivate,
          redirectedCount: redirectedLinks.length,
          duplicateCount: duplicateLinks.length,
          retriedCount: retryCandidates.length,
          recoveredOnRetryCount: recoveredOnRetry
        };

        const payload = {
          deadLinks,
          redirectedLinks,
          duplicateLinks,
          timestamp: new Date().toISOString(),
          summary
        };

        console.log('Scan complete.', summary);

        await new Promise((resolve) => {
          chrome.storage.local.set({ lastScanResults: payload }, () => {
            if (chrome.runtime?.lastError) {
              console.error('Failed to save scan results:', chrome.runtime.lastError);
            }
            resolve();
          });
        });

        persistScanState(null);
        broadcastMessage({ action: 'SCAN_COMPLETE' });
      } catch (err) {
        console.error('Scan error:', err);
        persistScanState(null);
        broadcastMessage({ action: 'SCAN_ERROR', error: err?.message || String(err) });
      } finally {
        if (keepAliveTimer !== null) {
          clearInterval(keepAliveTimer);
        }
        if (activeScanState !== null && isCancelled) {
          persistScanState(null);
        }
      }
    })();

    sendResponse({ status: 'Scan started' });
    return true;
  }

  return false;
});
