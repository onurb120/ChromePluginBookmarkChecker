import { describe, it, expect, vi } from 'vitest';
import {
  isValidBookmarkUrl,
  classifyHttpStatus,
  classifyError,
  isSoftAlive404Html,
  checkBookmarkUrl,
  buildDebugExportPayload,
  formatDebugExportForClipboard,
  BROWSER_NAVIGATION_HEADERS,
  extractBookmarksFromTree,
  findDuplicates
} from '../src/utils/bookmarkUtils.js';

describe('bookmarkUtils', () => {
  describe('isValidBookmarkUrl', () => {
    it('accepts valid http and https URLs', () => {
      expect(isValidBookmarkUrl('https://example.com')).toBe(true);
      expect(isValidBookmarkUrl('http://example.org/path?query=1#hash')).toBe(true);
    });

    it('rejects browser internal and non-http schemes', () => {
      expect(isValidBookmarkUrl('javascript:void(0)')).toBe(false);
      expect(isValidBookmarkUrl('chrome://bookmarks')).toBe(false);
      expect(isValidBookmarkUrl('chrome-extension://abcdef/popup.html')).toBe(false);
      expect(isValidBookmarkUrl('data:text/html,<h1>Hello</h1>')).toBe(false);
      expect(isValidBookmarkUrl('file:///C:/Users/test/file.txt')).toBe(false);
      expect(isValidBookmarkUrl('about:blank')).toBe(false);
    });

    it('handles null, undefined, and non-string types safely', () => {
      expect(isValidBookmarkUrl(null)).toBe(false);
      expect(isValidBookmarkUrl(undefined)).toBe(false);
      expect(isValidBookmarkUrl(12345)).toBe(false);
      expect(isValidBookmarkUrl({})).toBe(false);
    });
  });

  describe('classifyHttpStatus', () => {
    it('treats 2xx and 3xx as alive / OK', () => {
      expect(classifyHttpStatus(200)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(204)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(301)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(302)).toEqual({ isDead: false, statusText: 'OK' });
    });

    it('treats 401 and 403 as alive (protected/auth-walled)', () => {
      expect(classifyHttpStatus(401)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(403)).toEqual({ isDead: false, statusText: 'OK' });
    });

    it('marks 404 as dead with descriptive message', () => {
      expect(classifyHttpStatus(404)).toEqual({ isDead: true, statusText: 'HTTP 404 Not Found' });
    });

    it('marks 410 as dead with descriptive message', () => {
      expect(classifyHttpStatus(410)).toEqual({ isDead: true, statusText: 'HTTP 410 Gone' });
    });

    it('marks other 4xx and 5xx as dead', () => {
      expect(classifyHttpStatus(500)).toEqual({ isDead: true, statusText: 'HTTP 500' });
      expect(classifyHttpStatus(502)).toEqual({ isDead: true, statusText: 'HTTP 502' });
      expect(classifyHttpStatus(503)).toEqual({ isDead: true, statusText: 'HTTP 503' });
    });
  });

  describe('classifyError', () => {
    it('identifies timeout abort errors', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(classifyError(abortErr)).toEqual({ isDead: true, statusText: 'Timeout (12s)' });
    });

    it('identifies network and DNS errors', () => {
      const networkErr = new TypeError('Failed to fetch');
      expect(classifyError(networkErr)).toEqual({ isDead: true, statusText: 'Network / DNS Error' });
    });
  });

  describe('extractBookmarksFromTree', () => {
    it('extracts bookmarks from tree with nested subfolders and creates breadcrumb path', () => {
      const mockTree = {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          {
            id: '10',
            title: 'Google',
            url: 'https://google.com'
          },
          {
            id: '20',
            title: 'Development',
            children: [
              {
                id: '21',
                title: 'GitHub',
                url: 'https://github.com'
              }
            ]
          }
        ]
      };

      const results = extractBookmarksFromTree(mockTree);
      expect(results.length).toBe(2);

      const google = results.find(b => b.id === '10');
      expect(google).toBeDefined();
      expect(google.folderPath).toBe('Bookmarks Bar');

      const github = results.find(b => b.id === '21');
      expect(github).toBeDefined();
      expect(github.folderPath).toBe('Bookmarks Bar / Development');
    });

    it('correctly handles users with bookmarks directly under root without subfolders (v1.0.2 fix)', () => {
      const flatTree = {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '101', title: 'Site 1', url: 'https://site1.com' },
          { id: '102', title: 'Site 2', url: 'https://site2.com' }
        ]
      };

      const results = extractBookmarksFromTree(flatTree);
      expect(results.length).toBe(2);
      expect(results[0].folderPath).toBe('Bookmarks Bar');
      expect(results[1].folderPath).toBe('Bookmarks Bar');
    });

    it('filters out javascript and internal URLs', () => {
      const treeWithJunk = {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '201', title: 'Bookmarklet', url: 'javascript:alert(1)' },
          { id: '202', title: 'Chrome Settings', url: 'chrome://settings' },
          { id: '203', title: 'Real Site', url: 'https://valid.com' }
        ]
      };

      const results = extractBookmarksFromTree(treeWithJunk);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('203');
      expect(results[0].url).toBe('https://valid.com');
    });

    it('avoids visiting the same bookmark ID multiple times', () => {
      const tree = {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '301', title: 'Site', url: 'https://site.com' }
        ]
      };

      const visited = new Set(['301']);
      const results = extractBookmarksFromTree(tree, visited);
      expect(results.length).toBe(0);
    });
  });

  describe('findDuplicates', () => {
    it('returns both original and duplicate bookmark locations grouped by URL', () => {
      const sampleBookmarks = [
        { id: '1', title: 'A', url: 'https://example.com' },
        { id: '2', title: 'B', url: 'https://other.com' },
        { id: '3', title: 'A Duplicate', url: 'https://example.com' }
      ];

      const { duplicates, uniqueCount } = findDuplicates(sampleBookmarks);
      expect(duplicates.length).toBe(2);
      expect(duplicates[0]).toMatchObject({ id: '1', isOriginal: true });
      expect(duplicates[1]).toMatchObject({ id: '3', isOriginal: false });
      expect(uniqueCount).toBe(2);
    });

    it('groups multiple duplicates of the same URL together in order', () => {
      const sampleBookmarks = [
        { id: '1', title: 'A1', url: 'https://a.com' },
        { id: '2', title: 'B1', url: 'https://b.com' },
        { id: '3', title: 'A2', url: 'https://a.com' },
        { id: '4', title: 'B2', url: 'https://b.com' },
        { id: '5', title: 'A3', url: 'https://a.com' }
      ];

      const { duplicates, uniqueCount } = findDuplicates(sampleBookmarks);
      expect(duplicates.map(d => [d.id, d.isOriginal])).toEqual([
        ['1', true],
        ['3', false],
        ['5', false],
        ['2', true],
        ['4', false]
      ]);
      expect(uniqueCount).toBe(2);
    });

    it('returns empty array when there are no duplicates', () => {
      const sampleBookmarks = [
        { id: '1', title: 'A', url: 'https://example.com' },
        { id: '2', title: 'B', url: 'https://other.com' }
      ];

      const { duplicates, uniqueCount } = findDuplicates(sampleBookmarks);
      expect(duplicates.length).toBe(0);
      expect(uniqueCount).toBe(2);
    });
  });

  describe('isSoftAlive404Html', () => {
    it('detects live SPA shell with menu prices containing 404 as alive', () => {
      const html = '<!doctype html><html><head><title>orōro Sushi Bar - Menü</title></head><body><div id="root">...404 TL...</div><script src="/app.js"></script></body></html>';
      expect(isSoftAlive404Html(html)).toBe(true);
    });

    it('detects meta refresh redirect as alive', () => {
      const html = '<html><head><meta http-equiv="refresh" content="0;url=/menu"></head><body></body></html>';
      expect(isSoftAlive404Html(html)).toBe(true);
    });

    it('returns false for real 404 English and Turkish error pages', () => {
      expect(isSoftAlive404Html('<html><head><title>404 Not Found</title></head><body><div id="root"></div></body></html>')).toBe(false);
      expect(isSoftAlive404Html('<html><head><title>Site</title></head><body><div id="root"><h1>Sayfa Bulunamadı</h1></div></body></html>')).toBe(false);
      expect(isSoftAlive404Html('<html><head><title>Site</title></head><body><div id="root"><p>Hata 404: Aradığınız sayfa mevcut değil.</p></div></body></html>')).toBe(false);
      expect(isSoftAlive404Html('')).toBe(false);
    });
  });

  describe('checkBookmarkUrl', () => {
    const makeResponse = ({ ok, status, url = '', redirected = false, headers = {}, text = '' }) => ({
      ok,
      status,
      url,
      redirected,
      headers: {
        get: (name) => headers[name.toLowerCase()] ?? null
      },
      text: async () => text,
      body: {
        cancel: vi.fn().mockResolvedValue(undefined)
      }
    });

    it('falls back from HEAD 404 to GET 200 and returns alive (ororo.com.tr/menu case)', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        if (init.method === 'HEAD') {
          return makeResponse({ ok: false, status: 404, url: 'https://www.ororo.com.tr/menu' });
        }
        return makeResponse({
          ok: true,
          status: 200,
          url: 'https://www.ororo.com.tr/menu',
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      });

      const result = await checkBookmarkUrl('https://www.ororo.com.tr/menu', { fetchFn: fetchMock });

      expect(result).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(result.diagnostics).toMatchObject({
        headStatus: 404,
        headError: null,
        getStatus: 200,
        getError: null,
        finalUrl: 'https://www.ororo.com.tr/menu',
        redirected: false,
        contentType: 'text/html; charset=utf-8',
        softAlive404: false,
        usedNoCorsFallback: false
      });
      expect(typeof result.diagnostics.checkedAt).toBe('string');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
      expect(fetchMock.mock.calls[0][1].headers).toEqual(BROWSER_NAVIGATION_HEADERS);
      expect(fetchMock.mock.calls[1][1].method).toBe('GET');
      expect(fetchMock.mock.calls[1][1].headers).toEqual(BROWSER_NAVIGATION_HEADERS);
    });

    it('falls back from HEAD 500 to GET 200 and returns alive', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        if (init.method === 'HEAD') {
          return makeResponse({ ok: false, status: 500 });
        }
        return makeResponse({ ok: true, status: 200, headers: { 'content-type': 'application/pdf' } });
      });

      const result = await checkBookmarkUrl('https://example.com/pdf', { fetchFn: fetchMock });

      expect(result).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(result.diagnostics).toMatchObject({
        headStatus: 500,
        getStatus: 200,
        contentType: 'application/pdf'
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('treats a live SPA shell returned with HTTP 404 on GET as alive', async () => {
      const spaHtml = '<html><head><title>orōro Sushi Bar - Menü</title></head><body><div id="root">...404 TL...</div><script src="/app.js"></script></body></html>';
      const fetchMock = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          text: spaHtml
        })
      );

      const result = await checkBookmarkUrl('https://www.ororo.com.tr/menu', { fetchFn: fetchMock });

      expect(result).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(result.diagnostics).toMatchObject({
        headStatus: 404,
        getStatus: 404,
        softAlive404: true,
        usedNoCorsFallback: false
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('marks genuine 404 responses (English and Turkish) as dead', async () => {
      const fetchEnglish404 = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 404,
          headers: { 'content-type': 'text/html' },
          text: '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>'
        })
      );
      expect(await checkBookmarkUrl('https://example.com/missing', { fetchFn: fetchEnglish404 })).toMatchObject({
        isDead: true,
        statusText: 'HTTP 404 Not Found',
        diagnostics: {
          headStatus: 404,
          getStatus: 404,
          softAlive404: false
        }
      });

      const fetchTurkish404 = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 404,
          headers: { 'content-type': 'text/html' },
          text: '<html><head><title>Hata</title></head><body><div id="root"><h1>Sayfa Bulunamadı</h1></div></body></html>'
        })
      );
      expect(await checkBookmarkUrl('https://example.com/yok', { fetchFn: fetchTurkish404 })).toMatchObject({
        isDead: true,
        statusText: 'HTTP 404 Not Found',
        diagnostics: {
          headStatus: 404,
          getStatus: 404,
          softAlive404: false
        }
      });
    });

    it('handles timeouts as Timeout (12s) and DNS/network failures as Network / DNS Error', async () => {
      const abortFetch = vi.fn(async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const timeoutRes = await checkBookmarkUrl('https://slow.example.com', { fetchFn: abortFetch, timeoutMs: 10 });
      expect(timeoutRes).toMatchObject({
        isDead: true,
        statusText: 'Timeout (12s)',
        diagnostics: {
          headError: 'Timeout (AbortError)'
        }
      });

      const networkErrorFetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });

      const networkRes = await checkBookmarkUrl('https://nonexistent.invalid', { fetchFn: networkErrorFetch });
      expect(networkRes).toMatchObject({
        isDead: true,
        statusText: 'Network / DNS Error',
        diagnostics: {
          headError: 'Failed to fetch',
          getError: 'Failed to fetch'
        }
      });
    });

    it('treats URL as alive when CORS fails on GET but no-cors fallback succeeds', async () => {
      const corsBlockedFetch = vi.fn(async (_url, init) => {
        if (init.mode === 'no-cors') {
          return makeResponse({ ok: false, status: 0 });
        }
        throw new TypeError('Failed to fetch');
      });

      const result = await checkBookmarkUrl('https://strict-cors.example.com', { fetchFn: corsBlockedFetch });

      expect(result).toMatchObject({
        isDead: false,
        statusText: 'OK',
        diagnostics: {
          headError: 'Failed to fetch',
          getError: 'Failed to fetch',
          usedNoCorsFallback: true
        }
      });
      expect(corsBlockedFetch).toHaveBeenCalledTimes(3);
      expect(corsBlockedFetch.mock.calls[2][1].mode).toBe('no-cors');
    });
  });

  describe('buildDebugExportPayload & formatDebugExportForClipboard', () => {
    it('builds structured debug payload with diagnostics and formats Markdown + JSON for clipboard', () => {
      const sampleItems = [
        {
          id: '42',
          title: 'orōro Sushi Bar',
          url: 'https://www.ororo.com.tr/menu',
          folderPath: 'Mobil yer işaretleri / Menüler-Restaurant',
          statusText: 'HTTP 404 Not Found',
          diagnostics: {
            headStatus: 404,
            headError: null,
            getStatus: 200,
            getError: null,
            finalUrl: 'https://www.ororo.com.tr/menu',
            redirected: false,
            contentType: 'text/html',
            softAlive404: false,
            usedNoCorsFallback: false,
            checkedAt: '2026-11-15T00:00:00.000Z'
          }
        },
        {
          id: '43',
          title: '',
          url: 'https://example.com/legacy',
          statusText: ''
        }
      ];

      const payload = buildDebugExportPayload(sampleItems, {
        tab: 'dead',
        scanTimestamp: '2026-11-15T00:00:00.000Z'
      });

      expect(payload.extensionVersion).toBe('1.0.2');
      expect(payload.tab).toBe('dead');
      expect(payload.scanTimestamp).toBe('2026-11-15T00:00:00.000Z');
      expect(payload.count).toBe(2);
      expect(payload.items).toEqual([
        {
          id: '42',
          title: 'orōro Sushi Bar',
          url: 'https://www.ororo.com.tr/menu',
          folderPath: 'Mobil yer işaretleri / Menüler-Restaurant',
          statusText: 'HTTP 404 Not Found',
          diagnostics: sampleItems[0].diagnostics
        },
        {
          id: '43',
          title: '(No Title)',
          url: 'https://example.com/legacy',
          folderPath: '',
          statusText: 'HTTP Error / Timeout',
          diagnostics: null
        }
      ]);

      const formatted = formatDebugExportForClipboard(payload);
      expect(formatted).toContain('### Bookmark Checker Debug Export (2 items)');
      expect(formatted).toContain('- **Tab:** dead');
      expect(formatted).toContain('- **Last Scan:** 2026-11-15T00:00:00.000Z');
      expect(formatted).toContain('```json\n');
      expect(formatted).toContain('"headStatus": 404');
      expect(formatted).toContain('"url": "https://www.ororo.com.tr/menu"');
    });
  });
});
