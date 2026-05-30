/**
 * lib/playback-api.js — pure parsers for Crunchyroll's playback API response.
 *
 * Everything that knows the shape of the JSON returned by
 * `/playback/v3/<guid>/web/chrome/play` lives here: the captions/subtitles
 * locale→URL matrix, the two entry encodings ({url} vs bare string), the
 * English-locale preference order, and the `versions` (audio dub) list.
 *
 * No DOM, no fetch, no state — feed it a parsed response object and it returns
 * plain data.  That makes it the test surface for the response contract:
 * recorded playback JSON can be exercised without a browser.  The network call,
 * caching, and Episode wiring stay in interceptor.js.
 *
 * Exposes:
 *   CRSubFix.playbackApi.EN_LOCALES                 → ['en-US','en-GB','en']
 *   CRSubFix.playbackApi.entryUrl(entry)            → url string | null
 *   CRSubFix.playbackApi.subtitleMap(data)          → { [locale]: url }
 *   CRSubFix.playbackApi.pickEn(rawCaptionsOrSubs)  → best English url | null
 *   CRSubFix.playbackApi.jpVersion(data)            → ja-JP version obj | null
 *   CRSubFix.playbackApi.audioVersions(data)        → [{ locale, guid }]
 */
(function () {
  'use strict';

  // English subtitle locale codes, in preference order.  Crunchyroll serves
  // 'en-US' in most regions but 'en-GB' or bare 'en' elsewhere.
  const EN_LOCALES = ['en-US', 'en-GB', 'en'];

  // A captions/subtitles entry is either { url: '...' } or a bare URL string.
  function entryUrl(entry) {
    if (entry && typeof entry === 'object' && entry.url) return entry.url;
    if (typeof entry === 'string' && entry) return entry;
    return null;
  }

  // Merge a playback response's captions + subtitles into { locale: url }.
  // Captions win over subtitles for the same locale (captions carry the full
  // transcript; subtitles are often a signs-only track).
  function subtitleMap(data) {
    const map = {};
    for (const [loc, entry] of Object.entries(data?.captions ?? {})) {
      const url = entryUrl(entry);
      if (url) map[loc] = url;
    }
    for (const [loc, entry] of Object.entries(data?.subtitles ?? {})) {
      if (map[loc]) continue;
      const url = entryUrl(entry);
      if (url) map[loc] = url;
    }
    return map;
  }

  // Best English URL from a raw captions/subtitles object (not the merged map),
  // trying regional variants in order.  Returns null if none present.
  function pickEn(rawMap) {
    if (!rawMap) return null;
    for (const loc of EN_LOCALES) {
      const url = entryUrl(rawMap[loc]);
      if (url) return url;
    }
    return null;
  }

  // The ja-JP entry in data.versions, or null.
  function jpVersion(data) {
    return (data?.versions ?? []).find(v => v.audio_locale === 'ja-JP') ?? null;
  }

  // Every audio dub version as [{ locale, guid }] in response order (JP
  // included).  Skips entries missing a guid or audio_locale.
  function audioVersions(data) {
    const out = [];
    for (const v of (data?.versions ?? [])) {
      if (v.guid && v.audio_locale) out.push({ locale: v.audio_locale, guid: v.guid });
    }
    return out;
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.playbackApi = { EN_LOCALES, entryUrl, subtitleMap, pickEn, jpVersion, audioVersions };
})();
