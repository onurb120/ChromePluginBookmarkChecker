import { describe, it, expect, vi } from 'vitest';
import {
  isValidBookmarkUrl,
  isLocalOrPrivateUrl,
  isHomepageRedirect,
  classifyHttpStatus,
  classifyError,
  isBotChallengeResponse,
  readResponseTextLimited,
  isSoftAlive404Html,
  checkBookmarkUrl,
  inferBookmarkCategory,
  interleaveByHostname,
  runWithConcurrencyPool,
  buildDebugExportPayload,
  formatDebugExportForClipboard,
  BROWSER_NAVIGATION_HEADERS,
  extractBookmarksFromTree,
  extractBookmarksForSelectedFolders,
  partitionBookmarksForHealthCheck,
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

  describe('isLocalOrPrivateUrl', () => {
    it('detects RFC1918, loopback, link-local, and CGNAT IPv4 addresses', () => {
      expect(isLocalOrPrivateUrl('http://192.168.1.1/')).toBe(true);
      expect(isLocalOrPrivateUrl('https://192.168.100.50:8443/admin')).toBe(true);
      expect(isLocalOrPrivateUrl('http://10.0.0.1/status')).toBe(true);
      expect(isLocalOrPrivateUrl('http://172.16.0.1/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://172.31.255.254/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://127.0.0.1:8080/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://169.254.169.254/latest/meta-data')).toBe(true);
      expect(isLocalOrPrivateUrl('http://100.64.0.1/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://100.127.255.254/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://0.0.0.0:3000/')).toBe(true);
    });

    it('does not misclassify public IPv4 boundary addresses', () => {
      expect(isLocalOrPrivateUrl('http://172.15.255.255/')).toBe(false);
      expect(isLocalOrPrivateUrl('http://172.32.0.1/')).toBe(false);
      expect(isLocalOrPrivateUrl('http://100.63.255.255/')).toBe(false);
      expect(isLocalOrPrivateUrl('http://100.128.0.1/')).toBe(false);
      expect(isLocalOrPrivateUrl('https://8.8.8.8/')).toBe(false);
      expect(isLocalOrPrivateUrl('https://1.1.1.1/')).toBe(false);
    });

    it('detects localhost, single-label intranet hosts, private TLDs, and private IPv6', () => {
      expect(isLocalOrPrivateUrl('http://localhost:5173/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://app.localhost:3000/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://router/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://nas:5000/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://printer.local/')).toBe(true);
      expect(isLocalOrPrivateUrl('https://proxmox.lan:8006/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://gateway.home.arpa/')).toBe(true);
      expect(isLocalOrPrivateUrl('https://wiki.internal/docs')).toBe(true);
      expect(isLocalOrPrivateUrl('http://[::1]:8080/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://[fd00::1]/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://[fe80::1]/')).toBe(true);
      expect(isLocalOrPrivateUrl('http://[::ffff:192.168.1.1]/')).toBe(true);
    });

    it('returns false for public domains, public IPv6, and invalid inputs', () => {
      expect(isLocalOrPrivateUrl('https://example.com/path')).toBe(false);
      expect(isLocalOrPrivateUrl('https://ari24.com/')).toBe(false);
      expect(isLocalOrPrivateUrl('https://my.local-news.org/')).toBe(false);
      expect(isLocalOrPrivateUrl('http://[::ffff:8.8.8.8]/')).toBe(false);
      expect(isLocalOrPrivateUrl('http://[2001:4860:4860::8888]/')).toBe(false);
      expect(isLocalOrPrivateUrl('not-a-url')).toBe(false);
      expect(isLocalOrPrivateUrl(null)).toBe(false);
    });
  });

  describe('isHomepageRedirect', () => {
    it('detects deep paths redirected to root or locale homepages', () => {
      expect(
        isHomepageRedirect('https://skyrfid.com/Mid-Range_RFID.php', 'https://www.skyrfid.com/')
      ).toBe(true);
      expect(
        isHomepageRedirect('https://example.com/blog/old-post', 'https://example.com/en/')
      ).toBe(true);
      expect(
        isHomepageRedirect('https://example.com/en-US/docs/guide', 'https://example.com/en-US')
      ).toBe(true);
    });

    it('returns false for non-homepage redirects and root-to-root redirects', () => {
      expect(
        isHomepageRedirect('https://example.com/old-post', 'https://example.com/new-post')
      ).toBe(false);
      expect(
        isHomepageRedirect('https://example.com/', 'https://www.example.com/')
      ).toBe(false);
      expect(
        isHomepageRedirect('https://example.com/en/', 'https://example.com/')
      ).toBe(false);
      expect(
        isHomepageRedirect('https://example.com/index.html', 'https://example.com/')
      ).toBe(false);
      expect(
        isHomepageRedirect('https://example.com/?utm_source=x', 'https://example.com/')
      ).toBe(false);
      expect(
        isHomepageRedirect('https://example.com/item/123', 'https://example.com/?err=404')
      ).toBe(false);
    });
  });

  describe('classifyHttpStatus', () => {
    it('treats 2xx and 3xx as alive / OK', () => {
      expect(classifyHttpStatus(200)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(204)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(301)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(302)).toEqual({ isDead: false, statusText: 'OK' });
    });

    it('treats 401, 403, 429, 451, and 999 as alive', () => {
      expect(classifyHttpStatus(401)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(403)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(429)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(451)).toEqual({ isDead: false, statusText: 'OK' });
      expect(classifyHttpStatus(999)).toEqual({ isDead: false, statusText: 'OK' });
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
    it('identifies timeout abort errors with dynamic timeout labels', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(classifyError(abortErr)).toEqual({ isDead: true, statusText: 'Timeout (12s)' });
      expect(classifyError(abortErr, 20000)).toEqual({ isDead: true, statusText: 'Timeout (20s)' });
      expect(classifyError(abortErr, 10)).toEqual({ isDead: true, statusText: 'Timeout (1s)' });
    });

    it('identifies network and DNS errors', () => {
      const networkErr = new TypeError('Failed to fetch');
      expect(classifyError(networkErr)).toEqual({ isDead: true, statusText: 'Network / DNS Error' });
    });
  });

  describe('isBotChallengeResponse & readResponseTextLimited', () => {
    it('detects Cloudflare challenge headers and HTML challenge pages', () => {
      expect(
        isBotChallengeResponse({
          status: 403,
          headers: { get: (n) => (n === 'cf-mitigated' ? 'challenge' : null) }
        })
      ).toBe(true);

      expect(
        isBotChallengeResponse(
          { status: 503, headers: { get: () => null } },
          '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
        )
      ).toBe(true);

      expect(
        isBotChallengeResponse(
          { status: 503, headers: { get: () => null } },
          '<html><head><title>503 Service Unavailable</title></head><body>Server down</body></html>'
        )
      ).toBe(false);

      expect(
        isBotChallengeResponse(
          { status: 500, headers: { get: () => null } },
          '<html><head><title> The URL you requested has been blocked </title></head><body><h3>Web Page Blocked!</h3><p>Attack ID: 20000018</p></body></html>'
        )
      ).toBe(true);

      expect(
        isBotChallengeResponse(
          { status: 500, headers: { get: () => null } },
          '<html><head><title>500 Internal Server Error</title></head><body>Database crash</body></html>'
        )
      ).toBe(false);
    });

    it('reads bounded bytes from ReadableStream and cancels the reader', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      let readCalls = 0;
      const chunk = new TextEncoder().encode('abcdefghij'); // 10 bytes
      const response = {
        body: {
          getReader: () => ({
            read: vi.fn(async () => {
              readCalls++;
              return { done: false, value: chunk };
            }),
            cancel
          })
        }
      };

      const text = await readResponseTextLimited(response, 15);
      expect(text).toBe('abcdefghijabcde');
      expect(readCalls).toBe(2);
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractBookmarksFromTree & extractBookmarksForSelectedFolders', () => {
    it('extracts bookmarks in natural order with nested subfolders and breadcrumb path', () => {
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
      expect(results.map((r) => r.id)).toEqual(['10', '21']);
      expect(results[0].folderPath).toBe('Bookmarks Bar');
      expect(results[1].folderPath).toBe('Bookmarks Bar / Development');
    });

    it('correctly handles users with bookmarks directly under root without subfolders', () => {
      const flatTree = {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '101', title: 'Site 1', url: 'https://site1.com' },
          { id: '102', title: 'Site 2', url: 'https://site2.com' }
        ]
      };

      const results = extractBookmarksFromTree(flatTree);
      expect(results.map((r) => r.id)).toEqual(['101', '102']);
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

    it('extracts exact folders without leaking deselected subfolders and preserves full breadcrumbs', () => {
      const fullTree = [
        {
          id: '0',
          title: '',
          children: [
            {
              id: '1',
              title: 'Bookmarks Bar',
              children: [
                { id: '10', title: 'Root Bookmark', url: 'https://root.example.com' },
                {
                  id: '20',
                  title: 'Tech',
                  children: [
                    { id: '21', title: 'Tech Item', url: 'https://tech.example.com' },
                    {
                      id: '30',
                      title: 'RFID',
                      children: [
                        { id: '31', title: 'RFID Item', url: 'https://rfid.example.com' }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: '2',
              title: 'Other Bookmarks',
              children: [{ id: '40', title: 'Other Item', url: 'https://other.example.com' }]
            }
          ]
        }
      ];

      // Exact selection on root '1' and nested '30' skips '20' and '2'
      const exactRes = extractBookmarksForSelectedFolders(fullTree, ['1', '30'], {
        exactFolderMatch: true
      });
      expect(exactRes.map((b) => [b.id, b.folderPath])).toEqual([
        ['10', 'Bookmarks Bar'],
        ['31', 'Bookmarks Bar / Tech / RFID']
      ]);

      // Subtree selection on '20' includes both '21' and nested '31'
      const subtreeRes = extractBookmarksForSelectedFolders(fullTree, ['20'], {
        exactFolderMatch: false
      });
      expect(subtreeRes.map((b) => b.id)).toEqual(['21', '31']);
    });
  });

  describe('partitionBookmarksForHealthCheck', () => {
    const mixedBookmarks = [
      { id: '1', url: 'https://example.com/' },
      { id: '2', url: 'http://192.168.1.1/' },
      { id: '3', url: 'http://10.0.0.50:8080/admin' },
      { id: '4', url: 'http://localhost:3000/' },
      { id: '5', url: 'http://abc.local/status' },
      { id: '6', url: 'https://ari24.com/' }
    ];

    it('excludes local/private URLs by default while keeping public URLs', () => {
      const { bookmarksToCheck, skippedLocalBookmarks } =
        partitionBookmarksForHealthCheck(mixedBookmarks);

      expect(bookmarksToCheck.map((b) => b.id)).toEqual(['1', '6']);
      expect(skippedLocalBookmarks.map((b) => b.id)).toEqual(['2', '3', '4', '5']);
    });

    it('includes all bookmarks when includeLocalPrivate is explicitly enabled', () => {
      const { bookmarksToCheck, skippedLocalBookmarks } =
        partitionBookmarksForHealthCheck(mixedBookmarks, { includeLocalPrivate: true });

      expect(bookmarksToCheck.map((b) => b.id)).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(skippedLocalBookmarks).toEqual([]);
    });

    it('handles empty or non-array inputs safely', () => {
      expect(partitionBookmarksForHealthCheck([])).toEqual({
        bookmarksToCheck: [],
        skippedLocalBookmarks: []
      });
      expect(partitionBookmarksForHealthCheck(null)).toEqual({
        bookmarksToCheck: [],
        skippedLocalBookmarks: []
      });
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
      expect(duplicates.map((d) => [d.id, d.isOriginal])).toEqual([
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

    it('ignores 404 text inside malformed script/comment blocks while catching visible 404s', () => {
      const spaWithMalformedScriptAndComment =
        '<html><head><title>Live App</title><script>var msg="error 404";</script ></head>' +
        '<body><!-- error 404 template --!><div id="root">Welcome</div></body></html>';
      expect(isSoftAlive404Html(spaWithMalformedScriptAndComment)).toBe(true);

      const real404AfterMalformedScript =
        '<html><head><title>App</title><script>const x=1;</script\t></head>' +
        '<body><div id="root"><p>Hata 404</p></div></body></html>';
      expect(isSoftAlive404Html(real404AfterMalformedScript)).toBe(false);
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

      expect(result).toMatchObject({ isDead: false, statusText: 'OK', category: 'alive' });
      expect(result.diagnostics).toMatchObject({
        headStatus: 404,
        headError: null,
        getStatus: 200,
        getError: null,
        finalUrl: 'https://www.ororo.com.tr/menu',
        redirected: false,
        redirectedToHomepage: false,
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

    it('falls back from HEAD timeout to GET with a separate AbortController and resolves alive', async () => {
      const signals = [];
      const fetchMock = vi.fn(async (_url, init) => {
        signals.push(init.signal);
        if (init.method === 'HEAD') {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const err = new Error('HEAD aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        expect(init.signal.aborted).toBe(false);
        return makeResponse({
          ok: true,
          status: 200,
          url: 'https://ari24.com/',
          headers: { 'content-type': 'text/html' }
        });
      });

      const result = await checkBookmarkUrl('http://ari24.com/', {
        fetchFn: fetchMock,
        headTimeoutMs: 10,
        getTimeoutMs: 500
      });

      expect(result).toMatchObject({ isDead: false, statusText: 'OK', category: 'alive' });
      expect(result.diagnostics.headError).toBe('Timeout (AbortError)');
      expect(result.diagnostics.getStatus).toBe(200);
      expect(signals.length).toBe(2);
      expect(signals[0]).not.toBe(signals[1]);
    });

    it('preserves alive verdict when HEAD returns 403 and GET times out', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        if (init.method === 'HEAD') {
          return makeResponse({ ok: false, status: 403, url: 'https://protected.example.com/page' });
        }
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('GET aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const result = await checkBookmarkUrl('https://protected.example.com/page', {
        fetchFn: fetchMock,
        headTimeoutMs: 100,
        getTimeoutMs: 15
      });

      expect(result).toMatchObject({
        isDead: false,
        statusText: 'OK',
        category: 'alive'
      });
      expect(result.diagnostics.headStatus).toBe(403);
      expect(result.diagnostics.getError).toBe('Timeout (AbortError)');
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

    it('treats Cloudflare 503 challenge responses as alive with botChallengeDetected', async () => {
      const fetchMock = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 503,
          headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
          text: '<html><head><title>Just a moment...</title></head></html>'
        })
      );

      const result = await checkBookmarkUrl('https://cf-protected.example.com/app', {
        fetchFn: fetchMock
      });

      expect(result).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(result.diagnostics.botChallengeDetected).toBe(true);
    });

    it('treats HTTP 500 WAF block pages as alive while keeping real HTTP 500 errors dead', async () => {
      const waf500Fetch = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 500,
          headers: { 'content-type': 'text/html' },
          text: '<html><head><title> The URL you requested has been blocked </title></head><body><h3>Web Page Blocked!</h3><p>Attack ID: 20000018</p></body></html>'
        })
      );

      const wafResult = await checkBookmarkUrl('https://www.reginamaria.ro/spitale/spitalul-baneasa', {
        fetchFn: waf500Fetch
      });
      expect(wafResult).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(wafResult.diagnostics.botChallengeDetected).toBe(true);

      const real500Fetch = vi.fn(async () =>
        makeResponse({
          ok: false,
          status: 500,
          headers: { 'content-type': 'text/html' },
          text: '<html><head><title>500 Internal Server Error</title></head><body>Unhandled exception</body></html>'
        })
      );

      const realResult = await checkBookmarkUrl('https://broken-app.example.com/crash', {
        fetchFn: real500Fetch
      });
      expect(realResult).toMatchObject({
        isDead: true,
        statusText: 'HTTP 500',
        category: '5xx',
        isRetryable: true
      });
      expect(realResult.diagnostics.botChallengeDetected).toBe(false);
    });

    it('marks contradictory HEAD 5xx + GET 404 responses as retryable for Pass 2', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        if (init.method === 'HEAD') {
          return makeResponse({ ok: false, status: 503, headers: { 'content-type': 'text/html' } });
        }
        return makeResponse({
          ok: false,
          status: 404,
          headers: { 'content-type': 'text/html' },
          text: '<html><head><title>404 Not Found</title></head><body>Not Found</body></html>'
        });
      });

      const result = await checkBookmarkUrl('https://cdn-flaky.example.com/page', {
        fetchFn: fetchMock
      });
      expect(result).toMatchObject({
        isDead: true,
        statusText: 'HTTP 404 Not Found',
        category: '404',
        isRetryable: true,
        diagnostics: {
          headStatus: 503,
          getStatus: 404
        }
      });
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
        category: '404',
        isRetryable: false,
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
        category: '404',
        diagnostics: {
          headStatus: 404,
          getStatus: 404,
          softAlive404: false
        }
      });
    });

    it('handles timeouts with retryable flag and DNS/network failures cleanly', async () => {
      const abortFetch = vi.fn(async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const timeoutRes = await checkBookmarkUrl('https://slow.example.com', {
        fetchFn: abortFetch,
        timeoutMs: 10
      });
      expect(timeoutRes).toMatchObject({
        isDead: true,
        statusText: 'Timeout (1s)',
        category: 'timeout',
        isRetryable: true,
        isLocalPrivate: false,
        diagnostics: {
          headError: 'Timeout (AbortError)',
          getError: 'Timeout (AbortError)'
        }
      });
      expect(abortFetch).toHaveBeenCalledTimes(2);

      const networkErrorFetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });

      const networkRes = await checkBookmarkUrl('https://nonexistent.invalid', {
        fetchFn: networkErrorFetch
      });
      expect(networkRes).toMatchObject({
        isDead: true,
        statusText: 'Network / DNS Error',
        category: 'network',
        isRetryable: true,
        diagnostics: {
          headError: 'Failed to fetch',
          getError: 'Failed to fetch'
        }
      });
    });

    it('preserves GET Network / DNS Error when no-cors fallback times out', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        if (init.mode === 'no-cors') {
          const err = new Error('no-cors aborted');
          err.name = 'AbortError';
          throw err;
        }
        throw new TypeError('Failed to fetch');
      });

      const result = await checkBookmarkUrl('https://dead-origin.example.com/', {
        fetchFn: fetchMock
      });
      expect(result).toMatchObject({
        isDead: true,
        statusText: 'Network / DNS Error',
        category: 'network',
        isRetryable: true,
        diagnostics: {
          headError: 'Failed to fetch',
          getError: 'Failed to fetch',
          noCorsError: 'Timeout (AbortError)'
        }
      });
    });

    it('supports skipHead retry mode and records attempt diagnostics', async () => {
      const fetchMock = vi.fn(async (_url, init) => {
        expect(init.method).toBe('GET');
        return makeResponse({ ok: true, status: 200, url: 'https://slow.example.com/doc' });
      });

      const result = await checkBookmarkUrl('https://slow.example.com/doc', {
        fetchFn: fetchMock,
        skipHead: true,
        attempt: 2
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ isDead: false, statusText: 'OK' });
      expect(result.diagnostics.headStatus).toBeNull();
      expect(result.diagnostics.getStatus).toBe(200);
      expect(result.diagnostics.attempts).toBe(2);
      expect(result.diagnostics.retried).toBe(true);
    });

    it('classifies unreachable and reachable local/private URLs distinctly', async () => {
      const unreachableFetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      const localUnreachable = await checkBookmarkUrl('http://192.168.1.1/', {
        fetchFn: unreachableFetch
      });
      expect(localUnreachable).toMatchObject({
        isDead: true,
        statusText: 'Local / Private (Unreachable)',
        category: 'local-private',
        isLocalPrivate: true,
        isRetryable: false
      });

      const aliveLocalFetch = vi.fn(async () =>
        makeResponse({ ok: true, status: 200, url: 'http://nas.local:5000/' })
      );
      const localAlive = await checkBookmarkUrl('http://nas.local:5000/', {
        fetchFn: aliveLocalFetch
      });
      expect(localAlive).toMatchObject({
        isDead: false,
        statusText: 'OK',
        isLocalPrivate: true
      });
      expect(localAlive.diagnostics.isLocalPrivate).toBe(true);
    });

    it('marks deep URLs redirected to homepage as alive with redirect-homepage category', async () => {
      const fetchMock = vi.fn(async () =>
        makeResponse({
          ok: true,
          status: 200,
          url: 'https://www.skyrfid.com/',
          redirected: true
        })
      );

      const result = await checkBookmarkUrl('https://skyrfid.com/Mid-Range_RFID.php', {
        fetchFn: fetchMock
      });

      expect(result).toMatchObject({
        isDead: false,
        statusText: 'OK',
        category: 'redirect-homepage',
        redirectedToHomepage: true
      });
      expect(result.diagnostics.redirectedToHomepage).toBe(true);
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

  describe('inferBookmarkCategory', () => {
    it('uses explicit category when valid and infers accurately for legacy items', () => {
      expect(inferBookmarkCategory({ category: 'timeout', statusText: 'Timeout (12s)' })).toBe('timeout');
      expect(inferBookmarkCategory({ statusText: 'Timeout (12s)', url: 'https://example.com' })).toBe('timeout');
      expect(inferBookmarkCategory({ statusText: 'HTTP 404 Not Found', url: 'http://192.168.1.1/missing' })).toBe('404');
      expect(inferBookmarkCategory({ statusText: 'Network / DNS Error', url: 'http://192.168.1.1/' })).toBe('local-private');
      expect(inferBookmarkCategory({ statusText: 'HTTP 502', url: 'https://example.com' })).toBe('5xx');
      expect(inferBookmarkCategory({ statusText: 'Network / DNS Error', url: 'https://dead.invalid' })).toBe('network');
    });
  });

  describe('interleaveByHostname & runWithConcurrencyPool', () => {
    it('interleaves repeated hostnames round-robin', () => {
      const items = [
        { url: 'https://a.com/1' },
        { url: 'https://a.com/2' },
        { url: 'https://a.com/3' },
        { url: 'https://b.com/1' },
        { url: 'https://b.com/2' },
        { url: 'https://c.com/1' }
      ];

      const interleaved = interleaveByHostname(items);
      expect(interleaved.map((i) => i.url)).toEqual([
        'https://a.com/1',
        'https://b.com/1',
        'https://c.com/1',
        'https://a.com/2',
        'https://b.com/2',
        'https://a.com/3'
      ]);
    });

    it('enforces concurrency, maxPerHost, and cooperative cancellation', async () => {
      const items = [
        { id: 1, url: 'https://same.com/1' },
        { id: 2, url: 'https://same.com/2' },
        { id: 3, url: 'https://same.com/3' },
        { id: 4, url: 'https://other.com/1' },
        { id: 5, url: 'https://third.com/1' }
      ];

      let activeTotal = 0;
      let maxTotalObserved = 0;
      const activePerHost = new Map();
      let maxSameHostObserved = 0;

      const results = await runWithConcurrencyPool(
        items,
        async (item) => {
          const host = new URL(item.url).hostname;
          activeTotal++;
          maxTotalObserved = Math.max(maxTotalObserved, activeTotal);
          const hostInFlight = (activePerHost.get(host) || 0) + 1;
          activePerHost.set(host, hostInFlight);
          if (host === 'same.com') {
            maxSameHostObserved = Math.max(maxSameHostObserved, hostInFlight);
          }

          await new Promise((r) => setTimeout(r, 10));

          activeTotal--;
          activePerHost.set(host, activePerHost.get(host) - 1);
          return item.id;
        },
        { concurrency: 3, maxPerHost: 1 }
      );

      expect(results).toEqual([1, 2, 3, 4, 5]);
      expect(maxTotalObserved).toBeLessThanOrEqual(3);
      expect(maxSameHostObserved).toBe(1);

      // Verify cancellation stops launching remaining items
      let cancelled = false;
      const executed = [];
      await runWithConcurrencyPool(
        items,
        async (item) => {
          executed.push(item.id);
          cancelled = true;
          await new Promise((r) => setTimeout(r, 5));
          return item.id;
        },
        { concurrency: 1, maxPerHost: 1, shouldCancel: () => cancelled }
      );
      expect(executed).toEqual([1]);
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

      expect(payload.extensionVersion).toBe('1.1.0');
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
