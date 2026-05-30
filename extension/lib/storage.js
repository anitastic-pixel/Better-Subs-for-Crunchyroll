/**
 * lib/storage.js — typed storage facade.
 *
 * Two storage planes:
 *   • localStorage with optional TTL.  Envelope: { v: <value>, exp: <msEpoch|null> }.
 *   • sessionStorage for short-lived flags (no TTL).
 *
 * All operations swallow exceptions (quota / blocked / parse errors) and
 * return null/false rather than throwing — the caller's flow continues
 * with a cache miss.
 *
 * Old-format entries with a different envelope shape silently fail to load
 * and get re-warmed from network on next use.
 */
(function () {
  'use strict';

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('v' in parsed)) return null;
      const { v, exp } = parsed;
      if (exp != null && Date.now() > exp) {
        localStorage.removeItem(key);
        return null;
      }
      return v ?? null;
    } catch (_) {
      return null;
    }
  }

  function lsSet(key, value, ttlMs) {
    try {
      const exp = ttlMs > 0 ? Date.now() + ttlMs : null;
      localStorage.setItem(key, JSON.stringify({ v: value, exp }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function ssGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function ssSet(key, value) {
    try { sessionStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function ssHas(key) { return ssGet(key) != null; }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.storage = { lsGet, lsSet, lsDel, ssGet, ssSet, ssHas };
})();
