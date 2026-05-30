/**
 * lib/subtitle-catalog.js — registry of subtitle URLs across audio sessions,
 * per-locale validation status, and the policy for picking the best URL given
 * the currently-playing audio.
 *
 * State (one instance per Episode, created by lib/episode.js):
 *   matrix          : { [audioLocale]: { [subtitleLocale]: url } }
 *   versions        : [{ locale, guid }]   — JP first, then audio dubs, then sub-only locales
 *   currentAudio    : audio locale of the currently-playing stream
 *   activeSource    : user-selected subtitle locale (null = default JP behaviour)
 *   validation      : Map<locale, 'ok'|'wrong-title'|'no-subs'>  — populated by
 *                     interceptor.js's background validation sweep, persisted
 *                     across visits via the storage adapters injected at
 *                     construction time
 *
 * Policy concentrated here:
 *
 *   urlFor(locale): same-language vs cross-language priority.
 *     Same-language (e.g. DE audio + DE subs): the dub's own row carries only
 *     a "signs & foreign speech" track; the JP row holds the full transcript
 *     for every locale, so prefer JP for complete coverage.
 *     Cross-language: the current-audio row is timed for that dub's pacing,
 *     so prefer it; fall back to JP, then any other captured session.
 *
 *   availability(locale): true | false | null
 *     true  = URL already known
 *     null  = URL unknown but a session guid exists; lazy-fetch on demand
 *     false = no URL and no guid
 *
 *   findBridge(srcSession, audioSession): English preferred, then any shared
 *     language — used by remaster to text-match cues across two cuts.
 *
 *   setValidation(locale, status): monotonic — once a locale is 'ok', it stays
 *     'ok'.  Triggers the saveValidation adapter on every successful update so
 *     the cache stays consistent.  Reads lazy-load via the loadValidation
 *     adapter on first access (validation/hasValidation/setValidation).
 */
(function () {
  'use strict';

  function createCatalog(opts) {
    const loadValidation = opts?.loadValidation ?? null;
    const saveValidation = opts?.saveValidation ?? null;

    const state = {
      matrix: {},
      versions: [],
      currentAudio: null,
      activeSource: null,
      validation:        new Map(),
      validationLoaded:  false,
    };

    function ensureValidationLoaded() {
      if (state.validationLoaded) return;
      state.validationLoaded = true;
      if (!loadValidation) return;
      const data = loadValidation();
      if (!data) return;
      for (const [lang, status] of Object.entries(data)) {
        if (!state.validation.has(lang)) state.validation.set(lang, status);
      }
    }

    function recordSession(audioLocale, subs) {
      if (!audioLocale || !subs) return;
      if (!state.matrix[audioLocale]) state.matrix[audioLocale] = {};
      for (const [loc, url] of Object.entries(subs)) {
        if (url) state.matrix[audioLocale][loc] = url;
      }
    }

    function urlFor(subtitleLocale) {
      const cur = state.currentAudio;
      if (cur && cur !== 'ja-JP' && cur === subtitleLocale) {
        if (state.matrix['ja-JP']?.[subtitleLocale]) return state.matrix['ja-JP'][subtitleLocale];
        if (state.matrix[cur]?.[subtitleLocale])     return state.matrix[cur][subtitleLocale];
      } else {
        if (cur && state.matrix[cur]?.[subtitleLocale]) return state.matrix[cur][subtitleLocale];
        if (state.matrix['ja-JP']?.[subtitleLocale])    return state.matrix['ja-JP'][subtitleLocale];
      }
      for (const row of Object.values(state.matrix)) {
        if (row[subtitleLocale]) return row[subtitleLocale];
      }
      return null;
    }

    // Caller answers ja-JP availability separately (it's owned by the JP-first
    // session fetch, not the matrix row).  This responds for any other locale.
    function availability(locale) {
      if (urlFor(locale)) return true;
      const v = state.versions.find(v => v.locale === locale);
      return v?.guid ? null : false;
    }

    function setVersions(versions) { state.versions = versions; }
    function versions()             { return state.versions; }

    function setCurrentAudio(loc) { state.currentAudio = loc; }
    function currentAudio()       { return state.currentAudio; }

    function setActiveSource(loc) { state.activeSource = loc; }
    function activeSource()       { return state.activeSource; }

    function allSubtitleLocales() {
      const s = new Set();
      for (const row of Object.values(state.matrix)) for (const loc of Object.keys(row)) s.add(loc);
      return s;
    }

    function findBridge(srcSession, audioSession) {
      const src = state.matrix[srcSession]   ?? {};
      const ref = state.matrix[audioSession] ?? {};
      for (const lang of ['en-US', 'en-GB', 'en']) {
        if (src[lang] && ref[lang]) return lang;
      }
      return Object.keys(src).find(l => ref[l]) ?? null;
    }

    function rowFor(audioLocale) { return state.matrix[audioLocale] ?? {}; }

    // Locate which session row a previously-loaded URL came from.  urlBase is
    // injected so the catalog stays free of CDN-auth-stripping knowledge.
    function findSession(loadedUrl, urlBase) {
      const target = urlBase(loadedUrl);
      for (const [locale, row] of Object.entries(state.matrix)) {
        for (const [lang, url] of Object.entries(row)) {
          if (urlBase(url) === target) return { session: locale, lang };
        }
      }
      return null;
    }

    function* iterCached(lang) {
      for (const [audioLocale, row] of Object.entries(state.matrix)) {
        if (row[lang]) yield { url: row[lang], fromSession: audioLocale };
      }
    }

    // Versions whose session has not yet been fetched for `lang`.
    function uncachedVersions(lang) {
      return state.versions.filter(v => v.guid && !state.matrix[v.locale]?.[lang]);
    }

    function replaceUrl(lang, oldUrl, newUrl) {
      for (const row of Object.values(state.matrix)) {
        if (row[lang] === oldUrl) row[lang] = newUrl;
      }
    }

    function evictUrl(lang) {
      for (const row of Object.values(state.matrix)) delete row[lang];
    }

    function entries() { return Object.entries(state.matrix); }

    // ── Validation ────────────────────────────────────────────────────────────
    // Reads lazy-load.  setValidation enforces monotonicity and triggers the
    // saveValidation adapter on every change.
    function setValidation(locale, status) {
      ensureValidationLoaded();
      if (state.validation.get(locale) === 'ok' && status !== 'ok') return;
      state.validation.set(locale, status);
      if (saveValidation && state.validation.size) saveValidation(exportValidation());
    }
    function validation(locale) {
      ensureValidationLoaded();
      return state.validation.get(locale);
    }
    function hasValidation(locale) {
      ensureValidationLoaded();
      return state.validation.has(locale);
    }
    function validationMap() {
      ensureValidationLoaded();
      return state.validation;
    }
    function exportValidation() {
      return Object.fromEntries(state.validation);
    }

    function reset() {
      state.matrix = {};
      state.versions = [];
      state.currentAudio = null;
      state.activeSource = null;
      state.validation = new Map();
      state.validationLoaded = false;
    }

    return {
      recordSession, urlFor, availability,
      setVersions, versions,
      setCurrentAudio, currentAudio,
      setActiveSource, activeSource,
      allSubtitleLocales, findBridge, rowFor,
      findSession, iterCached, uncachedVersions,
      replaceUrl, evictUrl, entries,
      setValidation, validation, hasValidation, validationMap, exportValidation,
      reset,
    };
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.createCatalog = createCatalog;
})();
