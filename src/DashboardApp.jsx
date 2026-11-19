import React, { useState, useEffect, useRef, useMemo } from 'react';
import appLogo from '../assets/icons/icon48.png';
import {
  checkBookmarkUrl,
  buildDebugExportPayload,
  formatDebugExportForClipboard,
  extractBookmarksFromTree,
  inferBookmarkCategory,
  interleaveByHostname,
  runWithConcurrencyPool,
  getHostnameSafe
} from './utils/bookmarkUtils.js';

const DEAD_FILTER_CHIPS = [
  { key: 'all', label: 'All' },
  { key: '404', label: '404 / 410' },
  { key: 'network', label: 'DNS / Network' },
  { key: 'timeout', label: 'Timeout' },
  { key: '5xx', label: '5xx / Server' },
  { key: 'local-private', label: 'Local / Private' }
];

function getDeadBadgeMeta(category) {
  switch (category) {
    case 'timeout':
      return {
        classes: 'bg-amber-500/15 border-amber-400/40 text-amber-300',
        icon: 'schedule'
      };
    case '5xx':
      return {
        classes: 'bg-amber-500/15 border-amber-400/40 text-amber-300',
        icon: 'warning'
      };
    case 'local-private':
      return {
        classes: 'bg-sky-500/15 border-sky-400/40 text-sky-300',
        icon: 'lan'
      };
    case 'redirect-homepage':
      return {
        classes: 'bg-tertiary/10 border-tertiary/30 text-tertiary',
        icon: 'alt_route'
      };
    default:
      return {
        classes: 'bg-error-container/60 border-error/30 text-error',
        icon: 'error'
      };
  }
}

function applyRescanCheck(prevResults, itemId, sourceTab, check) {
  const deadLinks = prevResults.deadLinks || [];
  const redirectedLinks = prevResults.redirectedLinks || [];
  const duplicateLinks = prevResults.duplicateLinks || [];

  const sourceList = sourceTab === 'redirects' ? redirectedLinks : deadLinks;
  const targetItem = sourceList.find((i) => i.id === itemId);
  if (!targetItem) return prevResults;

  if (sourceTab === 'dead') {
    if (!check.isDead && !check.redirectedToHomepage) {
      return {
        ...prevResults,
        deadLinks: deadLinks.filter((i) => i.id !== itemId),
        redirectedLinks,
        duplicateLinks
      };
    }

    if (!check.isDead && check.redirectedToHomepage) {
      const redirectItem = {
        ...targetItem,
        statusText: 'Redirected to Homepage',
        category: 'redirect-homepage',
        isLocalPrivate: Boolean(check.isLocalPrivate),
        finalUrl: check.diagnostics?.finalUrl || null,
        diagnostics: check.diagnostics || targetItem.diagnostics || null
      };
      const nextRedirects = redirectedLinks.some((i) => i.id === itemId)
        ? redirectedLinks.map((i) => (i.id === itemId ? redirectItem : i))
        : [...redirectedLinks, redirectItem];

      return {
        ...prevResults,
        deadLinks: deadLinks.filter((i) => i.id !== itemId),
        redirectedLinks: nextRedirects,
        duplicateLinks
      };
    }

    return {
      ...prevResults,
      deadLinks: deadLinks.map((i) =>
        i.id === itemId
          ? {
              ...i,
              statusText: check.statusText,
              category: check.category,
              isLocalPrivate: Boolean(check.isLocalPrivate),
              diagnostics: check.diagnostics || i.diagnostics || null
            }
          : i
      ),
      redirectedLinks,
      duplicateLinks
    };
  }

  if (sourceTab === 'redirects') {
    if (!check.isDead && !check.redirectedToHomepage) {
      return {
        ...prevResults,
        deadLinks,
        redirectedLinks: redirectedLinks.filter((i) => i.id !== itemId),
        duplicateLinks
      };
    }

    if (!check.isDead && check.redirectedToHomepage) {
      return {
        ...prevResults,
        deadLinks,
        redirectedLinks: redirectedLinks.map((i) =>
          i.id === itemId
            ? {
                ...i,
                finalUrl: check.diagnostics?.finalUrl || i.finalUrl || null,
                diagnostics: check.diagnostics || i.diagnostics || null
              }
            : i
        ),
        duplicateLinks
      };
    }

    const deadItem = {
      ...targetItem,
      statusText: check.statusText,
      category: check.category,
      isLocalPrivate: Boolean(check.isLocalPrivate),
      diagnostics: check.diagnostics || targetItem.diagnostics || null
    };
    const nextDead = deadLinks.some((i) => i.id === itemId)
      ? deadLinks.map((i) => (i.id === itemId ? deadItem : i))
      : [...deadLinks, deadItem];

    return {
      ...prevResults,
      deadLinks: nextDead,
      redirectedLinks: redirectedLinks.filter((i) => i.id !== itemId),
      duplicateLinks
    };
  }

  return prevResults;
}

