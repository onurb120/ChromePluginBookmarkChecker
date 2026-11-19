/**
 * Bookmark Checker Utility Functions
 */

const PRIVATE_TLDS = [
  '.local',
  '.lan',
  '.home',
  '.home.arpa',
  '.internal',
  '.intranet',
  '.localdomain',
  '.corp',
  '.priv',
  '.box'
];

const NON_DEEP_PATH_REGEX =
  /^(?:index\.(?:html?|php|aspx?)|home|default\.aspx?|[a-z]{2}(?:-[a-z]{2})?)$/i;
const LOCALE_HOME_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;

const BOT_CHALLENGE_TITLE_REGEX =
  /<title[^>]*>\s*(?:just a moment|attention required!?\s*\|\s*cloudflare|ddos-guard|checking your browser)/i;
const BOT_CHALLENGE_MARKER_REGEX =
  /cf-browser-verification|\/cdn-cgi\/challenge-platform/i;

const VALID_CATEGORIES = new Set([
  '404',
  'network',
  'timeout',
  '5xx',
  'other-http',
  'local-private',
  'redirect-homepage'
]);

/**
 * Builds an Accept-Language header derived from the local browser locale
 * while falling back cleanly in non-browser runtimes.
 * @returns {string}
 */
function buildAcceptLanguageHeader() {
  const rawLang = typeof globalThis !== 'undefined' ? globalThis.navigator?.language : '';
  if (!rawLang || typeof rawLang !== 'string') {
    return 'en-US,en;q=0.9';
  }
  const lang = rawLang.trim();
  if (!lang) {
    return 'en-US,en;q=0.9';
  }

  const parts = [];
  const seen = new Set();
  const add = (tag, q) => {
    const lower = tag.toLowerCase();
    if (!lower || seen.has(lower)) return;
    seen.add(lower);
    parts.push(q !== undefined ? `${tag};q=${q}` : tag);
  };

  add(lang);
  const base = lang.split('-')[0];
  if (base && base.toLowerCase() !== lang.toLowerCase()) {
    add(base, '0.9');
  }
  add('en-US', '0.8');
  add('en', '0.7');

  return parts.join(',');
}

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
 * Checks whether an IPv4 dotted-quad string falls inside a loopback, private,
 * link-local, or CGNAT address range.
 * Returns null if the string is not a valid dotted-quad IPv4 address.
 * @param {string} host
 * @returns {boolean|null}
 */
function classifyIPv4Host(host) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;

  const octets = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4])
  ];
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return null;
  }

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / Tailscale)
  return false;
}

/**
 * Checks whether a URL targets localhost, a private/RFC1918/CGNAT IP,
 * a link-local address, a single-label intranet host, or a local/private TLD.
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalOrPrivateUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }
    const zoneIdx = host.indexOf('%');
    if (zoneIdx !== -1) {
      host = host.slice(0, zoneIdx);
    }
    if (!host) return false;

    if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
      return true;
    }

    const ipv4Result = classifyIPv4Host(host);
    if (ipv4Result !== null) {
      return ipv4Result;
    }

    if (host.includes(':')) {
      if (
        host === '::1' ||
        host === '::' ||
        host === '0:0:0:0:0:0:0:1' ||
        host === '0:0:0:0:0:0:0:0'
      ) {
        return true;
      }

      const mappedDotted = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
      if (mappedDotted) {
        return Boolean(classifyIPv4Host(mappedDotted[1]));
      }

      const mappedHex = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return Boolean(classifyIPv4Host(ipv4));
      }

      if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
        return true;
      }

      return false;
    }

    if (!host.includes('.')) {
      return true;
    }

    return PRIVATE_TLDS.some((tld) => host.endsWith(tld));
  } catch {
    return false;
  }
}

/**
 * Detects whether a deep bookmark path redirected to a site's root or locale homepage.
 * @param {string} originalUrl
 * @param {string} finalUrl
 * @returns {boolean}
 */
export function isHomepageRedirect(originalUrl, finalUrl) {
  if (!originalUrl || !finalUrl) return false;
  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    const origPath = orig.pathname.replace(/^\/+|\/+$/g, '');
    const finalPath = final.pathname.replace(/^\/+|\/+$/g, '');

    if (!origPath || NON_DEEP_PATH_REGEX.test(origPath)) {
      return false;
    }

    return final.search === '' && (finalPath === '' || LOCALE_HOME_REGEX.test(finalPath));
  } catch {
    return false;
  }
}

