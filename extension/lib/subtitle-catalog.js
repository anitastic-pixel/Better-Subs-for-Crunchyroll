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
 *     Same-language (e.g. EN audio + EN subs): if the dub's own row carries a
 *     captions-sourced entry (the CC — full transcript of the SPOKEN dialogue,
 *     timed to the playing cut), serve that; a subtitles-sourced entry is
 *     usually a "signs & foreign speech" track, so then the JP row's full
 *     transcript wins.  Provenance arrives via recordSession's ccLocales
 *     (playbackApi.captionLocales).
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
      // { [audioLocale]: Set<subtitleLocale> } — which matrix entries came from
      // the session's `captions` map (CC) rather than `subtitles`.  In-memory
      // only, like the matrix itself.
      ccSourced: {},
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

    function recordSession(audioLocale, subs, ccLocales) {
      if (!audioLocale || !subs) return;
      if (!state.matrix[audioLocale]) state.matrix[audioLocale] = {};
      for (const [loc, url] of Object.entries(subs)) {
        if (url) state.matrix[audioLocale][loc] = url;
      }
      // Merge (never replace): sessions re-fetch on quality changes, and a
      // later call without provenance must not erase what an earlier one knew.
      if (ccLocales && ccLocales.length) {
        const set = state.ccSourced[audioLocale] ?? (state.ccSourced[audioLocale] = new Set());
        for (const loc of ccLocales) set.add(loc);
      }
    }

    // Whether a row's entry came from the session's `captions` map (CC).
    function captionSourced(audioLocale, subtitleLocale) {
      return !!state.ccSourced[audioLocale]?.has(subtitleLocale);
    }

    function urlFor(subtitleLocale) {
      const cur = state.currentAudio;
      if (cur && cur !== 'ja-JP' && cur === subtitleLocale) {
        // The dub's own CC is the full transcript of the SPOKEN dialogue,
        // timed to the playing cut — the JP row's entry translates the
        // Japanese script and matches neither.  Only captions-sourced entries
        // qualify; a subtitles-sourced one is usually signs-only, so the JP
        // row keeps priority for full coverage.
        const own = state.matrix[cur]?.[subtitleLocale];
        if (own && captionSourced(cur, subtitleLocale)) return own;
        if (state.matrix['ja-JP']?.[subtitleLocale]) return state.matrix['ja-JP'][subtitleLocale];
        if (own) return own;
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
      for (const [audio, row] of Object.entries(state.matrix)) {
        if (row[lang] === oldUrl) {
          row[lang] = newUrl;
          // The replacement is a different asset — its captions provenance no
          // longer holds (the next recordSession for the row restores it).
          state.ccSourced[audio]?.delete(lang);
        }
      }
    }

    function evictUrl(lang) {
      for (const [audio, row] of Object.entries(state.matrix)) {
        delete row[lang];
        state.ccSourced[audio]?.delete(lang);
      }
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
      state.ccSourced = {};
      state.versions = [];
      state.currentAudio = null;
      state.activeSource = null;
      state.validation = new Map();
      state.validationLoaded = false;
    }

    return {
      recordSession, urlFor, availability, captionSourced,
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

  // ── Learning-mode planning (pure) ───────────────────────────────────────────
  // The "watch & learn" study layout pairs the SPOKEN language (matched to the
  // episode's audio) with the viewer's own language, stacked.  The decisions are
  // pure — given the audio locale, the subtitle locales available on the episode,
  // and the viewer's chosen language — so they live here (catalog-adjacent) and
  // are unit-tested, while the DOM/menu wiring stays in interceptor.js.

  // Map a browser UI language (navigator.language, e.g. "it", "pt-BR", "es-MX")
  // to the closest Crunchyroll subtitle locale we can display.  Only a first
  // guess for the "your language" picker default — the user can override it.
  function defaultNativeLocale(navLang) {
    const ui = String(navLang || '').toLowerCase();
    const base = ui.split('-')[0];
    if (base === 'es') return /-(419|mx|ar|co|cl|pe|ve)\b/.test(ui) ? 'es-419' : 'es-ES';
    if (base === 'pt') return ui.includes('-pt') ? 'pt-PT' : 'pt-BR';
    if (base === 'en') return ui.includes('-gb') ? 'en-GB' : 'en-US';
    if (base === 'ar') return 'ar-SA';
    const MAP = {
      de: 'de-DE', fr: 'fr-FR', it: 'it-IT', ru: 'ru-RU', pl: 'pl-PL', ja: 'ja-JP',
      ko: 'ko-KR', zh: 'zh-CN', tr: 'tr-TR', nl: 'nl-NL', fi: 'fi-FI', sv: 'sv-SE',
      nb: 'nb-NO', no: 'nb-NO', da: 'da-DK', cs: 'cs-CZ', ro: 'ro-RO', hu: 'hu-HU',
      ms: 'ms-MY', th: 'th-TH', id: 'id-ID', vi: 'vi-VN', hi: 'hi-IN', ca: 'ca-ES',
    };
    return MAP[base] || 'en-US';
  }

  // Decide the stacked-subtitle layout.  audioLocale = the episode's spoken
  // language; locales = subtitle locales available on the episode (string[]);
  // native = the viewer's language.  Both audio and native are checked against
  // `locales` here — a language not on the episode can't be shown, so we never
  // promise a band that would silently stay empty (`nativeAvailable` lets the
  // caller explain when the viewer's language is dropped).
  //   audioMatched (a sub exists in the audio language AND it differs from the
  //     viewer's) → primary = audio (spoken on top); secondary = native only if
  //     native is also on the episode, else primary alone
  //   else (no sub matches the audio, or audio == native) → primary = native if
  //     available, else nothing (honest — we can't match what isn't there)
  function planLearningMode({ audioLocale, locales, native } = {}) {
    const has = (loc) => !!loc && Array.isArray(locales) && locales.includes(loc);
    const nativeAvailable = has(native);
    if (has(audioLocale) && audioLocale !== native) {
      return { primary: audioLocale, secondary: nativeAvailable ? native : '', audioMatched: true, nativeAvailable };
    }
    return { primary: nativeAvailable ? native : '', secondary: '', audioMatched: false, nativeAvailable };
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.createCatalog = createCatalog;
  NS.CRSubFix.learning = { defaultNativeLocale, planLearningMode };
})();
