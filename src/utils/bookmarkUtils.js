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
 * Identifies duplicate bookmarks by URL.
 * @param {Array<{url: string}>} bookmarks 
 * @returns {{ duplicates: Array<Object>, uniqueCount: number }}
 */
export function findDuplicates(bookmarks) {
  const seenUrls = new Set();
  const duplicates = [];

  for (const bookmark of bookmarks) {
    if (seenUrls.has(bookmark.url)) {
      duplicates.push(bookmark);
    } else {
      seenUrls.add(bookmark.url);
    }
  }

  return {
    duplicates,
    uniqueCount: seenUrls.size
  };
}
