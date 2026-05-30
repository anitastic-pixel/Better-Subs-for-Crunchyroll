/**
 * lib/episode.js — per-viewing Episode state container.
 *
 * Owns everything tied to one /watch/<guid> session: JP URLs, captured auth,
 * parsed cues + remaster state, and the localStorage caches keyed off the
 * episode/JP guids.  Owns the Catalog instance — which in turn owns subtitle
 * URL matrix, source-picker versions, AND per-locale validation status
 * (Episode wires the catalog to localStorage at construction).
 *
 * Lifecycle is driven by the SPA navigation handler in interceptor.js: each
 * /watch/ entry calls startEpisode(guid); the prior Episode is disposed (its
 * writes silently no-op afterwards via the disposed-guard).
 *
 * What this module does NOT own (intentionally):
 *   • the renderer's overlayActive / lastCueKey
 *   • player chrome (videoEl, button DOM, observers, native-sub suppression)
 *   • the remaster algorithm and validation sweep — those orchestrate UI
 *     (toasts, HUDs, button state) and live in interceptor.js, calling Episode
 *     methods to read inputs and write results
 *
 * Public surface (per the locked Design C interface):
 *   episode.guid                                         — readonly
 *   episode.disposed                                     — readonly
 *   episode.catalog                                      — owned Catalog instance
 *   episode.cuesAt(videoTime, offsetSec)                 — hot-path renderer read
 *   episode.dispose()
 *   episode.setActiveSource(locale)                      — delegates to catalog,
 *                                                          invalidates remaster
 *                                                          when audio session differs
 *   episode.activeSource()
 *   episode.setCurrentAudio(locale)                      — invalidates remaster,
 *                                                          keeps originalCues
 *   episode.catalog.{validation,setValidation,...}       — validation status now
 *                                                          lives on the catalog
 *                                                          alongside the URL matrix
 *   episode.shouldAutoActivate()  /  markAutoActivated()
 *
 * Plus per-state accessors for the existing fetch-intercept / button-click /
 * remaster code that still lives in interceptor.js.
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.storage || !NS.CRSubFix.createCatalog) {
    return;
  }

  const STORAGE = NS.CRSubFix.storage;

  // Cache namespacing — was previously inlined in interceptor.js.
  const CACHE_PREFIX            = 'crSubFix_';
  const MAP_PREFIX              = 'crSubFix_map_';
  const SESSION_PREFIX          = 'crSubFix_raw_';
  const SRC_CACHE_PREFIX        = 'crSubFix_src_';
  const VALIDATION_CACHE_PFX    = 'crSubFix_valid_';
  const ANCHOR_PREFIX           = 'crSubFix_anchors_';
  const CACHE_TTL               = 6  * 24 * 60 * 60 * 1000;
  const MAP_TTL                 = 30 * 24 * 60 * 60 * 1000;
  const VALIDATION_CACHE_TTL_MS = 7  * 24 * 60 * 60 * 1000;
  const ANCHOR_TTL              = 30 * 24 * 60 * 60 * 1000;

  // Bounded backwards scan in cuesAt.  100 covers any realistic cue duration
  // even in dense typeset files.
  const MAX_SCAN = 100;

  function createEpisode(guid) {
    // The Catalog owns validation state and reaches storage through these
    // adapters.  Catalog calls them lazily on first access and on every
    // setValidation, so Episode never has to schedule loads/saves directly.
    const catalog = NS.CRSubFix.createCatalog({
      loadValidation: () => STORAGE.lsGet(VALIDATION_CACHE_PFX + guid),
      saveValidation: (data) =>
        STORAGE.lsSet(VALIDATION_CACHE_PFX + guid, data, VALIDATION_CACHE_TTL_MS),
    });
    let disposed = false;

    // ── Per-viewing state (was scattered as module-level vars) ───────────────
    let jpCaptionUrl   = null;
    let jpSubtitleUrl  = null;
    let jpGuid         = null;
    let authHeaders    = {};
    let capturedAuth   = null;
    let prefetchTriggered = false;

    let originalCues   = [];     // immutable parse output
    let remasteredCues = null;   // anchor-interpolated; null until remaster runs
    let remasterForAudio = null; // Audio session current when last remaster ran
    let activeSubUrl   = null;

    // autoActivatedFor: the audio locale we last auto-activated against.
    // Distinct sentinel `NEVER` so a never-activated Episode is detectable
    // even when currentAudio() is still null (audio locale arrives with the
    // playback response — which may be after the first auto-activate trigger
    // in the prefetch path).  Re-firing auto-activate is allowed when the
    // audio locale changes mid-episode (dub switches that don't trigger SPA
    // nav — Crunchyroll often just swaps the DASH audio track in place).
    const NEVER = Symbol('never');
    let autoActivatedFor = NEVER;
    let enSessionCleanup = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    function dispose() {
      if (disposed) return;
      disposed = true;
      if (enSessionCleanup) {
        try { window.removeEventListener('beforeunload', enSessionCleanup); } catch (_) {}
        enSessionCleanup = null;
      }
      try { catalog.reset(); } catch (_) {}
    }

    // Wrap any setter so writes after dispose() are silent no-ops.
    function alive(fn) {
      return function (...args) { if (!disposed) return fn.apply(null, args); };
    }

    // ── Cue access (hot path) ─────────────────────────────────────────────────
    // Picks remasteredCues over originalCues automatically.  Caller does not
    // know which array is current — that decision lives here.
    function cuesAt(videoTime, offsetSec) {
      const cues = remasteredCues ?? originalCues;
      if (!cues.length) return [];
      const t = videoTime + (offsetSec || 0);
      let lo = 0, hi = cues.length - 1, right = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cues[mid].start <= t) { right = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (right < 0) return [];
      const result = [];
      for (let i = right; i >= 0 && (right - i) < MAX_SCAN; i--) {
        if (cues[i].end > t) result.push(cues[i]);
      }
      result.reverse();
      return result;
    }

    function hasCues() { return originalCues.length > 0; }

    // ── Source / Audio session ────────────────────────────────────────────────
    function activeSource() { return catalog.activeSource(); }
    function setActiveSource(locale) {
      const prev = catalog.activeSource();
      catalog.setActiveSource(locale);
      // Source change implies a new fetch+parse anyway — the caller will set
      // new originalCues, which makes any prior remaster stale.
      if (prev !== locale) {
        remasteredCues   = null;
        remasterForAudio = null;
      }
    }
    function setCurrentAudio(locale) {
      catalog.setCurrentAudio(locale);
      // Audio change invalidates remaster but keeps originalCues so a fresh
      // remaster can run against the new audio session.
      if (remasterForAudio && remasterForAudio !== locale) {
        remasteredCues   = null;
        remasterForAudio = null;
      }
    }

    // ── localStorage caches keyed off this Episode ────────────────────────────
    // (Storage envelope and TTL handling live in lib/storage.js.)
    function getCachedJpData(g) { return STORAGE.lsGet(CACHE_PREFIX + g); }
    function setCachedJpData(g, captionUrl, subtitleUrl, jpRow) {
      STORAGE.lsSet(CACHE_PREFIX + g, { captionUrl, subtitleUrl, jpRow: jpRow ?? {} }, CACHE_TTL);
    }
    function evictCachedJpData(g) { STORAGE.lsDel(CACHE_PREFIX + g); }

    function getMappedJpGuid() { return STORAGE.lsGet(MAP_PREFIX + guid)?.jpGuid ?? null; }
    function setMappedJpGuid(g) { STORAGE.lsSet(MAP_PREFIX + guid, { jpGuid: g }, MAP_TTL); }

    function getCachedRawText(url) { return STORAGE.ssGet(SESSION_PREFIX + url); }
    function setCachedRawText(url, text) { STORAGE.ssSet(SESSION_PREFIX + url, text); }

    function srcCacheKey(g, locale) { return SRC_CACHE_PREFIX + g + '_' + locale; }
    function getCachedSrcUrl(g, locale) { return STORAGE.lsGet(srcCacheKey(g, locale)); }
    function setCachedSrcUrl(g, locale, url) {
      STORAGE.lsSet(srcCacheKey(g, locale), { url }, CACHE_TTL);
    }
    function evictCachedSrcUrl(g, locale) { STORAGE.lsDel(srcCacheKey(g, locale)); }

    function anchorMapKey(srcSession, audioLocale) {
      return ANCHOR_PREFIX + guid + '_' + srcSession + '_' + audioLocale;
    }

    return {
      // ── Identity / lifecycle ──────────────────────────────────────────────
      get guid()     { return guid; },
      get disposed() { return disposed; },
      get catalog()  { return catalog; },
      dispose,

      // ── Hot path: cue read ────────────────────────────────────────────────
      cuesAt,
      hasCues,

      // ── Source / Audio session ────────────────────────────────────────────
      activeSource,
      setActiveSource: alive(setActiveSource),
      setCurrentAudio: alive(setCurrentAudio),

      // ── JP data ───────────────────────────────────────────────────────────
      get jpCaptionUrl()  { return jpCaptionUrl; },
      get jpSubtitleUrl() { return jpSubtitleUrl; },
      get jpGuid()        { return jpGuid; },
      get authHeaders()   { return authHeaders; },
      get capturedAuth()  { return capturedAuth; },
      setJpUrls: alive((cap, sub) => { jpCaptionUrl = cap; jpSubtitleUrl = sub; }),
      clearJpUrls: alive(() => { jpCaptionUrl = null; jpSubtitleUrl = null; }),
      setJpGuid: alive(g => { jpGuid = g; }),
      setAuthHeaders: alive(h => { authHeaders = h; }),
      setCapturedAuth: alive(a => { capturedAuth = a; }),

      // ── Cue arrays ────────────────────────────────────────────────────────
      get originalCues()     { return originalCues; },
      get remasteredCues()   { return remasteredCues; },
      get remasterForAudio() { return remasterForAudio; },
      get activeSubUrl()     { return activeSubUrl; },
      setOriginalCues: alive(c => { originalCues = c; remasteredCues = null; remasterForAudio = null; }),
      setRemasteredCues: alive((cues, audioLocale) => {
        remasteredCues   = cues;
        remasterForAudio = audioLocale;
      }),
      setRemasterForAudio: alive(audio => { remasterForAudio = audio; }),
      setActiveSubUrl: alive(url => { activeSubUrl = url; }),
      clearCues: alive(() => {
        originalCues = []; remasteredCues = null; remasterForAudio = null; activeSubUrl = null;
      }),
      clearRemaster: alive(() => { remasteredCues = null; remasterForAudio = null; }),

      // ── Auto-activate (one-shot per audio session) ────────────────────────
      // Re-fires when the audio locale changes mid-episode so dub switches
      // that don't trigger SPA nav still get an auto-activation pass.
      shouldAutoActivate: () => autoActivatedFor !== catalog.currentAudio(),
      markAutoActivated:  alive(() => { autoActivatedFor = catalog.currentAudio(); }),

      // ── Pre-fetch latch ───────────────────────────────────────────────────
      get prefetchTriggered() { return prefetchTriggered; },
      markPrefetchTriggered:  alive(() => { prefetchTriggered = true; }),

      // ── EN session cleanup handler ────────────────────────────────────────
      get enSessionCleanup() { return enSessionCleanup; },
      setEnSessionCleanup: alive(fn => {
        if (enSessionCleanup) {
          try { window.removeEventListener('beforeunload', enSessionCleanup); } catch (_) {}
        }
        enSessionCleanup = fn;
      }),

      // ── localStorage caches ───────────────────────────────────────────────
      getCachedJpData,
      setCachedJpData: alive(setCachedJpData),
      evictCachedJpData: alive(evictCachedJpData),
      getMappedJpGuid,
      setMappedJpGuid: alive(setMappedJpGuid),
      getCachedRawText,
      setCachedRawText: alive(setCachedRawText),
      getCachedSrcUrl,
      setCachedSrcUrl: alive(setCachedSrcUrl),
      evictCachedSrcUrl: alive(evictCachedSrcUrl),
      anchorMapKey,
    };
  }

  // ── Module-level Episode registry ──────────────────────────────────────────
  // Single live Episode at a time.  startEpisode disposes the prior one;
  // currentEpisode() returns it or null.  No long-lived registry across
  // disposed Episodes — the disposed-guard inside each Episode is what makes
  // late-arriving fetch-response writes safe (they no-op).

  let _current = null;

  function startEpisode(g) {
    if (_current && _current.guid === g && !_current.disposed) return _current;
    if (_current) _current.dispose();
    _current = createEpisode(g);
    return _current;
  }

  function currentEpisode() { return _current; }

  function disposeCurrentEpisode() {
    if (_current) { _current.dispose(); _current = null; }
  }

  // Get the Episode that matches a guid extracted from a fetch URL.  Returns
  // the current Episode iff its guid matches; otherwise null.  Late-arriving
  // playback responses for a navigated-away Episode return null and are
  // dropped by the caller.
  function getEpisode(g) {
    if (!g) return null;
    return (_current && _current.guid === g && !_current.disposed) ? _current : null;
  }

  NS.CRSubFix.episode = {
    create:         createEpisode,
    start:          startEpisode,
    current:        currentEpisode,
    disposeCurrent: disposeCurrentEpisode,
    get:            getEpisode,
  };
})();
