import React, { useState, useEffect } from 'react';

export default function DashboardApp() {
  const [results, setResults] = useState({ deadLinks: [], duplicateLinks: [], timestamp: null });
  const [activeTab, setActiveTab] = useState('dead'); // 'dead' or 'duplicates'
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [isRescanning, setIsRescanning] = useState(false);

  const checkSingleUrl = async (url) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      let response;
      try {
        response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
        if (!response.ok && (response.status === 405 || response.status === 403 || response.status === 400 || response.status === 503)) {
          response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
        } else {
          throw e;
        }
      }
      clearTimeout(timeoutId);
      if (response.ok || response.status < 400 || response.status === 401 || response.status === 403) {
        return { isDead: false, statusText: 'OK (Alive)' };
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
  };

  const rescanSelected = async () => {
    if (selectedIds.size === 0 || isRescanning) return;
    setIsRescanning(true);

    const type = activeTab === 'dead' ? 'deadLinks' : 'duplicateLinks';
    let resolvedCount = 0;
    const updatedTypeItems = [];

    for (const item of results[type]) {
      if (selectedIds.has(item.id)) {
        const check = await checkSingleUrl(item.url);
        if (!check.isDead) {
          resolvedCount++;
        } else {
          updatedTypeItems.push({ ...item, statusText: check.statusText });
        }
      } else {
        updatedTypeItems.push(item);
      }
    }

    const updatedResults = {
      ...results,
      [type]: updatedTypeItems
    };

    setResults(updatedResults);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ lastScanResults: updatedResults });
    }

    // Update selected set to remove any links that got resolved
    setSelectedIds(prev => {
      const next = new Set();
      updatedTypeItems.forEach(i => {
        if (prev.has(i.id)) next.add(i.id);
      });
      return next;
    });

    setIsRescanning(false);
    if (resolvedCount > 0) {
      alert(`Re-scan complete: ${resolvedCount} link(s) resolved as alive and removed!`);
    } else {
      alert('Re-scan complete: Selected links are still unreachable or dead.');
    }
  };

  const rescanSingle = async (item) => {
    const check = await checkSingleUrl(item.url);
    const type = activeTab === 'dead' ? 'deadLinks' : 'duplicateLinks';
    
    let updatedTypeItems;
    if (!check.isDead) {
      alert(`"${item.title || item.url}" is ALIVE! Removed from dead list.`);
      updatedTypeItems = results[type].filter(i => i.id !== item.id);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else {
      alert(`"${item.title || item.url}" re-scanned: ${check.statusText}`);
      updatedTypeItems = results[type].map(i => i.id === item.id ? { ...i, statusText: check.statusText } : i);
    }

    const updatedResults = {
      ...results,
      [type]: updatedTypeItems
    };
    setResults(updatedResults);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ lastScanResults: updatedResults });
    }
  };

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['lastScanResults'], (data) => {
        if (data.lastScanResults) {
          setResults(data.lastScanResults);
        }
      });
    } else {
      // Mock for local testing
      setResults({
        deadLinks: [
          { id: '1', title: 'Centreon Dashboard Documentation', url: 'https://docs.centreon.com/legacy/v21.10/en/dashboards/overview.html', folderPath: 'Work & Projects / Monitoring' },
          { id: '2', title: 'Old Intranet Site', url: 'https://internal.corp-nexus.net/portal/legacy-hr-docs', folderPath: 'Work & Projects / Internal' },
          { id: '3', title: 'Log Tutorial', url: 'https://tutorials.dev-archive.io/articles/2019/structured-logging-guide', folderPath: 'Development & Repos / Guides' }
        ],
        duplicateLinks: [],
        timestamp: new Date().toISOString()
      });
    }
  }, []);

  const activeList = activeTab === 'dead' ? results.deadLinks : results.duplicateLinks;

  // Clear selections when switching tabs
  useEffect(() => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  }, [activeTab]);

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(new Set(activeList.map(item => item.id)));
    } else {
      setSelectedIds(new Set());
    }
    setLastSelectedIndex(null);
  };

  const handleSelect = (e, id, index) => {
    const isChecked = e.target.checked;
    const newSelected = new Set(selectedIds);

    if (isChecked) {
      if (e.nativeEvent.shiftKey && lastSelectedIndex !== null) {
        // Shift-click range selection
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          newSelected.add(activeList[i].id);
        }
      } else {
        newSelected.add(id);
      }
    } else {
      newSelected.delete(id);
    }
    
    setSelectedIds(newSelected);
    setLastSelectedIndex(index);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    
    if (window.confirm(`Are you sure you want to permanently delete ${selectedIds.size} bookmarks?`)) {
      const type = activeTab === 'dead' ? 'deadLinks' : 'duplicateLinks';
      
      if (typeof chrome !== 'undefined' && chrome.bookmarks) {
        let deleted = 0;
        selectedIds.forEach(id => {
          chrome.bookmarks.remove(id, () => {
            deleted++;
            if (deleted === selectedIds.size) {
              setResults(prev => ({
                ...prev,
                [type]: prev[type].filter(item => !selectedIds.has(item.id))
              }));
              setSelectedIds(new Set());
            }
          });
        });
      } else {
        setResults(prev => ({
          ...prev,
          [type]: prev[type].filter(item => !selectedIds.has(item.id))
        }));
        setSelectedIds(new Set());
      }
    }
  };

  const deleteSingle = (id) => {
    const type = activeTab === 'dead' ? 'deadLinks' : 'duplicateLinks';
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.remove(id, () => {
        setResults(prev => ({
          ...prev,
          [type]: prev[type].filter(item => item.id !== id)
        }));
        const newSelected = new Set(selectedIds);
        newSelected.delete(id);
        setSelectedIds(newSelected);
      });
    } else {
      setResults(prev => ({
        ...prev,
        [type]: prev[type].filter(item => item.id !== id)
      }));
      const newSelected = new Set(selectedIds);
      newSelected.delete(id);
      setSelectedIds(newSelected);
    }
  };
  
  const allSelected = activeList.length > 0 && selectedIds.size === activeList.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < activeList.length;

  const handleClose = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent((tab) => {
          if (tab && tab.id) {
            chrome.tabs.remove(tab.id);
          } else {
            window.close();
          }
        });
      } else {
        window.close();
      }
    } catch {
      window.close();
    }
  };

  return (
    <div className="bg-surface text-on-surface font-sans antialiased min-h-screen flex flex-col relative selection:bg-primary-container selection:text-on-primary-container">
      <div className="fixed inset-0 pointer-events-none z-0" style={{background: 'radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.12) 0%, rgba(15, 19, 28, 0) 70%)'}}></div>
      <div className="fixed inset-0 pointer-events-none z-0" style={{background: 'radial-gradient(circle at 80% 20%, rgba(99, 102, 241, 0.08) 0%, rgba(15, 19, 28, 0) 65%)'}}></div>
      
      <header className="w-full px-6 py-3 flex items-center justify-between border-b border-outline-variant/30 sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-6">
          <div className="font-semibold text-on-surface tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center shadow-sm overflow-hidden border border-outline-variant/30">
              <img src="/icons/icon48.png" alt="logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-[18px] font-bold text-on-surface">Chrome Bookmark Checker</span>
            <span className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant font-mono text-[10px] px-1.5 py-0.5 rounded ml-1">v1.0.1</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant/20 font-mono text-[10px] text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
            <span>Last scanned: {results.timestamp ? new Date(results.timestamp).toLocaleString() : 'Never'}</span>
          </div>
          <button 
            onClick={handleClose} 
            className="px-3.5 py-1.5 bg-surface-container border border-outline-variant/30 hover:bg-surface-bright rounded-xl text-[13px] font-semibold transition-colors flex items-center gap-1.5 hover:text-error cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Close Dashboard
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 relative z-10 flex flex-col">
        <section className="mb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary font-mono text-[10px] tracking-wider mb-1 font-bold">
                <span className="material-symbols-outlined text-[14px]">troubleshoot</span>
                <span>STRUCTURAL DIAGNOSTICS & AUDIT</span>
              </div>
              <h1 className="text-2xl md:text-3xl text-on-surface font-bold tracking-tight">Bookmark Health Dashboard</h1>
              <p className="text-[13px] text-on-surface-variant mt-1.5 max-w-2xl">
                Manage invalid references, dead 404 targets, and redundant bookmarks detected during your last scan.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-4">
          <div className="inline-flex p-1 rounded-xl bg-surface-container-lowest/80 border border-outline-variant/30 backdrop-blur-md self-start">
            <button 
              onClick={() => setActiveTab('dead')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${activeTab === 'dead' ? 'bg-surface-container-low border border-outline-variant/40 shadow-sm text-on-surface font-semibold' : 'text-on-surface-variant hover:text-on-surface font-semibold border border-transparent'} transition-all`}
            >
              <span className="material-symbols-outlined text-error text-[16px]">link_off</span>
              <span className="text-[13px]">Dead Links (404s)</span>
              <span className="px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-mono text-[10px] font-bold">{results.deadLinks.length}</span>
            </button>
            <button 
              onClick={() => setActiveTab('duplicates')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${activeTab === 'duplicates' ? 'bg-surface-container-low border border-outline-variant/40 shadow-sm text-on-surface font-semibold' : 'text-on-surface-variant hover:text-on-surface font-semibold border border-transparent'} transition-all`}
            >
              <span className="material-symbols-outlined text-tertiary text-[16px]">difference</span>
              <span className="text-[13px]">Duplicates</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-container text-tertiary font-mono text-[10px] font-bold">{results.duplicateLinks.length}</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0 mb-8">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-3 bg-surface-container/40">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={allSelected} 
                  ref={input => input && (input.indeterminate = someSelected)}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-outline-variant/60 bg-surface-container-high text-primary-container focus:ring-0 focus:ring-offset-0 transition-colors cursor-pointer"
                />
                <span className="text-[15px] font-semibold text-on-surface select-none">Select All</span>
              </label>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-medium">
                {selectedIds.size} of {activeList.length} selected
              </span>
            </div>
            
            <div className="flex items-center gap-2.5">
              <button 
                disabled={selectedIds.size === 0 || isRescanning}
                onClick={rescanSelected}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                title="Re-scan selected bookmarks"
              >
                <span className={`material-symbols-outlined text-[16px] text-primary ${isRescanning ? 'animate-spin' : ''}`}>refresh</span>
                <span>{isRescanning ? 'Re-scanning...' : `Re-scan (${selectedIds.size})`}</span>
              </button>
              <button 
                disabled={selectedIds.size === 0 || isRescanning}
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-error-container text-on-error-container hover:bg-error hover:text-on-error text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            </div>
          </div>
          
          <div className="divide-y divide-outline-variant/20 overflow-y-auto custom-scrollbar flex-1">
            {activeList.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-16 text-outline">
                <span className="material-symbols-outlined text-[48px] opacity-50 mb-4">check_circle</span>
                <p className="text-[14px]">Clean! No {activeTab === 'dead' ? 'dead links' : 'duplicates'} found.</p>
              </div>
            ) : (
              activeList.map((item, index) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <article key={item.id} className={`p-4 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group cursor-pointer ${isSelected ? 'bg-primary/5' : 'hover:bg-surface-container/60'}`} onClick={(e) => {
                    // if they didn't click on the checkbox or an action button, toggle selection
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'SPAN') {
                      handleSelect({ target: { checked: !isSelected }, nativeEvent: e.nativeEvent }, item.id, index);
                    }
                  }}>
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={(e) => handleSelect(e, item.id, index)}
                        className="w-4 h-4 mt-1 rounded border-outline-variant/60 bg-surface-container-high text-primary-container focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[15px] text-on-surface font-semibold group-hover:text-primary transition-colors truncate" title={item.title}>
                            {item.title || '(No Title)'}
                          </h3>
                          <span className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md border ${activeTab === 'dead' ? 'bg-error-container/60 border-error/30 text-error' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'}`}>
                            <span className="material-symbols-outlined text-[12px]">{activeTab === 'dead' ? 'error' : 'content_copy'}</span>
                            <span>{activeTab === 'dead' ? (item.statusText || 'HTTP Error / Timeout') : 'Duplicate URL'}</span>
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-outline mt-1 truncate max-w-xl" title={item.url}>
                          {item.url}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {item.folderPath && (
                            <span className="font-mono text-[10px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/20 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px] text-outline">folder</span>
                              <span>{item.folderPath}</span>
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-outline">Checked: {results.timestamp ? new Date(results.timestamp).toLocaleDateString() : 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5 self-end md:self-center">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-2 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-highest/60 transition-colors" title="Inspect Target URL">
                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                      </a>
                      <button 
                        onClick={(e) => { e.stopPropagation(); rescanSingle(item); }}
                        className="p-2 rounded-lg text-outline hover:text-primary hover:bg-surface-container-highest/60 transition-colors" 
                        title="Re-scan this bookmark"
                      >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteSingle(item.id); }}
                        className="p-2 rounded-lg text-outline hover:text-error hover:bg-error-container/30 transition-colors" 
                        title="Delete bookmark"
                      >
                        <span className="material-symbols-outlined text-[18px] transition-transform hover:scale-110">delete</span>
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          
        </div>
      </main>
    </div>
  );
}
