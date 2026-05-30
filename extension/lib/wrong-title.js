/**
 * lib/wrong-title.js — detection + recovery for Crunchyroll's cross-linked
 * subtitle files.
 *
 * CONTEXT.md defines Wrong-title as a Source whose subtitle file on
 * Crunchyroll's CDN was authored for a completely different title.
 * Detection compares subtitle end time against video duration; recovery
 * probes every available Audio session for a duration-valid replacement.
 *
 * This module owns the policy.  The fetcher interface (fetchAndParseSubs,
 * fetchSubUrlForSource) is injected by the caller so this stays free of
 * URL handling and the Episode raw-text cache.
 *
 * Public surface:
 *   CRSubFix.wrongTitle.THRESHOLD_SEC
 *   CRSubFix.wrongTitle.validate(cues, videoDurationSec)
 *     → 'ok' | 'short' | 'unknown'
 *   CRSubFix.wrongTitle.findReplacement({ lang, ep, fetchAndParseSubs,
 *                                          fetchSubUrlForSource,
 *                                          getVideoDurationSec, log })
 *     → Promise<{ cues, url, fromSession } | null>
 *   CRSubFix.wrongTitle.validateAll({ ep, getVideoDurationSec, fetchAndParseSubs,
 *                                      fetchSubUrlForSource, onValidated, log })
 *     → Promise<void>
 */
(function () {
  'use strict';

  // Credits + post-credits silence are typically 0–4 min; anything beyond
  // 5 min suggests a cross-linked wrong-title file.
  const THRESHOLD_SEC = 300;
  const CONCURRENCY   = 3;

  /**
   * Returns 'ok', 'short', or 'unknown'.
   *   'short'   = subtitle ends THRESHOLD_SEC seconds before video end
   *   'unknown' = video duration not yet available (metadata not loaded)
   */
  function validate(cues, videoDurationSec) {
    if (!cues || !cues.length) return 'unknown';
    if (!isFinite(videoDurationSec) || videoDurationSec < 60) return 'unknown';
    const subEnd = cues.reduce((m, c) => Math.max(m, c.end), 0);
    return (videoDurationSec - subEnd) > THRESHOLD_SEC ? 'short' : 'ok';
  }

  // Fetch + parse + validate.  Returns cues on success, null on any failure.
  async function tryUrl(url, fetchAndParseSubs, vidDur) {
    if (!url) return null;
    const cues = await fetchAndParseSubs(url);
    if (!cues.length) return null;
    if (validate(cues, vidDur) !== 'ok') return null;
    return cues;
  }

  /**
   * When a subtitle for `lang` fails duration validation, scan every available
   * Audio session for a valid replacement.  Already-loaded catalog rows are
   * tried first (free); uncached sessions are lazily fetched one at a time
   * via fetchSubUrlForSource.
   *
   * Returns { cues, url, fromSession } on success, or null if no valid
   * source found.
   */
  async function findReplacement({
    lang, ep, fetchAndParseSubs, fetchSubUrlForSource, getVideoDurationSec, log,
  }) {
    if (!ep) return null;
    const catalog = ep.catalog;
    const vidDur  = getVideoDurationSec();

    for (const { url, fromSession } of catalog.iterCached(lang)) {
      const cues = await tryUrl(url, fetchAndParseSubs, vidDur);
      if (cues) {
        log?.(`Sub validation: found valid [${lang}] in [${fromSession}] session — using it.`);
        return { cues, url, fromSession };
      }
    }

    for (const v of catalog.uncachedVersions(lang)) {
      log?.(`Sub validation: probing [${v.locale}] session for [${lang}]…`);
      const result = await fetchSubUrlForSource(v.guid, v.locale, ep.authHeaders);
      if (result.rateLimited || result.fetchFailed) continue;
      const url = catalog.rowFor(v.locale)[lang];
      if (!url) continue;
      const cues = await tryUrl(url, fetchAndParseSubs, vidDur);
      if (cues) {
        log?.(`Sub validation: found valid [${lang}] in [${v.locale}] session — using it.`);
        return { cues, url, fromSession: v.locale };
      }
    }

    log?.(`Sub validation: no valid [${lang}] found in any session.`);
    return null;
  }

  /**
   * Background validation sweep across every subtitle locale known to the
   * Episode's catalog.  Updates the catalog's validation map and calls
   * onValidated(locale, status) after each verdict so a UI consumer can
   * refresh row state live.
   *
   * Idempotent — repeated calls before completion are coalesced through
   * the caller's own in-flight flag (kept caller-side because the policy
   * for "should we run again right now?" is interceptor's call).
   */
  async function validateAll({
    ep, getVideoDurationSec, fetchAndParseSubs, fetchSubUrlForSource,
    onValidated, log,
  }) {
    if (!ep) return;
    const catalog = ep.catalog;
    const vidDur  = getVideoDurationSec();
    if (!isFinite(vidDur) || vidDur < 60) return;

    const validateLang = async lang => {
      if (ep.disposed) return;
      const url = catalog.rowFor('ja-JP')[lang] ?? catalog.urlFor(lang);
      if (!url) { catalog.setValidation(lang, 'no-subs'); return; }

      const cues = await fetchAndParseSubs(url);
      // Empty result may be a transient CDN failure — skip rather than caching 'no-subs'.
      if (!cues.length || ep.disposed) return;

      const verdict = validate(cues, vidDur);
      if (verdict === 'short') {
        const replacement = await findReplacement({
          lang, ep, fetchAndParseSubs, fetchSubUrlForSource, getVideoDurationSec, log,
        });
        if (ep.disposed) return;
        if (replacement) {
          catalog.replaceUrl(lang, url, replacement.url);
          catalog.setValidation(lang, 'ok');
          log?.(`BG validate: [${lang}] corrected via ${replacement.fromSession} session.`);
        } else {
          catalog.setValidation(lang, 'wrong-title');
          log?.(`BG validate: [${lang}] wrong title — no valid source found.`, 'warn');
        }
      } else {
        catalog.setValidation(lang, 'ok');
      }
      onValidated?.(lang, catalog.validation(lang));
    };

    const knownQueue = [...catalog.allSubtitleLocales()].filter(l => !catalog.hasValidation(l));
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, knownQueue.length) }, async () => {
      let lang;
      while ((lang = knownQueue.shift()) !== undefined) await validateLang(lang);
    }));

    // For audio-dub locales with a guid but no URL captured yet, fetch each
    // session sequentially so every menu row gets a confirmed status.
    for (const v of catalog.versions()) {
      if (ep.disposed) return;
      if (!v.guid || v.locale === 'ja-JP' || catalog.hasValidation(v.locale)) continue;
      if (!ep.authHeaders) continue;
      const result = await fetchSubUrlForSource(v.guid, v.locale, ep.authHeaders);
      if (result.rateLimited) break;
      if (!result.url) {
        catalog.setValidation(v.locale, 'no-subs');
        onValidated?.(v.locale, 'no-subs');
        continue;
      }
      await validateLang(v.locale);
    }
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.wrongTitle = { THRESHOLD_SEC, validate, findReplacement, validateAll };
})();
