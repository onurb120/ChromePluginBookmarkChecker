import { describe, it, expect } from 'vitest';
import {
  isValidBookmarkUrl,
  classifyHttpStatus,
  classifyError,
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
    it('detects duplicate bookmarks based on exact URL matches', () => {
      const sampleBookmarks = [
        { id: '1', title: 'A', url: 'https://example.com' },
        { id: '2', title: 'B', url: 'https://other.com' },
        { id: '3', title: 'A Duplicate', url: 'https://example.com' }
      ];

      const { duplicates, uniqueCount } = findDuplicates(sampleBookmarks);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].id).toBe('3');
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
});
