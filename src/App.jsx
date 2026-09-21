import React, { useState, useEffect } from 'react';
import appLogo from '../assets/icons/icon48.png';

function App() {
  const [folders, setFolders] = useState([]);
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [totalBookmarksCount, setTotalBookmarksCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ total: 0, processed: 0, dead: 0, duplicates: 0 });
  const [scanResults, setScanResults] = useState(null);

  useEffect(() => {
    // Check if we're running inside the Chrome extension
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.getTree((tree) => {
        let count = 0;
        const countUrls = (nodes) => {
          nodes.forEach(node => {
            if (node.url && (node.url.startsWith('http://') || node.url.startsWith('https://'))) {
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

          const hasDirectBookmarks = node.children.some(c => c.url);
          const subfolders = node.children.filter(c => c.children);
          const isRoot = node.parentId === '0' || ['1', '2', '3'].includes(node.id);

          if (isRoot) {
            const rootTitle = node.title || (node.id === '1' ? 'Bookmarks Bar' : node.id === '2' ? 'Other Bookmarks' : 'Mobile Bookmarks');
            if (subfolders.length === 0) {
              // Root node with direct bookmarks or empty
              if (hasDirectBookmarks || rootNodes.length <= 3) {
                detectedFolders.push({ id: node.id, title: rootTitle });
              }
            } else {
              // Root node has subfolders
              if (hasDirectBookmarks) {
                detectedFolders.push({ id: node.id, title: `${rootTitle} (Root Items)` });
              }
              subfolders.forEach(sub => traverse(sub, rootTitle));
            }
          } else {
            // Nested subfolder
            const currentPath = parentPath ? `${parentPath} / ${node.title}` : node.title;
            detectedFolders.push({ id: node.id, title: currentPath });
            subfolders.forEach(sub => traverse(sub, currentPath));
          }
        };

        rootNodes.forEach(root => traverse(root, ''));

        // Fallback: if no folders detected at all, default to root nodes
        if (detectedFolders.length === 0) {
          rootNodes.forEach(root => {
            detectedFolders.push({
              id: root.id,
              title: root.title || (root.id === '1' ? 'Bookmarks Bar' : 'Other Bookmarks')
            });
          });
        }

        setFolders(detectedFolders);
        setSelectedFolders(new Set(detectedFolders.map(f => f.id)));
      });
      
      // Load previous scan results if any
      chrome.storage.local.get(['lastScanResults'], (data) => {
        if (data.lastScanResults) setScanResults(data.lastScanResults);
      });
    } else {
      // Fallback for local development
      const fallback = [
        { id: '1', title: 'Bookmarks Bar' },
        { id: '2', title: 'Work & Projects' },
        { id: '3', title: 'To Read / Research' }
      ];
      setFolders(fallback);
      setSelectedFolders(new Set(fallback.map(f => f.id)));
    }
  }, []);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      // Ask background if a scan is currently running
      chrome.runtime.sendMessage({ action: 'GET_SCAN_STATUS' }, (response) => {
        if (response && response.activeScan) {
          setIsScanning(true);
          setScanProgress(response.activeScan);
        }
      });

      const handleMessage = (msg) => {
        if (msg.action === 'SCAN_PROGRESS') {
          setScanProgress(msg.progress);
        } else if (msg.action === 'SCAN_COMPLETE') {
          setIsScanning(false);
          chrome.storage.local.get(['lastScanResults'], (data) => {
            if (data.lastScanResults) setScanResults(data.lastScanResults);
          });
        } else if (msg.action === 'SCAN_CANCELLED') {
          setIsScanning(false);
          alert("Scan was cancelled.");
        }
      };
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }
  }, []);

  const handleStartScan = () => {
    const foldersToScan = selectedFolders.size > 0 
      ? Array.from(selectedFolders) 
      : folders.map(f => f.id);

    if (foldersToScan.length === 0 && totalBookmarksCount > 0) {
      // Ultimate fallback: scan default root IDs
      foldersToScan.push('1', '2');
    }

    if (foldersToScan.length === 0) {
      alert("No bookmarks or folders available to scan.");
      return;
    }
    
    setIsScanning(true);
    setScanResults(null);
    setScanProgress({ total: 100, processed: 0, dead: 0, duplicates: 0 }); // reset

    // In actual extension, send message to background
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ 
        action: 'START_SCAN', 
        selectedFolders: foldersToScan
      });
    } else {
      // Simulate progress for testing locally without extension context
      let current = 0;
      const interval = setInterval(() => {
        current += Math.floor(Math.random() * 10) + 1;
        if (current >= 100) {
          current = 100;
          clearInterval(interval);
          setTimeout(() => {
            setIsScanning(false);
            setScanResults({ deadLinks: [], duplicateLinks: [] }); // dummy
          }, 500);
        }
        setScanProgress(prev => ({ ...prev, processed: current, dead: Math.floor(current / 10), duplicates: Math.floor(current / 20) }));
      }, 300);
    }
  };

  const handleCancelScan = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'CANCEL_SCAN' }, () => {
        setIsScanning(false);
      });
    } else {
      setIsScanning(false); // local sim fallback
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

  const selectAll = () => setSelectedFolders(new Set(folders.map(f => f.id)));
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
      setBackups([
        { timestamp: new Date().toISOString(), data: [] }
      ]);
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
    if (window.confirm("Are you sure you want to delete all saved backup snapshots?")) {
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
      alert("Error downloading backup: " + err.message);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface text-on-surface font-sans relative">
      <header className="bg-surface-container border-b border-outline-variant/30 w-full flex items-center justify-between px-margin py-space-xs shrink-0 select-none h-11">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-surface-container flex items-center justify-center shadow-sm overflow-hidden border border-outline-variant/30">
            <img src={appLogo} alt="logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-[13px] font-semibold text-on-surface tracking-tight">Chrome Bookmark Checker</span>
          <span className="bg-surface-variant text-primary font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wide font-medium border border-outline-variant/40">v1.0.2</span>
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
                     Found <span className="text-error font-mono font-bold">{scanResults.deadLinks.length}</span> dead links and <span className="text-emerald-400 font-mono font-bold">{scanResults.duplicateLinks.length}</span> duplicates.
                   </div>
                   <div className="flex gap-2 pt-0.5">
                      <button onClick={() => {
                         if (typeof chrome !== 'undefined') {
                           if (chrome.runtime?.openOptionsPage) {
                             chrome.runtime.openOptionsPage();
                           } else if (chrome.tabs) {
                             chrome.tabs.create({ url: chrome.runtime?.getURL('src/dashboard.html') || 'src/dashboard.html' });
                           }
                         }
                      }} className="flex-1 h-7 rounded-lg bg-primary-container text-on-primary-container hover:opacity-90 transition-opacity text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer">
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
                  <button onClick={handleStartScan} className="w-full h-9 rounded-xl bg-gradient-to-r from-primary-container via-inverse-primary to-secondary-container hover:opacity-95 transition-all flex items-center justify-center gap-2 text-on-surface text-[12.5px] font-semibold shadow-md shadow-secondary-container/20 group relative overflow-hidden cursor-pointer">
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
                  <span className="text-primary font-medium animate-pulse">Scanning in progress...</span>
                  <button onClick={handleCancelScan} className="flex items-center gap-0.5 text-error hover:bg-error/10 px-1.5 py-0.5 rounded transition-colors text-[9px] font-bold tracking-wide uppercase cursor-pointer">
                    <span className="material-symbols-outlined text-[11px]">stop_circle</span>
                    Cancel
                  </button>
                </div>
                <span className="text-on-surface-variant font-mono">{scanProgress.processed} / {scanProgress.total}</span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary-container to-secondary-container rounded-full transition-all duration-300"
                  style={{ width: `${scanProgress.total > 0 ? Math.round((scanProgress.processed / scanProgress.total) * 100) : 0}%` }}
                ></div>
              </div>
              <div className="flex justify-between items-center text-[9.5px] font-mono text-outline">
                <span className="text-error">{scanProgress.dead} dead links</span>
                <span className="text-emerald-400">{scanProgress.duplicates} duplicates</span>
              </div>
            </div>
          )}
        </section>

        <section className={`space-y-1.5 flex flex-col min-h-0 transition-opacity duration-300 ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between px-0.5 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-on-surface">Select Folders</span>
              <span className="bg-surface-variant text-on-surface-variant font-mono text-[9.5px] px-1.5 py-0.5 rounded-full">{selectedFolders.size}/{folders.length}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={selectAll} className="text-[10.5px] font-medium text-primary hover:text-primary-fixed transition-colors cursor-pointer">Select All</button>
              <button onClick={deselectAll} className="text-[10.5px] font-medium text-outline hover:text-on-surface transition-colors cursor-pointer">Deselect All</button>
            </div>
          </div>
          
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl divide-y divide-outline-variant/20 overflow-y-auto max-h-[110px] custom-scrollbar">
            {folders.map((folder, idx) => (
              <label key={folder.id} className="flex items-center justify-between px-2.5 py-1.5 hover:bg-surface-bright/30 transition-colors cursor-pointer group">
                <div className="flex items-center gap-2">
                  <input 
                    checked={selectedFolders.has(folder.id)} 
                    onChange={() => toggleFolder(folder.id)}
                    className="w-3.5 h-3.5 rounded bg-surface-container border-outline-variant/60 text-primary-container focus:ring-1 focus:ring-primary focus:ring-offset-0 transition-colors cursor-pointer" 
                    type="checkbox"
                  />
                  <div className="flex items-center gap-1.5">
                    <span className={`material-symbols-outlined text-[14px] ${idx % 2 === 0 ? 'text-primary' : 'text-secondary'}`}>folder</span>
                    <span className="text-[12px] text-on-surface group-hover:text-white transition-colors">{folder.title}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-1.5 flex-shrink-0">
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
                <input defaultChecked className="sr-only peer" type="checkbox"/>
                <div className="w-7 h-3.5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-primary-container"></div>
              </label>
            </div>
            
            <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-surface-bright/20 transition-colors">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[15px] text-error mt-0.5">link_off</span>
                <div>
                  <div className="text-[12px] font-semibold text-on-surface leading-tight">Check Dead Links (404)</div>
                  <div className="text-[10px] text-outline leading-tight mt-0.5">Pings servers to detect broken links</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input defaultChecked className="sr-only peer" type="checkbox"/>
                <div className="w-7 h-3.5 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[1.5px] after:left-[1.5px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-primary-container"></div>
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
          <button onClick={openSettings} className="text-[11px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">Backups</button>
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
