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
 *   CRSubFix.playbackApi.subtitleMap(data)          → { [locale]: url }
 *   CRSubFix.playbackApi.captionLocales(data)       → [locale] sourced from captions
 *   CRSubFix.playbackApi.pickEn(rawCaptionsOrSubs)  → best English url | null
 *   CRSubFix.playbackApi.jpVersion(data)            → ja-JP version obj | null
 *   CRSubFix.playbackApi.audioVersions(data)        → [{ locale, guid }]
 *   CRSubFix.playbackApi.cleanStreamUrl(data)       → subtitle-free stream url | null
 *   CRSubFix.playbackApi.subtitleMenuRowCount(data) → rows in CR's Subtitles/CC menu
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

  // Locales whose entry in this response came from `captions` — the CC track,
  // a full transcript of the SPOKEN audio — as opposed to `subtitles` (often
  // signs-only for a dub's own language).  This provenance drives the
  // catalog's same-language priority: a dub's own CC beats the JP session's
  // translated track (see urlFor in lib/subtitle-catalog.js).
  function captionLocales(data) {
    const out = [];
    for (const [loc, entry] of Object.entries(data?.captions ?? {})) {
      if (entryUrl(entry)) out.push(loc);
    }
    return out;
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

  // How many rows Crunchyroll's "Subtitles/CC" menu group holds for this
  // response: one per captions entry (the "[CC]" rows), one per subtitles entry
  // that has a url, plus the trailing "None" row.  Verified against two live
  // menus (2026-08-21): a ja-JP session — 0 captions + 9 subtitles + None = 10
  // rows — and its en-US dub — 1 caption + 1 subtitle + None = 3 rows
  // ("English [CC]", "English", "None").
  //
  // NOT the hardSubs count: that dub ships 2 hardsub variants (en-US, none) but
  // 3 menu rows, which is exactly what made the first version of the
  // "no subtitles" click refuse to fire on dubs.
  function subtitleMenuRowCount(data) {
    const withUrl = (m) => Object.values(m ?? {}).filter((e) => entryUrl(e)).length;
    const hs      = data?.hardSubs ?? data?.hardsubs ?? data?.hard_subs;
    const hasNone = !!(data?.subtitles && 'none' in data.subtitles) || !!(hs && 'none' in hs);
    return withUrl(data?.captions) + withUrl(data?.subtitles) + (hasNone ? 1 : 0);
  }

  // The subtitle-free ("clean") video variant Crunchyroll publishes for this
  // session.  Live-verified 2026-08-21 (Re:Zero S3 E1, ja-JP session AND its
  // en-US dub session): hardSubs carries a literal "none" entry
  // { hlang:'none', url:'…/1/clean/dash/manifest.mpd', quality:'adaptive' } —
  // the same URL behind the "None" item in CR's own subtitle menu.  Every other
  // hardSubs entry points at a burned variant under /0/<locale>/.
  //
  // Hide-official empties hardSubs so the player falls back to the top-level
  // url; preferring this entry as that fallback keeps it landing on a clean
  // stream even where CR serves a burned variant as `url`.  null = CR ships no
  // subtitle-free video here, so hide-official cannot help.
  function cleanStreamUrl(data) {
    const hs   = data?.hardSubs ?? data?.hardsubs ?? data?.hard_subs;
    const none = hs && (hs.none ?? hs.None);
    const u    = entryUrl(none);
    if (u) return u;
    // Path was …/1/clean/dash/… until 2026-09, now …/static/majin/<asset>/clean/cenc/dash/….
    return (typeof data?.url === 'string' && /\/clean\//.test(data.url)) ? data.url : null;
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
  NS.CRSubFix.playbackApi = { subtitleMap, captionLocales, pickEn, jpVersion, audioVersions, cleanStreamUrl, subtitleMenuRowCount };
})();
