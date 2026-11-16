/**
 * Bookmark Checker Utility Functions
 */

/**
 * Checks if a bookmark URL is a valid web URL (http or https)
 * Filters out internal browser schemes like javascript:, chrome://, data:, file:
 * @param {string} url 
 * @returns {boolean}
 */
export function isValidBookmarkUrl(url) {
  if (typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Classifies an HTTP response status code for bookmark health.
 * 200-399: OK / Redirect
 * 401, 403: Alive (Protected / Login Required, not a broken link!)
 * 404: Dead (Not Found)
 * 410: Dead (Gone)
 * Others (>= 400): Dead
 * @param {number} status 
 * @returns {{ isDead: boolean, statusText: string }}
 */
export function classifyHttpStatus(status) {
  if ((status >= 200 && status < 400) || status === 401 || status === 403) {
    return { isDead: false, statusText: 'OK' };
  }
  if (status === 404) {
    return { isDead: true, statusText: 'HTTP 404 Not Found' };
  }
  if (status === 410) {
    return { isDead: true, statusText: 'HTTP 410 Gone' };
  }
  return { isDead: true, statusText: `HTTP ${status}` };
}

/**
 * Classifies network / timeout errors from fetch attempts.
 * @param {Error} error 
 * @returns {{ isDead: boolean, statusText: string }}
 */
export function classifyError(error) {
  if (error && error.name === 'AbortError') {
    return { isDead: true, statusText: 'Timeout (12s)' };
  }
  return { isDead: true, statusText: 'Network / DNS Error' };
}

/**
 * Browser-like navigation headers so SPAs and reverse proxies serve HTML
 * rather than treating route requests like `/menu` as missing assets.
 */
export const BROWSER_NAVIGATION_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
};

const NOT_FOUND_HEADING_REGEX =
  /\b404\b|not\s+found|page\s+not\s+found|sayfa\s+bulunamad[ıi]|bulunamad[ıi]|error\s+404|hata\s+404|arad[ıi][ğg][ıi]n[ıi]z\s+sayfa|mevcut\s+de[ğg]il|ula[şs][ıi]lam[ıi]yor|cannot\s+be\s+found|does\s+not\s+exist/i;

const NOT_FOUND_BODY_REGEX =
  /(?:error|http|hata|status|code)\s*404\b|\b404\s*(?:error|not\s+found|hata|sayfa|page)|page\s+not\s+found|sayfa\s+bulunamad[ıi]|arad[ıi][ğg][ıi]n[ıi]z\s+sayfa|the\s+requested\s+url\s+was\s+not\s+found|cannot\s+be\s+found|does\s+not\s+exist/i;

const SPA_MOUNT_REGEX =
  /id=["'](?:root|app|__next|__nuxt|svelte)["']|<app-root\b|data-reactroot\b|ng-version=/i;

/**
 * Strips HTML tags and normalizes whitespace in a fragment.
 * @param {string} fragment
 * @returns {string}
 */
function stripHtmlTags(fragment) {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Detects whether an HTML body returned with HTTP 404 is actually a live SPA
 * shell or client-side redirect rather than a genuine "Not Found" error page.
 * @param {string} html
 * @returns {boolean}
 */
export function isSoftAlive404Html(html) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    return false;
  }

  if (/<meta[^>]+http-equiv=["']?refresh["']?/i.test(html)) {
    return true;
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

  if (titleText && NOT_FOUND_HEADING_REGEX.test(titleText)) {
    return false;
  }

  const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  for (const match of headingMatches) {
    const headingText = stripHtmlTags(match[1]);
    if (headingText && NOT_FOUND_HEADING_REGEX.test(headingText)) {
      return false;
    }
  }

  const visibleText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (visibleText && NOT_FOUND_BODY_REGEX.test(visibleText)) {
    return false;
  }

  if (!titleText) {
    return false;
  }

  if (SPA_MOUNT_REGEX.test(html)) {
    return true;
  }

  const hasSemanticLayout = /<(?:nav|main|header|footer)\b/i.test(html);
  const hasAssets = /<(?:script|link)\b/i.test(html);
  return hasSemanticLayout && hasAssets && html.length > 500;
}

/**
 * Checks whether a bookmark URL is reachable using HEAD with an unconditional
 * GET fallback on non-OK statuses/errors, SPA soft-404 inspection, and a
 * `no-cors` fallback for strict CORS header blocks.
 * @param {string} url
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ isDead: boolean, statusText: string, diagnostics: Object }>}
 */
export async function checkBookmarkUrl(url, options = {}) {
  const { fetchFn = fetch, timeoutMs = 12000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const diagnostics = {
    headStatus: null,
    headError: null,
    getStatus: null,
    getError: null,
    finalUrl: null,
    redirected: false,
    contentType: null,
    softAlive404: false,
    usedNoCorsFallback: false,
    checkedAt: new Date().toISOString()
  };

  const requestInit = (method) => ({
    method,
    headers: BROWSER_NAVIGATION_HEADERS,
    signal: controller.signal,
    redirect: 'follow',
    cache: 'no-store'
  });

  const formatFetchError = (err) =>
    err?.name === 'AbortError' ? 'Timeout (AbortError)' : (err?.message || String(err));

  const recordResponseDiagnostics = (res, method) => {
    if (method === 'HEAD') {
      diagnostics.headStatus = res.status;
    } else {
      diagnostics.getStatus = res.status;
    }
    diagnostics.finalUrl = res.url || diagnostics.finalUrl || url;
    diagnostics.redirected = Boolean(res.redirected || diagnostics.redirected);
    diagnostics.contentType = res.headers?.get?.('content-type') || diagnostics.contentType || null;
  };

  const runGetFallback = async () => {
    try {
      const getRes = await fetchFn(url, requestInit('GET'));
      recordResponseDiagnostics(getRes, 'GET');
      return getRes;
    } catch (getErr) {
      diagnostics.getError = formatFetchError(getErr);
      throw getErr;
    }
  };

  try {
    let response;
    try {
      response = await fetchFn(url, requestInit('HEAD'));
      recordResponseDiagnostics(response, 'HEAD');
      if (!response.ok) {
        response.body?.cancel?.().catch(() => {});
        response = await runGetFallback();
      }
    } catch (headErr) {
      diagnostics.headError = formatFetchError(headErr);
      if (!controller.signal.aborted && headErr?.name !== 'AbortError') {
        response = await runGetFallback();
      } else {
        throw headErr;
      }
    }

    if (response.status === 404) {
      const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType || contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        try {
          const html = await response.text();
          if (isSoftAlive404Html(html)) {
            diagnostics.softAlive404 = true;
            return { isDead: false, statusText: 'OK', diagnostics };
          }
        } catch {
          // Ignore body read error and fall back to HTTP status classification
        }
      }
    }

    response.body?.cancel?.().catch(() => {});
    return { ...classifyHttpStatus(response.status), diagnostics };
  } catch (error) {
    if (!controller.signal.aborted && error?.name !== 'AbortError') {
      try {
        const opaqueRes = await fetchFn(url, {
          method: 'GET',
          mode: 'no-cors',
          signal: controller.signal,
          redirect: 'follow',
          cache: 'no-store'
        });
        opaqueRes?.body?.cancel?.().catch(() => {});
        diagnostics.usedNoCorsFallback = true;
        return { isDead: false, statusText: 'OK', diagnostics };
      } catch (fallbackErr) {
        if (controller.signal.aborted || fallbackErr?.name === 'AbortError') {
          return { ...classifyError(fallbackErr), diagnostics };
        }
      }
    }
    return { ...classifyError(error), diagnostics };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Builds a structured debug export payload for selected bookmarks.
 * @param {Array<Object>} items
 * @param {{ tab?: string, scanTimestamp?: string|null, extensionVersion?: string }} [options]
 * @returns {Object}
 */
export function buildDebugExportPayload(items, { tab = 'dead', scanTimestamp = null, extensionVersion = '1.0.2' } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  return {
    exportedAt: new Date().toISOString(),
    extensionVersion,
    tab,
    scanTimestamp,
    count: safeItems.length,
    items: safeItems.map((item) => ({
      id: item.id,
      title: item.title || '(No Title)',
      url: item.url,
      folderPath: item.folderPath || '',
      statusText: item.statusText || (tab === 'dead' ? 'HTTP Error / Timeout' : 'Duplicate URL'),
      diagnostics: item.diagnostics || null
    }))
  };
}

/**
 * Formats a debug export payload as a Markdown + JSON snippet ready to paste in chat.
 * @param {Object} payload
 * @returns {string}
 */
export function formatDebugExportForClipboard(payload) {
  return [
    `### Bookmark Checker Debug Export (${payload.count} item${payload.count === 1 ? '' : 's'})`,
    `- **Exported At:** ${payload.exportedAt}`,
    `- **Tab:** ${payload.tab}`,
    `- **Last Scan:** ${payload.scanTimestamp || 'Unknown'}`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```'
  ].join('\n');
}

/**
 * Traverses a bookmark tree node or list of nodes to extract all valid bookmarks
 * with their folder hierarchy path.
 * Handles cases with subfolders and root-only bookmarks without subfolders.
 * @param {Array<Object>|Object} rootNodes 
 * @param {Set<string>} [visitedIds]
 * @returns {Array<Object>}
 */
export function extractBookmarksFromTree(rootNodes, visitedIds = new Set()) {
  const allBookmarks = [];
  const nodes = Array.isArray(rootNodes) ? rootNodes : [rootNodes];

  for (const root of nodes) {
    if (!root) continue;
    const stack = [{ node: root, path: root.title || '' }];

    while (stack.length > 0) {
      const { node, path } = stack.pop();

      if (node.url && !visitedIds.has(node.id)) {
        if (isValidBookmarkUrl(node.url)) {
          visitedIds.add(node.id);
          allBookmarks.push({ ...node, folderPath: path });
        }
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => {
          const childPath = child.children
            ? (path ? `${path} / ${child.title}` : child.title)
            : path;
          stack.push({ node: child, path: childPath });
        });
      }
    }
  }

  return allBookmarks;
}

/**
 * Identifies duplicate bookmarks by URL, returning all locations grouped by URL.
 * @param {Array<{url: string}>} bookmarks 
 * @returns {{ duplicates: Array<Object>, uniqueCount: number }}
 */
export function findDuplicates(bookmarks) {
  const groups = new Map();

  for (const bookmark of bookmarks) {
    if (!groups.has(bookmark.url)) {
      groups.set(bookmark.url, []);
    }
    groups.get(bookmark.url).push(bookmark);
  }

  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      group.forEach((bm, idx) => {
        duplicates.push({
          ...bm,
          isOriginal: idx === 0
        });
      });
    }
  }

  return {
    duplicates,
    uniqueCount: groups.size
  };
}