const pruneSingleDuplicates = (list) => {
  const counts = new Map();
  list.forEach((item) => counts.set(item.url, (counts.get(item.url) || 0) + 1));
  return list.filter((item) => (counts.get(item.url) || 0) > 1);
};

export default function DashboardApp() {
  const [results, setResults] = useState({
    deadLinks: [],
    redirectedLinks: [],
    duplicateLinks: [],
    timestamp: null,
    summary: null
  });
  const [activeTab, setActiveTab] = useState('dead'); // 'dead' | 'redirects' | 'duplicates'
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selection & action state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [rescanProgress, setRescanProgress] = useState({ active: false, completed: 0, total: 0 });
  const [rescanningIds, setRescanningIds] = useState(new Set());
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [toast, setToast] = useState(null);

  const copyFeedbackTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const shouldPersistRef = useRef(false);

  const extensionVersion =
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.1.0';

  const showToast = (message, tone = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Persist results outside React state updaters to stay StrictMode-safe
  useEffect(() => {
    if (!shouldPersistRef.current) return;
    shouldPersistRef.current = false;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ lastScanResults: results });
    }
  }, [results]);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['lastScanResults'], (data) => {
        if (chrome.runtime?.lastError) return;
        if (data.lastScanResults) {
          const stored = data.lastScanResults;
          const normalized = {
            deadLinks: stored.deadLinks || [],
            redirectedLinks: stored.redirectedLinks || [],
            duplicateLinks: stored.duplicateLinks || [],
            timestamp: stored.timestamp || null,
            summary: stored.summary || null
          };
          setResults(normalized);

          const duplicateLinks = normalized.duplicateLinks;
          const urlCounts = new Map();
          duplicateLinks.forEach((item) => {
            urlCounts.set(item.url, (urlCounts.get(item.url) || 0) + 1);
          });
          const hasLegacySingleEntries = Array.from(urlCounts.values()).some((count) => count === 1);

          if (hasLegacySingleEntries && chrome.bookmarks?.getTree) {
            chrome.bookmarks.getTree((tree) => {
              if (chrome.runtime?.lastError || !tree || tree.length === 0) return;
              const roots = tree[0]?.id === '0' && Array.isArray(tree[0].children) ? tree[0].children : tree;
              const allBookmarks = extractBookmarksFromTree(roots);
              const byUrl = new Map();
              allBookmarks.forEach((bm) => {
                if (!byUrl.has(bm.url)) byUrl.set(bm.url, []);
                byUrl.get(bm.url).push(bm);
              });

              const uniqueDupUrls = Array.from(new Set(duplicateLinks.map((item) => item.url)));
              const expandedDuplicates = [];
              uniqueDupUrls.forEach((url) => {
                const matches = byUrl.get(url) || [];
                if (matches.length >= 2) {
                  matches.forEach((bm, idx) => {
                    expandedDuplicates.push({ ...bm, isOriginal: idx === 0 });
                  });
                }
              });

              shouldPersistRef.current = true;
              setResults((prev) => ({
                ...prev,
                duplicateLinks: expandedDuplicates
              }));
            });
          }
        }
      });
    } else {
      // Mock data for standalone browser preview
      setResults({
        deadLinks: [
          {
            id: '1',
            title: 'Centreon Dashboard Documentation',
            url: 'https://docs.centreon.com/legacy/v21.10/en/dashboards/overview.html',
            folderPath: 'Work & Projects / Monitoring',
            statusText: 'HTTP 404 Not Found',
            category: '404'
          },
          {
            id: '2',
            title: 'Slow Vendor Portal',
            url: 'https://vendor.example.org/portal',
            folderPath: 'Work & Projects / Vendors',
            statusText: 'Timeout (12s)',
            category: 'timeout'
          },
          {
            id: '3',
            title: 'Home Router Admin',
            url: 'http://192.168.1.1/',
            folderPath: 'Hardware / Local',
            statusText: 'Local / Private (Unreachable)',
            category: 'local-private',
            isLocalPrivate: true
          }
        ],
        redirectedLinks: [
          {
            id: '4',
            title: 'Mid-Range RFID | EPC Class 1 Gen 2',
            url: 'https://skyrfid.com/Mid-Range_RFID.php',
            finalUrl: 'https://www.skyrfid.com/',
            folderPath: 'RF / RAIN RFID',
            statusText: 'Redirected to Homepage',
            category: 'redirect-homepage'
          }
        ],
        duplicateLinks: [],
        timestamp: new Date().toISOString(),
        summary: null
      });
    }
  }, []);

  const activeList = useMemo(() => {
    if (activeTab === 'dead') return results.deadLinks || [];
    if (activeTab === 'redirects') return results.redirectedLinks || [];
    return results.duplicateLinks || [];
  }, [activeTab, results]);

  // Compute category counts for Dead tab filter chips
  const deadCategoryCounts = useMemo(() => {
    const counts = {
      all: (results.deadLinks || []).length,
      '404': 0,
      network: 0,
      timeout: 0,
      '5xx': 0,
      'local-private': 0
    };
    for (const item of results.deadLinks || []) {
      const cat = inferBookmarkCategory(item);
      if (cat === 'other-http') {
        counts['5xx']++;
      } else if (Object.prototype.hasOwnProperty.call(counts, cat)) {
        counts[cat]++;
      } else {
        counts['5xx']++;
      }
    }
    return counts;
  }, [results.deadLinks]);

  const timeoutItems = useMemo(
    () => (results.deadLinks || []).filter((item) => inferBookmarkCategory(item) === 'timeout'),
    [results.deadLinks]
  );

  // Filtered list based on Dead status chip and search query
  const filteredList = useMemo(() => {
    let list = activeList;

    if (activeTab === 'dead' && statusFilter !== 'all') {
      list = list.filter((item) => {
        const cat = inferBookmarkCategory(item);
        if (statusFilter === '5xx') {
          return cat === '5xx' || cat === 'other-http';
        }
        return cat === statusFilter;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((item) => {
        const fields = [
          item.title,
          item.url,
          item.folderPath,
          item.statusText,
          item.finalUrl || item.diagnostics?.finalUrl
        ];
        return fields.some((val) => typeof val === 'string' && val.toLowerCase().includes(q));
      });
    }

    return list;
  }, [activeList, activeTab, statusFilter, searchQuery]);

  // Reset tab-local UI state when switching tabs
  useEffect(() => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    setStatusFilter('all');
    setSearchQuery('');
  }, [activeTab]);

  // Keep selectedIds synced strictly with currently visible items so hidden rows are never acted on accidentally
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(filteredList.map((item) => item.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredList]);

  // Pre-compute duplicate group metadata across the full duplicate list
  const duplicateMetaMap = useMemo(() => {
    const map = new Map();
    if (activeTab !== 'duplicates') return map;

    const urlTotals = new Map();
    activeList.forEach((item) => {
      urlTotals.set(item.url, (urlTotals.get(item.url) || 0) + 1);
    });
    const urlCurrentIndex = new Map();
    activeList.forEach((item) => {
      const copyIndex = (urlCurrentIndex.get(item.url) || 0) + 1;
      urlCurrentIndex.set(item.url, copyIndex);
      map.set(item.id, {
        copyIndex,
        groupTotal: urlTotals.get(item.url)
      });
    });
    return map;
  }, [activeTab, activeList]);

  // Safe Select All target IDs:
  // - Dead tab (non-local filter): excludes local-private URLs
  // - Dead tab (local-private filter): includes visible local-private URLs (for VPN re-scan / debug export)
  // - Redirects tab: includes all visible items
  // - Duplicates tab: skips primary copy (copyIndex === 1) of each URL
  const selectableIdsForSelectAll = useMemo(() => {
    if (activeTab === 'duplicates') {
      return filteredList
        .filter((item) => duplicateMetaMap.get(item.id)?.copyIndex !== 1)
        .map((item) => item.id);
    }
    if (activeTab === 'dead' && statusFilter !== 'local-private') {
      return filteredList
        .filter((item) => inferBookmarkCategory(item) !== 'local-private')
        .map((item) => item.id);
    }
    return filteredList.map((item) => item.id);
  }, [activeTab, statusFilter, filteredList, duplicateMetaMap]);

  const hasSkippedLocalInSelectAll =
    activeTab === 'dead' &&
    statusFilter !== 'local-private' &&
    filteredList.some((item) => inferBookmarkCategory(item) === 'local-private');

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(new Set(selectableIdsForSelectAll));
    } else {
      setSelectedIds(new Set());
    }
    setLastSelectedIndex(null);
  };

  const handleSelect = (e, id, index) => {
    const isChecked = e.target.checked;
    const newSelected = new Set(selectedIds);

    if (isChecked) {
      if (e.nativeEvent?.shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          if (filteredList[i]) {
            newSelected.add(filteredList[i].id);
          }
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

  const applyRemovedBookmarkIds = (idsToRemoveSet) => {
    shouldPersistRef.current = true;
    setResults((prev) => ({
      ...prev,
      deadLinks: (prev.deadLinks || []).filter((item) => !idsToRemoveSet.has(item.id)),
      redirectedLinks: (prev.redirectedLinks || []).filter((item) => !idsToRemoveSet.has(item.id)),
      duplicateLinks: pruneSingleDuplicates(
        (prev.duplicateLinks || []).filter((item) => !idsToRemoveSet.has(item.id))
      )
    }));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      idsToRemoveSet.forEach((id) => next.delete(id));
      return next;
    });
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0 || rescanProgress.active) return;

    const selectedItems = filteredList.filter((item) => selectedIds.has(item.id));
    const localSelected = selectedItems.filter((item) => inferBookmarkCategory(item) === 'local-private').length;
    const timeoutSelected = selectedItems.filter((item) => inferBookmarkCategory(item) === 'timeout').length;
    const redirectSelected =
      activeTab === 'redirects'
        ? selectedItems.length
        : selectedItems.filter((item) => inferBookmarkCategory(item) === 'redirect-homepage').length;

    const cautionParts = [];
    if (localSelected > 0) cautionParts.push(`${localSelected} Local/Private`);
    if (timeoutSelected > 0) cautionParts.push(`${timeoutSelected} Timeout`);
    if (redirectSelected > 0) cautionParts.push(`${redirectSelected} Homepage Redirect`);

    const cautionLine =
      cautionParts.length > 0
        ? `\n\nCaution: Selection includes ${cautionParts.join(', ')} item(s) that may still be active.`
        : '';

    if (
      window.confirm(
        `Are you sure you want to permanently delete ${selectedIds.size} bookmark(s)?${cautionLine}`
      )
    ) {
      const idsToDelete = new Set(selectedIds);

      if (typeof chrome !== 'undefined' && chrome.bookmarks) {
        let completed = 0;
        idsToDelete.forEach((id) => {
          chrome.bookmarks.remove(id, () => {
            if (chrome.runtime?.lastError) {
              console.warn('Bookmark delete warning:', id, chrome.runtime.lastError.message);
            }
            completed++;
            if (completed === idsToDelete.size) {
              applyRemovedBookmarkIds(idsToDelete);
              showToast(`Deleted ${idsToDelete.size} bookmark(s).`, 'info');
            }
          });
        });
      } else {
        applyRemovedBookmarkIds(idsToDelete);
        showToast(`Deleted ${idsToDelete.size} bookmark(s).`, 'info');
      }
    }
  };

  const deleteSingle = (id) => {
    const idsToDelete = new Set([id]);
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      chrome.bookmarks.remove(id, () => {
        if (chrome.runtime?.lastError) {
          console.warn('Bookmark delete warning:', id, chrome.runtime.lastError.message);
        }
        applyRemovedBookmarkIds(idsToDelete);
        showToast('Bookmark deleted.', 'info');
      });
    } else {
      applyRemovedBookmarkIds(idsToDelete);
      showToast('Bookmark deleted.', 'info');
    }
  };

  const rescanBatch = async (itemsToScan, { forceGet = false } = {}) => {
    if (!Array.isArray(itemsToScan) || itemsToScan.length === 0 || rescanProgress.active) return;
    if (activeTab === 'duplicates') return;

    const sourceTab = activeTab;
    const interleaved = interleaveByHostname(itemsToScan, (item) => item.url);

    setRescanProgress({ active: true, completed: 0, total: interleaved.length });
    setRescanningIds((prev) => {
      const next = new Set(prev);
      interleaved.forEach((item) => next.add(item.id));
      return next;
    });

    let completed = 0;
    let resolvedCount = 0;
    let movedToRedirects = 0;
    let movedToDead = 0;

    try {
      await runWithConcurrencyPool(
        interleaved,
        (item) => {
          const isTimeoutItem = forceGet || inferBookmarkCategory(item) === 'timeout';
          return checkBookmarkUrl(
            item.url,
            isTimeoutItem
              ? { skipHead: true, getTimeoutMs: 20000, noCorsTimeoutMs: 8000, attempt: 2 }
              : { attempt: 1 }
          );
        },
        {
          concurrency: 4,
          maxPerHost: 2,
          getHost: (item) => getHostnameSafe(item.url),
          onItemDone: (check, item) => {
            completed++;
            setRescanProgress({ active: true, completed, total: interleaved.length });
            setRescanningIds((prev) => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });

            if (!check) return;

            if (!check.isDead && !check.redirectedToHomepage) {
              resolvedCount++;
            } else if (sourceTab === 'dead' && !check.isDead && check.redirectedToHomepage) {
              movedToRedirects++;
            } else if (sourceTab === 'redirects' && check.isDead) {
              movedToDead++;
            }

            shouldPersistRef.current = true;
            setResults((prev) => applyRescanCheck(prev, item.id, sourceTab, check));
          }
        }
      );

      if (resolvedCount > 0 || movedToRedirects > 0) {
        const parts = [];
        if (resolvedCount > 0) parts.push(`${resolvedCount} alive (removed)`);
        if (movedToRedirects > 0) parts.push(`${movedToRedirects} moved to Redirects`);
        showToast(`Re-scan complete: ${parts.join(', ')}.`, 'success');
      } else if (movedToDead > 0) {
        showToast(`Re-scan complete: ${movedToDead} redirect(s) became unreachable.`, 'warning');
      } else {
        showToast('Re-scan complete: No status changes detected.', 'info');
      }
    } finally {
      setRescanProgress({ active: false, completed: 0, total: 0 });
      setRescanningIds(new Set());
    }
  };

  const rescanSingle = async (item) => {
    if (activeTab === 'duplicates' || rescanningIds.has(item.id)) return;

    const sourceTab = activeTab;
    setRescanningIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });

    try {
      const isTimeoutItem = inferBookmarkCategory(item) === 'timeout';
      const check = await checkBookmarkUrl(
        item.url,
        isTimeoutItem
          ? { skipHead: true, getTimeoutMs: 20000, noCorsTimeoutMs: 8000, attempt: 2 }
          : { attempt: 1 }
      );

      shouldPersistRef.current = true;
      setResults((prev) => applyRescanCheck(prev, item.id, sourceTab, check));

      const label = item.title || item.url;
      if (!check.isDead && !check.redirectedToHomepage) {
        showToast(`"${label}" is ALIVE — removed from list.`, 'success');
      } else if (!check.isDead && check.redirectedToHomepage) {
        showToast(
          sourceTab === 'dead'
            ? `"${label}" resolved via homepage redirect — moved to Redirects.`
            : `"${label}" still redirects to homepage.`,
          'info'
        );
      } else {
        showToast(`"${label}" re-scanned: ${check.statusText}`, 'warning');
      }
    } finally {
      setRescanningIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const getSelectedItems = () => filteredList.filter((item) => selectedIds.has(item.id));

  const buildSelectedDebugPayload = () =>
    buildDebugExportPayload(getSelectedItems(), {
      tab: activeTab,
      scanTimestamp: results.timestamp,
      extensionVersion
    });

  const copySelectedDebug = async () => {
    if (selectedIds.size === 0 || rescanProgress.active) return;
    const text = formatDebugExportForClipboard(buildSelectedDebugPayload());

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(true);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(false);
    }, 2000);
  };

  const exportSelectedJson = () => {
    if (selectedIds.size === 0 || rescanProgress.active) return;
    const payload = buildSelectedDebugPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `bookmark-debug-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allSelected =
    selectableIdsForSelectAll.length > 0 &&
    selectableIdsForSelectAll.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

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

  const emptyMessage = (() => {
    if (searchQuery.trim()) return 'No bookmarks match your search filter.';
    if (activeTab === 'dead') {
      return statusFilter === 'all'
        ? 'Clean! No dead links found.'
        : 'No bookmarks in this status category.';
    }
    if (activeTab === 'redirects') return 'Clean! No homepage redirects detected.';
    return 'Clean! No duplicates found.';
  })();

  return (
    <div className="bg-surface text-on-surface font-sans antialiased min-h-screen flex flex-col relative selection:bg-primary-container selection:text-on-primary-container">
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.12) 0%, rgba(15, 19, 28, 0) 70%)'
        }}
      ></div>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(circle at 80% 20%, rgba(99, 102, 241, 0.08) 0%, rgba(15, 19, 28, 0) 65%)'
        }}
      ></div>

      <header className="w-full px-6 py-3 flex items-center justify-between border-b border-outline-variant/30 sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-6">
          <div className="font-semibold text-on-surface tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center shadow-sm overflow-hidden border border-outline-variant/30">
              <img src={appLogo} alt="logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-[18px] font-bold text-on-surface">Chrome Bookmark Checker</span>
            <span className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant font-mono text-[10px] px-1.5 py-0.5 rounded ml-1">
              v{extensionVersion}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {results.summary?.skippedLocalCount > 0 && (
            <div
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-400/30 font-mono text-[10px] text-sky-300"
              title="Local/private URLs were skipped for faster scanning. Enable 'Include Local / Private URLs' in the popup to check them."
            >
              <span className="material-symbols-outlined text-[13px]">lan</span>
              <span>{results.summary.skippedLocalCount} local/private skipped</span>
            </div>
          )}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant/20 font-mono text-[10px] text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
            <span>
              Last scanned: {results.timestamp ? new Date(results.timestamp).toLocaleString() : 'Never'}
            </span>
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
        <section className="mb-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary font-mono text-[10px] tracking-wider mb-1 font-bold">
                <span className="material-symbols-outlined text-[14px]">troubleshoot</span>
                <span>STRUCTURAL DIAGNOSTICS &amp; AUDIT</span>
              </div>
              <h1 className="text-2xl md:text-3xl text-on-surface font-bold tracking-tight">
                Bookmark Health Dashboard
              </h1>
              <p className="text-[13px] text-on-surface-variant mt-1.5 max-w-2xl">
                Review broken 404 targets, timed-out or unreachable local links, homepage redirects, and duplicate bookmarks.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-4">
          <div className="inline-flex flex-wrap p-1 rounded-xl bg-surface-container-lowest/80 border border-outline-variant/30 backdrop-blur-md self-start gap-1">
            <button
              onClick={() => setActiveTab('dead')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer ${
                activeTab === 'dead'
                  ? 'bg-surface-container-low border border-outline-variant/40 shadow-sm text-on-surface font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface font-semibold border border-transparent'
              } transition-all`}
            >
              <span className="material-symbols-outlined text-error text-[16px]">link_off</span>
              <span className="text-[13px]">Dead &amp; Unreachable</span>
              <span className="px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-mono text-[10px] font-bold">
                {(results.deadLinks || []).length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('redirects')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer ${
                activeTab === 'redirects'
                  ? 'bg-surface-container-low border border-outline-variant/40 shadow-sm text-on-surface font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface font-semibold border border-transparent'
              } transition-all`}
            >
              <span className="material-symbols-outlined text-tertiary text-[16px]">alt_route</span>
              <span className="text-[13px]">Redirects</span>
              <span className="px-2 py-0.5 rounded-full bg-tertiary/15 text-tertiary font-mono text-[10px] font-bold">
                {(results.redirectedLinks || []).length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('duplicates')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer ${
                activeTab === 'duplicates'
                  ? 'bg-surface-container-low border border-outline-variant/40 shadow-sm text-on-surface font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface font-semibold border border-transparent'
              } transition-all`}
            >
              <span className="material-symbols-outlined text-secondary text-[16px]">difference</span>
              <span className="text-[13px]">Duplicates</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-container text-secondary font-mono text-[10px] font-bold">
                {(results.duplicateLinks || []).length}
              </span>
            </button>
          </div>

          <div className="relative w-full md:w-72">
            <span className="material-symbols-outlined text-[16px] text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title, URL, folder..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-surface-container-low border border-outline-variant/30 text-[13px] text-on-surface placeholder:text-outline focus:outline-none focus:border-primary/60 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface cursor-pointer"
                title="Clear search"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>
        </div>

        {activeTab === 'dead' && (results.deadLinks || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {DEAD_FILTER_CHIPS.map((chip) => {
              const count = deadCategoryCounts[chip.key] || 0;
              if (chip.key !== 'all' && count === 0) return null;
              const isActive = statusFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  onClick={() => setStatusFilter(chip.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-primary-container/25 border-primary/60 text-on-surface'
                      : 'bg-surface-container-low border-outline-variant/30 text-on-surface-variant hover:border-outline-variant/60 hover:text-on-surface'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-surface-container text-on-surface-variant">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0 mb-8">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-3 bg-surface-container/40">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => input && (input.indeterminate = someSelected)}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-outline-variant/60 bg-surface-container-high text-primary-container focus:ring-0 focus:ring-offset-0 transition-colors cursor-pointer"
                />
                <span className="text-[15px] font-semibold text-on-surface select-none">Select All</span>
              </label>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-medium">
                {selectedIds.size} of {filteredList.length} selected
              </span>
              {hasSkippedLocalInSelectAll && (
                <span className="font-mono text-[10px] text-sky-300/90">(skips local)</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {activeTab === 'dead' && timeoutItems.length > 0 && (
                <button
                  disabled={rescanProgress.active}
                  onClick={() => rescanBatch(timeoutItems, { forceGet: true })}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                  title="Re-scan all timed-out links with extended GET timeout"
                >
                  <span className={`material-symbols-outlined text-[16px] ${rescanProgress.active ? 'animate-spin' : ''}`}>
                    schedule
                  </span>
                  <span>Re-scan Timeouts ({timeoutItems.length})</span>
                </button>
              )}

              {activeTab !== 'duplicates' && (
                <button
                  disabled={selectedIds.size === 0 || rescanProgress.active}
                  onClick={() => rescanBatch(getSelectedItems())}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                  title="Re-scan selected bookmarks"
                >
                  <span className={`material-symbols-outlined text-[16px] text-primary ${rescanProgress.active ? 'animate-spin' : ''}`}>
                    refresh
                  </span>
                  <span>
                    {rescanProgress.active
                      ? `Re-scanning ${rescanProgress.completed}/${rescanProgress.total}...`
                      : `Re-scan (${selectedIds.size})`}
                  </span>
                </button>
              )}

              <button
                disabled={selectedIds.size === 0 || rescanProgress.active}
                onClick={copySelectedDebug}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                title="Copy selected URLs & diagnostics to clipboard for debugging"
              >
                <span className={`material-symbols-outlined text-[16px] ${copyFeedback ? 'text-emerald-400' : 'text-tertiary'}`}>
                  {copyFeedback ? 'check' : 'content_copy'}
                </span>
                <span>{copyFeedback ? 'Copied!' : `Copy Debug (${selectedIds.size})`}</span>
              </button>

              <button
                disabled={selectedIds.size === 0 || rescanProgress.active}
                onClick={exportSelectedJson}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                title="Download selected URLs & diagnostics as JSON"
              >
                <span className="material-symbols-outlined text-[16px] text-secondary">download</span>
                <span>Export JSON ({selectedIds.size})</span>
              </button>

              <button
                disabled={selectedIds.size === 0 || rescanProgress.active}
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-error-container text-on-error-container hover:bg-error hover:text-on-error text-[13px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-outline-variant/20 overflow-y-auto custom-scrollbar flex-1">
            {filteredList.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-16 text-outline">
                <span className="material-symbols-outlined text-[48px] opacity-50 mb-4">check_circle</span>
                <p className="text-[14px]">{emptyMessage}</p>
              </div>
            ) : (
              filteredList.map((item, index) => {
                const isSelected = selectedIds.has(item.id);
                const isRowRescanning = rescanningIds.has(item.id);
                const dupMeta = activeTab === 'duplicates' ? duplicateMetaMap.get(item.id) : null;
                const isPrimaryDuplicate = dupMeta?.copyIndex === 1;
                const isNewGroup =
                  activeTab === 'duplicates' && index > 0 && filteredList[index - 1].url !== item.url;

                const category = activeTab === 'dead'
                  ? inferBookmarkCategory(item)
                  : activeTab === 'redirects'
                    ? 'redirect-homepage'
                    : null;

                let badgeClasses;
                let badgeIcon;
                let badgeText;

                if (activeTab === 'duplicates') {
                  badgeClasses = isPrimaryDuplicate
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-surface-container border-outline-variant/30 text-tertiary';
                  badgeIcon = isPrimaryDuplicate ? 'bookmark' : 'content_copy';
                  badgeText = `Location ${dupMeta?.copyIndex || 1} of ${dupMeta?.groupTotal || 2} • ${
                    isPrimaryDuplicate ? 'Primary' : 'Duplicate'
                  }`;
                } else {
                  const meta = getDeadBadgeMeta(category);
                  badgeClasses = meta.classes;
                  badgeIcon = meta.icon;
                  badgeText =
                    activeTab === 'redirects'
                      ? item.statusText || 'Redirected to Homepage'
                      : item.statusText || 'HTTP Error / Timeout';
                }

                const resolvedFinalUrl = item.finalUrl || item.diagnostics?.finalUrl;
                const checkedIso = item.diagnostics?.checkedAt || results.timestamp;
                const durationMs = item.diagnostics?.durationMs;

                return (
                  <article
                    key={item.id}
                    className={`p-4 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group cursor-pointer ${
                      isNewGroup ? 'border-t-2 border-t-outline-variant/50' : ''
                    } ${isSelected ? 'bg-primary/5' : 'hover:bg-surface-container/60'}`}
                    onClick={(e) => {
                      if (!e.target.closest('button, a, input')) {
                        handleSelect(
                          { target: { checked: !isSelected }, nativeEvent: e.nativeEvent },
                          item.id,
                          index
                        );
                      }
                    }}
                  >
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => handleSelect(e, item.id, index)}
                        className="w-4 h-4 mt-1 rounded border-outline-variant/60 bg-surface-container-high text-primary-container focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3
                            className="text-[15px] text-on-surface font-semibold group-hover:text-primary transition-colors truncate"
                            title={item.title}
                          >
                            {item.title || '(No Title)'}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md border ${badgeClasses}`}
                          >
                            <span className="material-symbols-outlined text-[12px]">{badgeIcon}</span>
                            <span>{badgeText}</span>
                          </span>
                          {item.diagnostics?.retried && (
                            <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-surface-container border border-outline-variant/30 text-on-surface-variant">
                              Retried
                            </span>
                          )}
                        </div>

                        <p className="font-mono text-[11px] text-outline mt-1 truncate max-w-xl" title={item.url}>
                          {item.url}
                        </p>

                        {activeTab === 'redirects' && resolvedFinalUrl && (
                          <p
                            className="font-mono text-[11px] text-tertiary/90 mt-0.5 truncate max-w-xl flex items-center gap-1"
                            title={resolvedFinalUrl}
                          >
                            <span>→</span>
                            <span className="truncate">{resolvedFinalUrl}</span>
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {item.folderPath && (
                            <span className="font-mono text-[10px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/20 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px] text-outline">folder</span>
                              <span>{item.folderPath}</span>
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-outline">
                            Checked: {checkedIso ? new Date(checkedIso).toLocaleString() : 'Unknown'}
                          </span>
                          {typeof durationMs === 'number' && durationMs > 0 && (
                            <span className="font-mono text-[10px] text-outline">
                              • {durationMs} ms
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end md:self-center shrink-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-highest/60 transition-colors"
                        title="Inspect Target URL"
                      >
                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                      </a>
                      {activeTab !== 'duplicates' && (
                        <button
                          disabled={isRowRescanning || rescanProgress.active}
                          onClick={(e) => {
                            e.stopPropagation();
                            rescanSingle(item);
                          }}
                          className="p-2 rounded-lg text-outline hover:text-primary hover:bg-surface-container-highest/60 transition-colors disabled:opacity-50 cursor-pointer"
                          title="Re-scan this bookmark"
                        >
                          <span className={`material-symbols-outlined text-[18px] ${isRowRescanning ? 'animate-spin text-primary' : ''}`}>
                            refresh
                          </span>
                        </button>
                      )}
                      <button
                        disabled={rescanProgress.active}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSingle(item.id);
                        }}
                        className="p-2 rounded-lg text-outline hover:text-error hover:bg-error-container/30 transition-colors disabled:opacity-50 cursor-pointer"
                        title="Delete bookmark"
                      >
                        <span className="material-symbols-outlined text-[18px] transition-transform hover:scale-110">
                          delete
                        </span>
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-md px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-[13px] font-medium ${
            toast.tone === 'success'
              ? 'bg-emerald-950/90 border-emerald-400/40 text-emerald-100'
              : toast.tone === 'warning'
                ? 'bg-amber-950/90 border-amber-400/40 text-amber-100'
                : 'bg-surface-container-high/95 border-outline-variant/50 text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">
            {toast.tone === 'success' ? 'check_circle' : toast.tone === 'warning' ? 'warning' : 'info'}
          </span>
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
            title="Dismiss"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