/**
 * Classifies an HTTP response status code for bookmark health.
 * 200-399: OK / Redirect
 * 401, 403, 429, 451, 999: Alive (Protected, rate-limited, geo-blocked, or bot-walled)
 * 404: Dead (Not Found)
 * 410: Dead (Gone)
 * Others (>= 400): Dead
 * @param {number} status
 * @returns {{ isDead: boolean, statusText: string }}
 */
export function classifyHttpStatus(status) {
  if (
    (status >= 200 && status < 400) ||
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status === 451 ||
    status === 999
  ) {
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
 * @param {number} [timeoutMs=12000]
 * @returns {{ isDead: boolean, statusText: string }}
 */
export function classifyError(error, timeoutMs = 12000) {
  if (error && error.name === 'AbortError') {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return { isDead: true, statusText: `Timeout (${seconds}s)` };
  }
  return { isDead: true, statusText: 'Network / DNS Error' };
}

/**
 * Detects whether a response is a WAF / Cloudflare / DDoS bot challenge rather than an outage.
 * @param {Response|Object} response
 * @param {string} [html='']
 * @returns {boolean}
 */
export function isBotChallengeResponse(response, html = '') {
  const cfMitigated = response?.headers?.get?.('cf-mitigated')?.toLowerCase?.() || '';
  if (cfMitigated === 'challenge') {
    return true;
  }
  const status = response?.status;
  if ((status === 503 || status === 403) && typeof html === 'string' && html.length > 0) {
    return BOT_CHALLENGE_TITLE_REGEX.test(html) || BOT_CHALLENGE_MARKER_REGEX.test(html);
  }
  return false;
}

/**
 * Reads at most `maxBytes` from a response body stream to avoid buffering huge payloads.
 * Falls back to `response.text()` when `response.body.getReader` is unavailable (e.g. mocks).
 * @param {Response|Object} response
 * @param {number} [maxBytes=65536]
 * @returns {Promise<string>}
 */
export async function readResponseTextLimited(response, maxBytes = 65536) {
  if (!response) return '';
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (totalBytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const remaining = maxBytes - totalBytes;
        if (value.byteLength > remaining) {
          chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
          totalBytes += remaining;
          break;
        }
        chunks.push(decoder.decode(value, { stream: true }));
        totalBytes += value.byteLength;
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  if (typeof response.text === 'function') {
    const text = await response.text();
    return typeof text === 'string' ? text.slice(0, maxBytes) : '';
  }

  return '';
}

/**
 * Browser-like navigation headers so SPAs and reverse proxies serve HTML
 * rather than treating route requests like `/menu` as missing assets.
 */
export const BROWSER_NAVIGATION_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': buildAcceptLanguageHeader()
};

const NOT_FOUND_HEADING_REGEX =
  /\b404\b|not\s+found|page\s+not\s+found|sayfa\s+bulunamad[ıi]|bulunamad[ıi]|error\s+404|hata\s+404|arad[ıi][ğg][ıi]n[ıi]z\s+sayfa|mevcut\s+de[ğg]il|ula[şs][ıi]lam[ıi]yor|cannot\s+be\s+found|does\s+not\s+exist/i;

const NOT_FOUND_BODY_REGEX =
  /(?:error|http|hata|status|code)\s*404\b|\b404\s*(?:error|not\s+found|hata|sayfa|page)|page\s+not\s+found|sayfa\s+bulunamad[ıi]|arad[ıi][ğg][ıi]n[ıi]z\s+sayfa|the\s+requested\s+url\s+was\s+not\s+found|cannot\s+be\s+found|does\s+not\s+exist/i;

const SPA_MOUNT_REGEX =
  /id=["'](?:root|app|__next|__nuxt|svelte)["']|<app-root\b|data-reactroot\b|ng-version=/i;

function isTagBoundaryChar(ch) {
  return !ch || ch === '>' || ch === '/' || /\s/.test(ch);
}

/**
 * Removes `<tagName>...</tagName>` blocks via linear string scanning (handles
 * malformed end tags such as `</script >`).
 * @param {string} input
 * @param {string} tagName
 * @returns {string}
 */
function stripHtmlTagBlock(input, tagName) {
  if (typeof input !== 'string' || !input) return '';
  const lower = input.toLowerCase();
  const openToken = `<${tagName.toLowerCase()}`;
  const closeToken = `</${tagName.toLowerCase()}`;
  let out = '';
  let cursor = 0;

  while (cursor < input.length) {
    const openIdx = lower.indexOf(openToken, cursor);
    if (openIdx === -1) {
      out += input.slice(cursor);
      break;
    }

    const afterOpenChar = lower[openIdx + openToken.length];
    if (!isTagBoundaryChar(afterOpenChar)) {
      out += input.slice(cursor, openIdx + openToken.length);
      cursor = openIdx + openToken.length;
      continue;
    }

    const openTagEnd = input.indexOf('>', openIdx + openToken.length);
    if (openTagEnd === -1) {
      out += input.slice(cursor);
      break;
    }

    out += input.slice(cursor, openIdx);

    if (input[openTagEnd - 1] === '/') {
      out += ' ';
      cursor = openTagEnd + 1;
      continue;
    }

    let searchPos = openTagEnd + 1;
    let closeEnd = -1;
    while (searchPos < input.length) {
      const closeIdx = lower.indexOf(closeToken, searchPos);
      if (closeIdx === -1) break;
      const afterCloseChar = lower[closeIdx + closeToken.length];
      if (!afterCloseChar || afterCloseChar === '>' || /\s/.test(afterCloseChar)) {
        const endAngle = input.indexOf('>', closeIdx + closeToken.length);
        if (endAngle !== -1) {
          closeEnd = endAngle + 1;
        }
        break;
      }
      searchPos = closeIdx + closeToken.length;
    }

    if (closeEnd === -1) {
      out += ' ';
      break;
    }

    out += ' ';
    cursor = closeEnd;
  }

  return out;
}

/**
 * Removes HTML comments (`<!-- ... -->` and `<!-- ... --!>`) via linear scan.
 * @param {string} input
 * @returns {string}
 */
function stripHtmlComments(input) {
  if (typeof input !== 'string' || !input) return '';
  let out = '';
  let cursor = 0;

  while (cursor < input.length) {
    const startIdx = input.indexOf('<!--', cursor);
    if (startIdx === -1) {
      out += input.slice(cursor);
      break;
    }

    out += input.slice(cursor, startIdx);
    const endNormal = input.indexOf('-->', startIdx + 4);
    const endBang = input.indexOf('--!>', startIdx + 4);

    let endIdx = -1;
    let endLen = 0;
    if (endNormal !== -1 && (endBang === -1 || endNormal < endBang)) {
      endIdx = endNormal;
      endLen = 3;
    } else if (endBang !== -1) {
      endIdx = endBang;
      endLen = 4;
    }

    if (endIdx === -1) {
      out += ' ';
      break;
    }

    out += ' ';
    cursor = endIdx + endLen;
  }

  return out;
}

/**
 * Strips HTML tags and normalizes whitespace in a fragment without tag-filtering regexes.
 * @param {string} fragment
 * @returns {string}
 */
function stripHtmlTags(fragment) {
  if (typeof fragment !== 'string' || !fragment) return '';
  let out = '';
  let inTag = false;

  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (ch === '<') {
      if (!inTag) {
        out += ' ';
        inTag = true;
      }
    } else if (ch === '>') {
      if (inTag) {
        inTag = false;
        out += ' ';
      } else {
        out += ch;
      }
    } else if (!inTag) {
      out += ch;
    }
  }

  return out.replace(/\s+/g, ' ').trim();
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

  const withoutHiddenBlocks = stripHtmlComments(
    stripHtmlTagBlock(stripHtmlTagBlock(stripHtmlTagBlock(html, 'script'), 'style'), 'svg')
  );
  const visibleText = stripHtmlTags(withoutHiddenBlocks);

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
 * Runs an async operation with its own isolated AbortController timeout.
 * @template T
 * @param {number} ms
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithAbortTimeout(ms, fn) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Checks whether a bookmark URL is reachable using independent timeout budgets for
 * HEAD, GET fallback (including on HEAD timeout), SPA soft-404 and bot-challenge
 * inspection, local/private URL classification, homepage-redirect detection, and a
 * `no-cors` fallback for strict CORS header blocks.
 * @param {string} url
 * @param {{
 *   fetchFn?: typeof fetch,
 *   timeoutMs?: number,
 *   headTimeoutMs?: number,
 *   getTimeoutMs?: number,
 *   noCorsTimeoutMs?: number,
 *   skipHead?: boolean,
 *   attempt?: number
 * }} [options]
 * @returns {Promise<{
 *   isDead: boolean,
 *   statusText: string,
 *   category: string,
 *   isLocalPrivate: boolean,
 *   redirectedToHomepage: boolean,
 *   isRetryable: boolean,
 *   diagnostics: Object
 * }>}
 */
export async function checkBookmarkUrl(url, options = {}) {
  const {
    fetchFn = fetch,
    timeoutMs,
    headTimeoutMs,
    getTimeoutMs,
    noCorsTimeoutMs,
    skipHead = false,
    attempt = 1
  } = options;

  const isLocal = isLocalOrPrivateUrl(url);
  const resolvedHeadTimeout = headTimeoutMs ?? timeoutMs ?? (isLocal ? 4000 : 7000);
  const resolvedGetTimeout = getTimeoutMs ?? timeoutMs ?? (isLocal ? 5000 : 12000);
  const resolvedNoCorsTimeout = noCorsTimeoutMs ?? timeoutMs ?? (isLocal ? 4000 : 6000);

  const startTime = Date.now();
  const diagnostics = {
    headStatus: null,
    headError: null,
    headDurationMs: null,
    getStatus: null,
    getError: null,
    getDurationMs: null,
    durationMs: 0,
    finalUrl: null,
    redirected: false,
    redirectedToHomepage: false,
    contentType: null,
    softAlive404: false,
    botChallengeDetected: false,
    usedNoCorsFallback: false,
    noCorsError: null,
    isLocalPrivate: isLocal,
    attempts: attempt,
    retried: attempt > 1,
    checkedAt: new Date().toISOString()
  };

  const requestInit = (method, signal) => ({
    method,
    headers: BROWSER_NAVIGATION_HEADERS,
    signal,
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

  const finishAlive = (overrideCategory = null) => {
    const redirectedToHomepage = overrideCategory === 'alive'
      ? false
      : isHomepageRedirect(url, diagnostics.finalUrl);
    diagnostics.redirectedToHomepage = redirectedToHomepage;
    diagnostics.durationMs = Date.now() - startTime;
    return {
      isDead: false,
      statusText: 'OK',
      category: overrideCategory || (redirectedToHomepage ? 'redirect-homepage' : 'alive'),
      isLocalPrivate: isLocal,
      redirectedToHomepage,
      isRetryable: false,
      diagnostics
    };
  };

  // Step A: HEAD probe (with its own AbortController)
  let headAliveStatus = null;
  if (!skipHead) {
    const headStart = Date.now();
    try {
      const headRes = await runWithAbortTimeout(resolvedHeadTimeout, async (signal) => {
        const res = await fetchFn(url, requestInit('HEAD', signal));
        recordResponseDiagnostics(res, 'HEAD');
        res.body?.cancel?.().catch(() => {});
        return res;
      });
      diagnostics.headDurationMs = Date.now() - headStart;

      if (headRes.ok) {
        return finishAlive();
      }
      if (!classifyHttpStatus(headRes.status).isDead) {
        headAliveStatus = headRes.status;
      }
    } catch (headErr) {
      diagnostics.headDurationMs = Date.now() - headStart;
      diagnostics.headError = formatFetchError(headErr);
    }
  }

  // Step B: GET fallback (always runs after non-OK HEAD, HEAD error, or HEAD timeout)
  let lastError = null;
  let getWasAborted = false;
  const getStart = Date.now();

  try {
    const getOutcome = await runWithAbortTimeout(resolvedGetTimeout, async (signal) => {
      const res = await fetchFn(url, requestInit('GET', signal));
      recordResponseDiagnostics(res, 'GET');

      const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
      const isHtmlLike =
        !contentType ||
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml+xml');

      if (res.status === 404 && isHtmlLike) {
        try {
          const html = await readResponseTextLimited(res);
          if (isSoftAlive404Html(html)) {
            diagnostics.softAlive404 = true;
            return { kind: 'alive' };
          }
        } catch {
          // Ignore body read error and fall back to HTTP status classification
        }
      } else if (res.status === 503) {
        if (isBotChallengeResponse(res)) {
          res.body?.cancel?.().catch(() => {});
          diagnostics.botChallengeDetected = true;
          return { kind: 'alive' };
        }
        if (isHtmlLike) {
          try {
            const html = await readResponseTextLimited(res);
            if (isBotChallengeResponse(res, html)) {
              diagnostics.botChallengeDetected = true;
              return { kind: 'alive' };
            }
          } catch {
            // Ignore body read error and fall back to HTTP status classification
          }
        }
      }

      res.body?.cancel?.().catch(() => {});
      return { kind: 'status', status: res.status };
    });

    diagnostics.getDurationMs = Date.now() - getStart;

    if (getOutcome.kind === 'alive') {
      return finishAlive();
    }

    const classified = classifyHttpStatus(getOutcome.status);
    if (!classified.isDead) {
      return finishAlive();
    }

    const status = getOutcome.status;
    const category = (status === 404 || status === 410)
      ? '404'
      : (status >= 500 && status < 600)
        ? '5xx'
        : 'other-http';
    const isRetryable = !isLocal && status >= 500 && status < 600;

    diagnostics.durationMs = Date.now() - startTime;
    return {
      isDead: true,
      statusText: classified.statusText,
      category,
      isLocalPrivate: isLocal,
      redirectedToHomepage: false,
      isRetryable,
      diagnostics
    };
  } catch (getErr) {
    diagnostics.getDurationMs = Date.now() - getStart;
    diagnostics.getError = formatFetchError(getErr);
    lastError = getErr;
    getWasAborted = getErr?.name === 'AbortError';

    if (headAliveStatus !== null) {
      return finishAlive('alive');
    }
  }

  // Step C: no-cors fallback (only when GET failed without aborting)
  if (!getWasAborted) {
    try {
      await runWithAbortTimeout(resolvedNoCorsTimeout, async (signal) => {
        const opaqueRes = await fetchFn(url, {
          method: 'GET',
          mode: 'no-cors',
          signal,
          redirect: 'follow',
          cache: 'no-store'
        });
        opaqueRes?.body?.cancel?.().catch(() => {});
      });
      diagnostics.usedNoCorsFallback = true;
      return finishAlive('alive');
    } catch (noCorsErr) {
      diagnostics.noCorsError = formatFetchError(noCorsErr);
      if (noCorsErr?.name === 'AbortError') {
        lastError = noCorsErr;
      }
    }
  }

  const isTimeout = lastError?.name === 'AbortError';
  diagnostics.durationMs = Date.now() - startTime;

  if (isLocal) {
    const localSeconds = Math.max(1, Math.round(resolvedGetTimeout / 1000));
    return {
      isDead: true,
      statusText: isTimeout
        ? `Local / Private (Timeout ${localSeconds}s)`
        : 'Local / Private (Unreachable)',
      category: 'local-private',
      isLocalPrivate: true,
      redirectedToHomepage: false,
      isRetryable: false,
      diagnostics
    };
  }

  const errClassified = classifyError(lastError, resolvedGetTimeout);
  return {
    isDead: true,
    statusText: errClassified.statusText,
    category: isTimeout ? 'timeout' : 'network',
    isLocalPrivate: false,
    redirectedToHomepage: false,
    isRetryable: true,
    diagnostics
  };
}

/**
 * Infers a UI category from a stored dead/redirected bookmark item, preserving
 * compatibility with older scan payloads that lacked `category`.
 * @param {Object} item
 * @returns {'404'|'network'|'timeout'|'5xx'|'other-http'|'local-private'|'redirect-homepage'}
 */
export function inferBookmarkCategory(item) {
  if (!item) return 'other-http';
  if (item.category && VALID_CATEGORIES.has(item.category)) {
    return item.category;
  }

  const statusText = String(item.statusText || '');
  const lower = statusText.toLowerCase();
  const isExplicitHttp = /\b(?:404|410)\b|^http\s+[45]\d\d\b/i.test(statusText);

  if (
    !isExplicitHttp &&
    (item.isLocalPrivate || item.diagnostics?.isLocalPrivate || isLocalOrPrivateUrl(item.url))
  ) {
    return 'local-private';
  }
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('404') || lower.includes('410')) return '404';
  if (/http\s+5\d\d/i.test(statusText)) return '5xx';
  if (lower.includes('network') || lower.includes('dns')) return 'network';
  if (lower.includes('redirect')) return 'redirect-homepage';
  return 'other-http';
}

/**
 * Safely extracts a lowercase hostname from a URL, or returns '' on failure.
 * @param {string} url
 * @returns {string}
 */
export function getHostnameSafe(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Reorders items round-robin by hostname so consecutive network checks spread across
 * different domains instead of hammering one origin simultaneously.
 * @template T
 * @param {Array<T>} items
 * @param {(item: T) => string} [getUrl]
 * @returns {Array<T>}
 */
export function interleaveByHostname(items, getUrl = (item) => item?.url) {
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? [...items] : [];
  }

  const bucketsMap = new Map();
  for (const item of items) {
    const host = getHostnameSafe(getUrl(item)) || '__unknown__';
    if (!bucketsMap.has(host)) {
      bucketsMap.set(host, []);
    }
    bucketsMap.get(host).push(item);
  }

  const buckets = Array.from(bucketsMap.values()).sort((a, b) => b.length - a.length);
  const result = [];
  const maxLen = buckets[0]?.length || 0;

  for (let round = 0; round < maxLen; round++) {
    for (let b = 0; b < buckets.length; b++) {
      if (round < buckets[b].length) {
        result.push(buckets[b][round]);
      }
    }
  }

  return result;
}

/**
 * Executes async work across items using a bounded sliding worker pool with a
 * per-host in-flight cap and cooperative cancellation.
 * @template T, R
 * @param {Array<T>} items
 * @param {(item: T, index: number) => Promise<R>} workerFn
 * @param {{
 *   concurrency?: number,
 *   maxPerHost?: number,
 *   getHost?: (item: T) => string,
 *   shouldCancel?: () => boolean,
 *   onItemDone?: (result: R, item: T, index: number) => void|Promise<void>
 * }} [options]
 * @returns {Promise<Array<R>>}
 */
export async function runWithConcurrencyPool(
  items,
  workerFn,
  {
    concurrency = 6,
    maxPerHost = 2,
    getHost = (item) => getHostnameSafe(item?.url),
    shouldCancel = () => false,
    onItemDone
  } = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const effectiveConcurrency = Math.max(1, concurrency);
  const effectiveMaxPerHost = Math.max(1, maxPerHost);
  const pending = items.map((item, index) => ({
    item,
    index,
    host: getHost(item) || ''
  }));
  const results = new Array(items.length);
  const inFlightPerHost = new Map();
  let activeCount = 0;
  let settled = false;

  return new Promise((resolve) => {
    const maybeResolve = () => {
      if (settled) return;
      if (activeCount === 0 && (pending.length === 0 || shouldCancel())) {
        settled = true;
        resolve(results);
      }
    };

    const dispatch = () => {
      if (settled) return;

      while (activeCount < effectiveConcurrency && !shouldCancel() && pending.length > 0) {
        const nextPos = pending.findIndex(({ host }) => {
          if (!host) return true;
          return (inFlightPerHost.get(host) || 0) < effectiveMaxPerHost;
        });

        if (nextPos === -1) {
          break;
        }

        const [entry] = pending.splice(nextPos, 1);
        activeCount++;
        if (entry.host) {
          inFlightPerHost.set(entry.host, (inFlightPerHost.get(entry.host) || 0) + 1);
        }

        Promise.resolve()
          .then(() => workerFn(entry.item, entry.index))
          .then((res) => {
            results[entry.index] = res;
            if (onItemDone) {
              return onItemDone(res, entry.item, entry.index);
            }
          })
          .catch(() => {
            // Keep pool advancing even if a callback throws unexpectedly
          })
          .finally(() => {
            activeCount--;
            if (entry.host) {
              const remaining = (inFlightPerHost.get(entry.host) || 1) - 1;
              if (remaining <= 0) {
                inFlightPerHost.delete(entry.host);
              } else {
                inFlightPerHost.set(entry.host, remaining);
              }
            }
            dispatch();
            maybeResolve();
          });
      }

      maybeResolve();
    };

    dispatch();
  });
}

/**
 * Builds a structured debug export payload for selected bookmarks.
 * @param {Array<Object>} items
 * @param {{ tab?: string, scanTimestamp?: string|null, extensionVersion?: string }} [options]
 * @returns {Object}
 */
export function buildDebugExportPayload(items, { tab = 'dead', scanTimestamp = null, extensionVersion = '1.0.3' } = {}) {
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
 * Traverses a bookmark tree node or list of nodes in natural Chrome order
 * to extract all valid bookmarks with their folder hierarchy path.
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
        for (let i = node.children.length - 1; i >= 0; i--) {
          const child = node.children[i];
          const childPath = child.children
            ? (path ? `${path} / ${child.title}` : child.title)
            : path;
          stack.push({ node: child, path: childPath });
        }
      }
    }
  }

  return allBookmarks;
}

/**
 * Extracts valid bookmarks matching selected folder IDs from the full Chrome bookmark
 * tree while preserving complete breadcrumb folder paths.
 * @param {Array<Object>|Object} treeRoots
 * @param {Array<string>} selectedFolderIds
 * @param {{ exactFolderMatch?: boolean }} [options]
 * @returns {Array<Object>}
 */
export function extractBookmarksForSelectedFolders(
  treeRoots,
  selectedFolderIds,
  { exactFolderMatch = false } = {}
) {
  const rawRoots = Array.isArray(treeRoots) ? treeRoots : (treeRoots ? [treeRoots] : []);
  const roots =
    rawRoots.length === 1 && rawRoots[0]?.id === '0' && Array.isArray(rawRoots[0].children)
      ? rawRoots[0].children
      : rawRoots;

  const hasExplicitSelection = Array.isArray(selectedFolderIds) && selectedFolderIds.length > 0;
  const selectedSet = new Set(hasExplicitSelection ? selectedFolderIds : ['1', '2']);
  const useExact = Boolean(exactFolderMatch && hasExplicitSelection);

  const allBookmarks = [];
  const visitedIds = new Set();

  for (const root of roots) {
    if (!root) continue;
    const stack = [{
      node: root,
      path: root.title || '',
      parentFolderId: root.parentId || null,
      hasSelectedAncestor: selectedSet.has(root.id)
    }];

    while (stack.length > 0) {
      const { node, path, parentFolderId, hasSelectedAncestor } = stack.pop();

      if (node.url && !visitedIds.has(node.id)) {
        const matchesSelection = useExact
          ? selectedSet.has(parentFolderId)
          : hasSelectedAncestor;
        if (matchesSelection && isValidBookmarkUrl(node.url)) {
          visitedIds.add(node.id);
          allBookmarks.push({ ...node, folderPath: path });
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          const child = node.children[i];
          const isChildFolder = Boolean(child.children);
          const childPath = isChildFolder
            ? (path ? `${path} / ${child.title}` : child.title)
            : path;
          const childHasSelectedAncestor =
            hasSelectedAncestor || (isChildFolder && selectedSet.has(child.id));

          stack.push({
            node: child,
            path: childPath,
            parentFolderId: node.id,
            hasSelectedAncestor: childHasSelectedAncestor
          });
        }
      }
    }
  }

  return allBookmarks;
}

/**
 * Splits bookmarks for health checking based on whether local/private/intranet
 * URLs should be pinged or skipped by default.
 * @param {Array<Object>} bookmarks
 * @param {{ includeLocalPrivate?: boolean }} [options]
 * @returns {{ bookmarksToCheck: Array<Object>, skippedLocalBookmarks: Array<Object> }}
 */
export function partitionBookmarksForHealthCheck(
  bookmarks,
  { includeLocalPrivate = false } = {}
) {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
    return { bookmarksToCheck: [], skippedLocalBookmarks: [] };
  }
  if (includeLocalPrivate) {
    return { bookmarksToCheck: [...bookmarks], skippedLocalBookmarks: [] };
  }

  const bookmarksToCheck = [];
  const skippedLocalBookmarks = [];
  for (const bm of bookmarks) {
    if (isLocalOrPrivateUrl(bm?.url)) {
      skippedLocalBookmarks.push(bm);
    } else {
      bookmarksToCheck.push(bm);
    }
  }
  return { bookmarksToCheck, skippedLocalBookmarks };
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
