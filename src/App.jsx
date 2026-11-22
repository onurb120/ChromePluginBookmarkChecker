import React, { useState, useEffect } from 'react';
import appLogo from '../assets/icons/icon48.png';
import { isValidBookmarkUrl, isLocalOrPrivateUrl } from './utils/bookmarkUtils.js';

const INITIAL_PROGRESS = {
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
};

function App() {
  const [folders, setFolders] = useState([]);
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [totalBookmarksCount, setTotalBookmarksCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(INITIAL_PROGRESS);
  const [scanResults, setScanResults] = useState(null);
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [checkDeadLinks, setCheckDeadLinks] = useState(true);
  const [includeLocalPrivate, setIncludeLocalPrivate] = useState(false);
  const [configNotice, setConfigNotice] = useState('');

  useEffect(() => {
    // Check if we're running inside the Chrome extension
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((tree) => {
        if (chrome.runtime?.lastError || !tree) return;

        let count = 0;
        const countUrls = (nodes) => {
          nodes.forEach((node) => {
            if (node.url && isValidBookmarkUrl(node.url)) {
              count++;
            }
            if (node.children) countUrls(node.children);
          });
        };
        countUrls(tree);
        setTotalBookmarksCount(count);

        const rootNodes = tree[0]?.children || [];
        const detectedFolders = [];

        const traverse = (node, parentPath) => {
          if (!node.children) return;

          const directBookmarks = node.children.filter((c) => c.url && isValidBookmarkUrl(c.url));
          const directCount = directBookmarks.length;
          const localCount = directBookmarks.filter((c) => isLocalOrPrivateUrl(c.url)).length;
          const subfolders = node.children.filter((c) => c.children);
          const isRoot = node.parentId === '0' || ['1', '2', '3'].includes(node.id);

          if (isRoot) {
            const rootTitle =
              node.title ||
              (node.id === '1'
                ? 'Bookmarks Bar'
                : node.id === '2'
                  ? 'Other Bookmarks'
                  : 'Mobile Bookmarks');

            if (directCount > 0) {
              const title = subfolders.length > 0 ? `${rootTitle} (Root Items)` : rootTitle;
              detectedFolders.push({ id: node.id, title, count: directCount, localCount });
            }
            subfolders.forEach((sub) => traverse(sub, rootTitle));
          } else {
            const currentPath = parentPath ? `${parentPath} / ${node.title}` : node.title;
            if (directCount > 0) {
              detectedFolders.push({ id: node.id, title: currentPath, count: directCount, localCount });
            }
            subfolders.forEach((sub) => traverse(sub, currentPath));
          }
        };

        rootNodes.forEach((root) => traverse(root, ''));

        // Fallback: if no folders with direct bookmarks were found, default to root nodes
        if (detectedFolders.length === 0) {
          rootNodes.forEach((root) => {
            const directBookmarks = (root.children || []).filter(
              (c) => c.url && isValidBookmarkUrl(c.url)
            );
            const directCount = directBookmarks.length;
            const localCount = directBookmarks.filter((c) => isLocalOrPrivateUrl(c.url)).length;
            detectedFolders.push({
              id: root.id,
              title:
                root.title ||
                (root.id === '1'
                  ? 'Bookmarks Bar'
                  : root.id === '2'
                    ? 'Other Bookmarks'
                    : 'Mobile Bookmarks'),
              count: directCount,
              localCount
            });
          });
        }

        setFolders(detectedFolders);
        setSelectedFolders(new Set(detectedFolders.map((f) => f.id)));
      });

      // Load previous scan results and persisted scan options
      chrome.storage.local.get(['lastScanResults', 'scanOptions'], (data) => {
        if (chrome.runtime?.lastError) return;
        if (data.lastScanResults) {
          setScanResults(data.lastScanResults);
        }
        if (data.scanOptions) {
          if (typeof data.scanOptions.checkDuplicates === 'boolean') {
            setCheckDuplicates(data.scanOptions.checkDuplicates);
          }
          if (typeof data.scanOptions.checkDeadLinks === 'boolean') {
            setCheckDeadLinks(data.scanOptions.checkDeadLinks);
          }
          if (typeof data.scanOptions.includeLocalPrivate === 'boolean') {
            setIncludeLocalPrivate(data.scanOptions.includeLocalPrivate);
          }
        }
      });
    } else {
      // Fallback for local development
      const fallback = [
        { id: '1', title: 'Bookmarks Bar', count: 12, localCount: 2 },
        { id: '2', title: 'Work & Projects', count: 8, localCount: 1 },
        { id: '3', title: 'To Read / Research', count: 5, localCount: 0 }
      ];
      setFolders(fallback);
      setSelectedFolders(new Set(fallback.map((f) => f.id)));
      setTotalBookmarksCount(25);
    }
  }, []);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      // Ask background if a scan is currently running
      chrome.runtime.sendMessage({ action: 'GET_SCAN_STATUS' }, (response) => {
        if (chrome.runtime?.lastError) return;
        if (response && response.activeScan) {
          setIsScanning(true);
          setScanProgress({ ...INITIAL_PROGRESS, ...response.activeScan });
        }
      });

      const handleMessage = (msg) => {
        if (msg.action === 'SCAN_PROGRESS' && msg.progress) {
          setIsScanning(true);
          setScanProgress({ ...INITIAL_PROGRESS, ...msg.progress });
        } else if (msg.action === 'SCAN_COMPLETE') {
          setIsScanning(false);
          chrome.storage.local.get(['lastScanResults'], (data) => {
            if (!chrome.runtime?.lastError && data.lastScanResults) {
              setScanResults(data.lastScanResults);
            }
          });
        } else if (msg.action === 'SCAN_CANCELLED') {
          setIsScanning(false);
          setConfigNotice('Scan was cancelled.');
        } else if (msg.action === 'SCAN_ERROR') {
          setIsScanning(false);
          setConfigNotice(msg.error ? `Scan error: ${msg.error}` : 'Scan failed unexpectedly.');
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);
      return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }
  }, []);

  const persistScanOptions = (nextOptions) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ scanOptions: nextOptions });
    }
  };

  const handleToggleDuplicates = (checked) => {
    setCheckDuplicates(checked);
    setConfigNotice('');
    persistScanOptions({ checkDuplicates: checked, checkDeadLinks, includeLocalPrivate });
  };

  const handleToggleDeadLinks = (checked) => {
    setCheckDeadLinks(checked);
    setConfigNotice('');
    persistScanOptions({ checkDuplicates, checkDeadLinks: checked, includeLocalPrivate });
  };

  const handleToggleIncludeLocalPrivate = (checked) => {
    setIncludeLocalPrivate(checked);
    setConfigNotice('');
    persistScanOptions({ checkDuplicates, checkDeadLinks, includeLocalPrivate: checked });
  };

  const handleStartScan = () => {
    if (!checkDuplicates && !checkDeadLinks) {
      setConfigNotice('Enable at least one check (Find Duplicates or Check Dead Links).');
      return;
    }

    const foldersToScan =
      selectedFolders.size > 0
        ? Array.from(selectedFolders)
        : folders.map((f) => f.id);

    if (foldersToScan.length === 0 && totalBookmarksCount > 0) {
      foldersToScan.push('1', '2');
    }

    if (foldersToScan.length === 0) {
      setConfigNotice('No bookmarks or folders available to scan.');
      return;
    }

    setConfigNotice('');
    setIsScanning(true);
    setScanResults(null);
    setScanProgress({ ...INITIAL_PROGRESS, phase: 'preparing' });

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          action: 'START_SCAN',
          selectedFolders: foldersToScan,
          exactFolderMatch: true,
          options: {
            checkDuplicates,
            checkDeadLinks,
            includeLocalPrivate
          }
        },
        (response) => {
          if (chrome.runtime?.lastError) {
            setIsScanning(false);
            setConfigNotice('Could not start background scan. Please try again.');
            return;
          }
          if (response?.status === 'already_running' && response.activeScan) {
            setScanProgress({ ...INITIAL_PROGRESS, ...response.activeScan });
          }
        }
      );
    } else {
      // Simulate progress for testing locally without extension context
      let current = 0;
      const interval = setInterval(() => {
        current += Math.floor(Math.random() * 15) + 5;
        if (current >= 100) {
          current = 100;
          clearInterval(interval);
          setTimeout(() => {
            setIsScanning(false);
            setScanResults({
              deadLinks: [],
              redirectedLinks: [],
              duplicateLinks: [],
              summary: {
                deadCount: 0,
                localUnreachableCount: 0,
                redirectedCount: 0,
                duplicateCount: 0,
                recoveredOnRetryCount: 0
              }
            });
          }, 300);
        }
        setScanProgress((prev) => ({
          ...prev,
          phase: 'scanning',
          total: 100,
          processed: current,
          dead: Math.floor(current / 10),
          duplicates: Math.floor(current / 20)
        }));
      }, 250);
    }
  };

  const handleCancelScan = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'CANCEL_SCAN' }, () => {
        void chrome.runtime?.lastError;
        setIsScanning(false);
      });
    } else {
      setIsScanning(false);
    }
  };

  const toggleFolder = (id) => {
    const newSelected = new Set(selectedFolders);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedFolders(newSelected);
  };

  const selectAll = () => setSelectedFolders(new Set(folders.map((f) => f.id)));
  const deselectAll = () => setSelectedFolders(new Set());

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backups, setBackups] = useState([]);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const openSettings = () => {
    setIsSettingsOpen(true);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['bookmarkBackups'], (data) => {
        setBackups(data.bookmarkBackups || []);
      });
    } else {
      setBackups([{ timestamp: new Date().toISOString(), data: [] }]);
    }
  };

  const handleManualBackup = () => {
    setIsBackingUp(true);
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((tree) => {
        const timestamp = new Date().toISOString();
        const backupObj = { timestamp, data: tree };
        chrome.storage.local.get(['bookmarkBackups'], (result) => {
          let currentBackups = result.bookmarkBackups || [];
          currentBackups.unshift(backupObj);
          if (currentBackups.length > 5) {
            currentBackups = currentBackups.slice(0, 5);
          }
          chrome.storage.local.set({ bookmarkBackups: currentBackups }, () => {
            setBackups(currentBackups);
            setIsBackingUp(false);
          });
        });
      });
    } else {
      const timestamp = new Date().toISOString();
      const newBackups = [{ timestamp, data: [] }, ...backups].slice(0, 5);
      setBackups(newBackups);
      setIsBackingUp(false);
    }
  };

  const clearBackups = () => {
    if (backups.length === 0) return;
    if (window.confirm('Are you sure you want to delete all saved backup snapshots?')) {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ bookmarkBackups: [] }, () => {
          setBackups([]);
        });
      } else {
        setBackups([]);
      }
    }
  };

  const downloadBackup = (backup) => {
    try {
      const jsonStr = JSON.stringify(backup.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date(backup.timestamp).toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `bookmarks-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Error downloading backup: ' + err.message);
    }
  };

  // Derive scan progress metrics cleanly
  const isRetryPhase = scanProgress.phase === 'retrying';
  const isPreparingPhase = scanProgress.phase === 'preparing';
  const progressTotal = isRetryPhase ? scanProgress.retryTotal : scanProgress.total;
  const progressProcessed = isRetryPhase ? scanProgress.retryProcessed : scanProgress.processed;
  const progressPercent =
    progressTotal > 0 ? Math.min(100, Math.round((progressProcessed / progressTotal) * 100)) : 0;

  // Derive scan summary counts
  const deadList = scanResults?.deadLinks || [];
  const confirmedDeadCount = deadList.filter((item) => !item.isLocalPrivate).length;
  const localCount = deadList.filter((item) => item.isLocalPrivate).length;
  const skippedLocalCount = scanResults?.summary?.skippedLocalCount || 0;
  const redirectCount = (scanResults?.redirectedLinks || []).length;
  const dupCount = (scanResults?.duplicateLinks || []).length;
  const recoveredCount = scanResults?.summary?.recoveredOnRetryCount || 0;

  const activeFolderIds =
    selectedFolders.size > 0 ? selectedFolders : new Set(folders.map((f) => f.id));
  const selectedLocalCount = folders.reduce(
    (sum, folder) => (activeFolderIds.has(folder.id) ? sum + (folder.localCount || 0) : sum),
    0
  );
  const extensionVersion =
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.1.1';

  return (
    <div className="flex flex-col h-full bg-surface text-on-surface font-sans relative">
      <header className="bg-surface-container border-b border-outline-variant/30 w-full flex items-center justify-between px-margin py-space-xs shrink-0 select-none h-11">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-surface-container flex items-center justify-center shadow-sm overflow-hidden border border-outline-variant/30">
            <img src={appLogo} alt="logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-[13px] font-semibold text-on-surface tracking-tight">Chrome Bookmark Checker</span>
          <span className="bg-surface-variant text-primary font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wide font-medium border border-outline-variant/40">v{extensionVersion}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={openSettings}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-bright hover:text-on-surface transition-colors cursor-pointer"
            title="Settings & Backups"
          >
            <span className="material-symbols-outlined text-[17px]">settings</span>
          </button>
        </div>
      </header>

      <main className="w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
        <section className="grid grid-cols-2 gap-2 bg-surface-container-low p-2 rounded-xl border border-outline-variant/30">
          <div className="p-2.5 bg-surface-container/60 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-on-surface-variant font-medium">Total Bookmarks</span>
              <span className="material-symbols-outlined text-[14px] text-primary">folder</span>
            </div>
            <div className="mt-1">
              <div className="text-[17px] font-bold text-on-surface tracking-tight leading-tight">
                {totalBookmarksCount > 0 ? totalBookmarksCount.toLocaleString() : '...'}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="material-symbols-outlined text-[11px] text-tertiary">folder_open</span>
                <span className="font-mono text-[9.5px] text-tertiary">Across {folders.length} folders</span>
              </div>
            </div>
          </div>
          <div className="p-2.5 bg-surface-container/60 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-on-surface-variant font-medium">Auto-Backup</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 status-pulse"></span>
            </div>
            <div className="mt-1">
              <div className="text-[13px] font-semibold text-on-surface leading-tight">Active</div>
              <div className="flex items-center gap-1 mt-0.5 text-emerald-400">
                <span className="material-symbols-outlined text-[11px]">backup</span>
                <span className="font-mono text-[9.5px] font-medium">Keeps last 5</span>
              </div>
            </div>
          </div>
        </section>

        {configNotice && (
          <div className="px-2.5 py-2 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-200 text-[11px] flex items-center justify-between gap-2">
            <span>{configNotice}</span>
            <button
              onClick={() => setConfigNotice('')}
              className="text-amber-200/80 hover:text-amber-100 cursor-pointer shrink-0"
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        )}

        <section className="space-y-1.5">
          {!isScanning ? (
            <>
              {scanResults ? (
                <div className="w-full bg-surface-container-low border border-primary/30 rounded-xl p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-primary text-[12px] font-semibold">
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      Scan Complete
                    </div>
                    <button
                      onClick={() => setScanResults(null)}
                      className="text-outline hover:text-on-surface transition-colors p-0.5 rounded flex items-center justify-center cursor-pointer"
                      title="Dismiss"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                  <div className="text-[10.5px] text-on-surface-variant">
                    Found <span className="text-error font-mono font-bold">{confirmedDeadCount}</span> dead links and{' '}
                    <span className="text-emerald-400 font-mono font-bold">{dupCount}</span> duplicates.
                  </div>
                  {(localCount > 0 || skippedLocalCount > 0 || redirectCount > 0 || recoveredCount > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {localCount > 0 && (
                        <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300">
                          {localCount} local
                        </span>
                      )}
                      {skippedLocalCount > 0 && (
                        <span
                          className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-surface-container border border-outline-variant/30 text-on-surface-variant"
                          title="Skipped for faster scanning. Enable 'Include Local / Private URLs' in Scan Configuration to check them."
                        >
                          {skippedLocalCount} local skipped
                        </span>
                      )}
                      {redirectCount > 0 && (
                        <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-tertiary/10 border border-tertiary/30 text-tertiary">
                          {redirectCount} redirected
                        </span>
                      )}
                      {recoveredCount > 0 && (
                        <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                          {recoveredCount} recovered on retry
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        if (typeof chrome !== 'undefined') {
                          if (chrome.runtime?.openOptionsPage) {
                            chrome.runtime.openOptionsPage();
                          } else if (chrome.tabs) {
                            chrome.tabs.create({ url: chrome.runtime?.getURL('src/dashboard.html') || 'src/dashboard.html' });
                          }
                        }
                      }}
                      className="flex-1 h-7 rounded-lg bg-primary-container text-on-primary-container hover:opacity-90 transition-opacity text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      Open Dashboard
                    </button>
                    {selectedFolders.size > 0 ? (
                      <button
                        onClick={handleStartScan}
                        className="flex-1 h-7 rounded-lg bg-gradient-to-r from-primary-container to-secondary-container hover:opacity-95 transition-all text-[11px] font-semibold text-on-surface flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[13px]">radar</span>
                        Start Scan
                      </button>
                    ) : (
                      <button
                        onClick={() => setScanResults(null)}
                        className="flex-1 h-7 rounded-lg bg-surface-container-highest hover:bg-surface-bright transition-colors text-[11px] text-on-surface cursor-pointer"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={handleStartScan}
                    className="w-full h-9 rounded-xl bg-gradient-to-r from-primary-container via-inverse-primary to-secondary-container hover:opacity-95 transition-all flex items-center justify-center gap-2 text-on-surface text-[12.5px] font-semibold shadow-md shadow-secondary-container/20 group relative overflow-hidden cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px] group-hover:rotate-45 transition-transform duration-300">radar</span>
                    <span>Start Scan</span>
                  </button>
                  <div className="flex items-center justify-between px-1">
                    <span className="font-mono text-[9.5px] text-outline">Will auto-backup before scanning</span>
                    <span className="font-mono text-[9.5px] text-tertiary flex items-center gap-1">
                      <span className="material-symbols-outlined text-[10px]">speed</span>
                      Turbo engine
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex justify-between items-center text-[10.5px]">
                <div className="flex items-center gap-2">
                  <span className={`font-medium animate-pulse ${isRetryPhase ? 'text-amber-300' : 'text-primary'}`}>
                    {isRetryPhase
                      ? 'Retrying timed-out links...'
                      : isPreparingPhase
                        ? 'Backing up & reading tree...'
                        : 'Scanning in progress...'}
                  </span>
                  <button
                    onClick={handleCancelScan}
                    className="flex items-center gap-0.5 text-error hover:bg-error/10 px-1.5 py-0.5 rounded transition-colors text-[9px] font-bold tracking-wide uppercase cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[11px]">stop_circle</span>
                    Cancel
                  </button>
                </div>
                <span className="text-on-surface-variant font-mono">
                  {progressProcessed} / {progressTotal}
                </span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isRetryPhase
                      ? 'bg-gradient-to-r from-amber-400 to-emerald-400'
                      : 'bg-gradient-to-r from-primary-container to-secondary-container'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <div className="flex justify-between items-center text-[9.5px] font-mono text-outline">
                <div className="flex items-center gap-2">
                  <span className="text-error">{scanProgress.dead} dead</span>
                  {scanProgress.localUnreachable > 0 && (
                    <span className="text-sky-300">{scanProgress.localUnreachable} local</span>
                  )}
                  {isRetryPhase && (
                    <span className="text-emerald-400">{scanProgress.recoveredOnRetry || 0} recovered</span>
                  )}
                </div>
                <span className="text-emerald-400">{scanProgress.duplicates} duplicates</span>
              </div>
            </div>
          )}
        </section>

        <section className={`space-y-1.5 flex flex-col min-h-0 transition-opacity duration-300 ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between px-0.5 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-on-surface">Select Folders</span>
              <span className="bg-surface-variant text-on-surface-variant font-mono text-[9.5px] px-1.5 py-0.5 rounded-full">
                {selectedFolders.size}/{folders.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={selectAll} className="text-[10.5px] font-medium text-primary hover:text-primary-fixed transition-colors cursor-pointer">
                Select All
              </button>
              <button onClick={deselectAll} className="text-[10.5px] font-medium text-outline hover:text-on-surface transition-colors cursor-pointer">
                Deselect All
              </button>
            </div>
          </div>

          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl divide-y divide-outline-variant/20 overflow-y-auto max-h-[96px] custom-scrollbar">
            {folders.map((folder, idx) => (
              <label key={folder.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-surface-bright/30 transition-colors cursor-pointer group">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <input
                    checked={selectedFolders.has(folder.id)}
                    onChange={() => toggleFolder(folder.id)}
                    className="w-3.5 h-3.5 rounded bg-surface-container border-outline-variant/60 text-primary-container focus:ring-1 focus:ring-primary focus:ring-offset-0 transition-colors cursor-pointer shrink-0"
                    type="checkbox"
                  />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className={`material-symbols-outlined text-[14px] shrink-0 ${idx % 2 === 0 ? 'text-primary' : 'text-secondary'}`}>
                      folder
                    </span>
                    <span className="text-[12px] text-on-surface group-hover:text-white transition-colors truncate" title={folder.title}>
                      {folder.title}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-[9.5px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded shrink-0">
                  {folder.count ?? 0}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className={`space-y-1.5 flex-shrink-0 transition-opacity duration-300 ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="px-0.5">
            <span className="text-[12px] font-semibold text-on-surface">Scan Configuration</span>
          </div>
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl divide-y divide-outline-variant/20 overflow-hidden">
            <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-surface-bright/20 transition-colors">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[15px] text-secondary mt-0.5">content_copy</span>
                <div>
                  <div className="text-[12px] font-semibold text-on-surface leading-tight">Find Duplicates</div>
                  <div className="text-[10px] text-outline leading-tight mt-0.5">Identifies redundant and mirrored URLs</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  checked={checkDuplicates}
                  onChange={(e) => handleToggleDuplicates(e.target.checked)}
                  className="sr-only peer"
                  type="checkbox"
                />
                <div className="w-7 h-3.5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-primary-container"></div>
              </label>
            </div>

            <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-surface-bright/20 transition-colors">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[15px] text-error mt-0.5">link_off</span>
                <div>
                  <div className="text-[12px] font-semibold text-on-surface leading-tight">Check Dead Links (404)</div>
                  <div className="text-[10px] text-outline leading-tight mt-0.5">Pings servers &amp; retries timeouts automatically</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  checked={checkDeadLinks}
                  onChange={(e) => handleToggleDeadLinks(e.target.checked)}
                  className="sr-only peer"
                  type="checkbox"
                />
                <div className="w-7 h-3.5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-primary-container"></div>
              </label>
            </div>

            <div
              className={`pl-5 pr-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors bg-surface-container/30 ${
                checkDeadLinks ? 'hover:bg-surface-bright/20' : 'opacity-50 pointer-events-none'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="material-symbols-outlined text-[15px] text-sky-300 mt-0.5 shrink-0">lan</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11.5px] font-semibold text-on-surface leading-tight">
                      Include Local / Private URLs
                    </span>
                    {selectedLocalCount > 0 && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300 leading-none">
                        {selectedLocalCount} found
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-outline leading-tight mt-0.5">
                    Scan 192.168.x.x, 10.x.x.x, localhost &amp; .local (off by default)
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  checked={includeLocalPrivate}
                  disabled={!checkDeadLinks}
                  onChange={(e) => handleToggleIncludeLocalPrivate(e.target.checked)}
                  className="sr-only peer"
                  type="checkbox"
                />
                <div className="w-7 h-3.5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-sky-400"></div>
              </label>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-surface-container-lowest border-t border-outline-variant/20 w-full flex items-center justify-between px-margin py-space-xs shrink-0 select-none h-8">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-tertiary status-pulse"></span>
          <span className="font-mono text-[11px] text-on-surface-variant">Sync: Active • Auto-backup</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openSettings} className="text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            Backups
          </button>
        </div>
      </footer>

      {/* Settings & Backups Modal */}
      {isSettingsOpen && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl w-full max-h-[90%] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container/60">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">backup</span>
                <span className="text-[14px] font-semibold text-on-surface">Auto-Backups</span>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-bright transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar space-y-3 flex-1">
              <div className="text-[11.5px] text-on-surface-variant leading-relaxed">
                Chrome Bookmark Checker automatically creates a snapshot of your full bookmark tree before every scan and safely keeps the <strong>last 5 backups</strong>.
              </div>

              <div className="space-y-2 mt-2">
                <div className="text-[11px] font-mono text-outline uppercase tracking-wider font-semibold">
                  Saved Snapshots ({backups.length}/5)
                </div>

                {backups.length === 0 ? (
                  <div className="p-4 rounded-xl bg-surface-container/40 border border-outline-variant/20 text-center text-outline text-[12px]">
                    No backups yet. A backup will be created automatically before your first scan!
                  </div>
                ) : (
                  backups.map((b, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-surface-container/70 border border-outline-variant/30 flex items-center justify-between gap-2 hover:border-outline-variant/60 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-[16px] text-tertiary">history</span>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-on-surface truncate">
                            Snapshot #{idx + 1}
                          </div>
                          <div className="font-mono text-[10px] text-outline truncate">
                            {new Date(b.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => downloadBackup(b)}
                        className="px-2.5 py-1 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary text-[11px] font-semibold flex items-center gap-1 border border-outline-variant/30 hover:border-primary/40 transition-colors cursor-pointer shrink-0"
                        title="Export this backup as JSON"
                      >
                        <span className="material-symbols-outlined text-[13px]">download</span>
                        <span>Export</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="p-3 border-t border-outline-variant/20 bg-surface-container/40 flex items-center justify-between gap-2">
              <button
                disabled={backups.length === 0}
                onClick={clearBackups}
                className="px-2.5 py-1.5 rounded-xl text-error hover:bg-error/10 text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center gap-1"
                title="Clear all stored backups"
              >
                <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                <span>Clear All</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleManualBackup}
                  disabled={isBackingUp}
                  className="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-bright border border-outline-variant/30 text-on-surface text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Take a backup snapshot of bookmarks right now"
                >
                  <span className={`material-symbols-outlined text-[14px] text-primary ${isBackingUp ? 'animate-spin' : ''}`}>add_circle</span>
                  <span>{isBackingUp ? 'Backing up...' : 'Manual Backup'}</span>
                </button>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-primary-container text-on-primary-container text-[11px] font-semibold hover:opacity-95 transition-opacity cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
