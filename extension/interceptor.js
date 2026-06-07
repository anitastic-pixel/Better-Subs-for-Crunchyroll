/**
 * interceptor.js — runs in the MAIN world (page's own JS context).
 *
 * Features:
 * 1. JP-first parallel session fetch (avoids 420 on reload)
 * 2. DASH manifest VTT swap (automatic, native "English [CC]" track)
 * 3. "JP CC" overlay button with ASS typesetting support
 *    - Parses [Script Info], [V4+ Styles], and per-dialogue override tags
 *    - Positions signs using scaled \pos coordinates + alignment transforms
 *    - Fades via Web Animations API
 *    - Hides native subtitle tracks while active
 * 4. Auto-activate: enables JP CC automatically when video starts playing
 * 5. Subtitle size + sync offset read from data attributes (set by content.js)
 * 6. Status attributes on <html> for popup display and extension badge
 * 7. SPA navigation detection (pushState / popstate reset)
 * 8. Debounced MutationObserver
 * 9. sessionStorage subtitle text cache (survives off/on toggle)
 * 10. Subtitle duration validation: detects cross-linked wrong-title subtitle files
 *     by comparing subtitle end time against video duration.  When a mismatch is
 *     found, probes all available audio sessions for a valid replacement before
 *     falling back to an "unavailable" state with a clear menu indicator.
 *
 * Settings read from <html> data attributes (written by content.js):
 *   data-cr-sub-fix        "true"|"false"   — extension enabled
 *   data-cr-auto-activate  "true"|"false"   — auto-enable on play
 *   data-cr-sub-scale      float            — subtitle size multiplier
 *   data-cr-sub-offset     float            — sync offset in seconds
 *
 * Status attributes written here (read by content.js for popup/badge):
 *   data-cr-jp-status   "none"|"ready"|"active"|"reload"|"error"|"unavailable"
 *   data-cr-jp-active   "true"|"false"
 *
 * Architecture (see lib/*):
 *   lib/settings-schema.js   — DOM-attr ↔ chrome.storage settings schema
 *   lib/storage.js           — typed localStorage / sessionStorage facade
 *   lib/playback-api.js      — pure parsers for Crunchyroll's playback response
 *                              (subtitle URL matrix, EN pick, dub versions)
 *   lib/subtitle-parser.js   — ASS / WebVTT pure parsers + color utils
 *   lib/subtitle-catalog.js  — per-page registry of subtitle URLs and the
 *                              policy for picking the best URL for a locale
 *   lib/episode.js           — per-viewing Episode container: JP urls, cues,
 *                              remaster, validation, catalog, auth.  Driven by
 *                              SPA navigation; routes by guid so late-arriving
 *                              fetch responses for navigated-away viewings are
 *                              dropped via Episode's disposed-guard.  All cue
 *                              and URL state in this file lives behind ep.X.
 *   lib/overlay-ui.js        — toast and progress-HUD primitives
 */

(function () {
  'use strict';

  // Diagnostic: surface any missing module so a silent bail is visible.
  const NS = self.CRSubFix;
  if (!NS) { console.warn('[CR Sub Fix] interceptor.js bail: self.CRSubFix is undefined'); return; }
  const _missing = ['settings','storage','parser','ui','createCatalog','episode','protocol','cueStyle','createCueRenderer','createSubSuppression','wrongTitle','remaster','createSourceMenu','playbackApi'].filter(k => !NS[k]);
  if (_missing.length) {
    console.warn('[CR Sub Fix] interceptor.js bail: missing modules:', _missing, 'present:', Object.keys(NS));
    return;
  }
  // Wrap the rest of the IIFE so any throw is logged instead of silenced.
  try {

  const SETTINGS = NS.settings;
  const STORAGE  = NS.storage;
  const PARSER   = NS.parser;
  const UI       = NS.ui;
  const EP       = NS.episode;
  const PROTOCOL = NS.protocol;
  const CUE_STYLE = NS.cueStyle;
  const WRONG_TITLE = NS.wrongTitle;
  const REMASTER  = NS.remaster;
  const PLAYBACK  = NS.playbackApi;

  // Re-exports so existing call sites keep working unchanged.
  const { parseSubtitles, normalizeSubText, applyAlpha } = PARSER;
  const { escapeHtml } = UI;
  const { hexToRgba } = CUE_STYLE;
  const { buildAnchorMap, remasterCues, computeMedianDelta, MIN_ANCHORS } = REMASTER;

  // Logging + diagnostics.  The sessionStorage *trace* records ALWAYS (silently)
  // — it backs the popup's "Report an issue" diagnostics and the crSubFixDebug
  // tools.  It's cheap: log lines only fire at navigation/activation events,
  // never per-frame, and ride a 400-entry ring buffer that survives SPA navs and
  // reloads (the devtools console gets wiped on each pushState).  The DEBUG flag
  // only adds live *console* output on top — OFF by default so the published
  // build stays quiet; genuine errors always print.  Toggle console verbosity at
  // runtime, no rebuild, from the page console:
  //     crSubFixDebug.on()    // verbose console (then reload)
  //     crSubFixDebug.dump()  // read the trace (always populated)
  //     crSubFixDebug.off()   // quiet console again (then reload)
  const DEBUG = (() => {
    try { return localStorage.getItem('crSubFix_debug') === '1'; } catch (_) { return false; }
  })();
  const TRACE_KEY = 'crSubFix_trace';
  const TRACE_MAX = 400;
  const traceMirror = (level, args) => {
    try {
      const arr  = JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]');
      const guid = (location.pathname.split('/')[2] || '?').slice(0, 9);
      arr.push(`${Date.now()} ${guid} [${level}] ` + args.map(a => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); }
        catch (_) { return String(a); }
      }).join(' '));
      while (arr.length > TRACE_MAX) arr.shift();
      sessionStorage.setItem(TRACE_KEY, JSON.stringify(arr));
    } catch (_) {}
  };
  const log = {
    info:  (...a) => { if (DEBUG) console.info(LOG, ...a); traceMirror('I', a); },
    warn:  (...a) => { if (DEBUG) console.warn(LOG, ...a); traceMirror('W', a); },
    error: (...a) => { console.error(LOG, ...a); traceMirror('E', a); },
  };
  // Always-available diagnostic controls (work whether or not DEBUG is on) so a
  // user hitting a problem can capture a full trace without a rebuild.
  try {
    window.crSubFixDebug = {
      on:    () => { try { localStorage.setItem('crSubFix_debug', '1'); } catch (_) {} return 'CR Sub Fix verbose logging ON — reload to see it in the console.'; },
      off:   () => { try { localStorage.removeItem('crSubFix_debug'); } catch (_) {} return 'CR Sub Fix verbose logging OFF — reload to apply.'; },
      dump:  () => { try { return JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]').join('\n'); } catch (_) { return ''; } },
      clear: () => { try { sessionStorage.removeItem(TRACE_KEY); } catch (_) {} return 'CR Sub Fix trace cleared.'; },
      // Throws an uncaught error from our own code so the on-error report nudge
      // can be tested without waiting for a real bug (no-op unless a
      // REPORT_ENDPOINT is configured).
      testReport: () => { if (!DEBUG) return 'Run crSubFixDebug.on() then reload first.'; setTimeout(() => { throw new Error('Better Subs: test report (ignore) #' + Date.now()); }, 0); return 'Test error thrown — watch for the report nudge near the player.'; },
      get isOn() { return DEBUG; },
    };
  } catch (_) {}

  // One-time random token written to a <html> attribute that content.js reads
  // and echoes back inside its CR_SUB_TOGGLE postMessage, so we accept the
  // toggle only from a sender that knows the token.
  //
  // Threat model (intentionally modest): this runs in the MAIN world and writes
  // the token to the page DOM, so a determined page script *can* read the
  // attribute and forge the message — the token is NOT a hard security boundary.
  // It exists to reject accidental / unrelated postMessages of the same type,
  // and the guarded action (showing/hiding the subtitle overlay) is harmless,
  // so that is sufficient. Do not rely on this token to gate anything sensitive.
  const TOGGLE_TOKEN = Math.random().toString(36).slice(2);
  document.documentElement.setAttribute(PROTOCOL.ATTR.TOGGLE_TOKEN, TOGGLE_TOKEN);

  const PLAYBACK_RE    = /\/playback\/v3\/([^/]+)\/web\/chrome\/play/;
  const MANIFEST_RE    = /\/dash\/manifest\.mpd/;
  const LOG            = '[CR Sub Fix]';
  const BTN_ID           = 'cr-jp-cc-btn';
  // OVERLAY_ID is kept here because subSuppression's CSS selectors reference
  // it to exclude our own overlay from the visibility:hidden sweep.  The
  // renderer also uses the same literal — keep them in sync.
  const OVERLAY_ID       = 'cr-jp-cc-overlay';
  const LOCALE_PREF_KEY       = 'crSubFix_preferred_locale';
  const ANCHOR_TTL            = 30 * 24 * 60 * 60 * 1000; // 30 days
  // MIN_ANCHORS, buildAnchorMap, remasterCues, computeMedianDelta live in
  // lib/remaster.js — aliased near the top of this file.

  // Human-readable names for audio-locale codes (each dub = a subtitle source option)
  const LOCALE_LABELS = {
    'ja-JP': 'Japanese',          'en-US': 'English',
    'en-GB': 'English (UK)',      'de-DE': 'Deutsch',
    'es-419':'Español (Lat)',     'es-ES': 'Español (España)',
    'ca-ES': 'Català',            'fr-FR': 'Français',
    'pt-BR': 'Português (BR)',    'pt-PT': 'Português (PT)',
    'it-IT': 'Italiano',          'ru-RU': 'Русский',
    'ar-ME': 'العربية',            'ar-SA': 'العربية (SA)',
    'zh-CN': '中文 (简)',           'zh-TW': '中文 (繁)',
    'hi-IN': 'हिंदी',             'ko-KR': '한국어',
    'pl-PL': 'Polski',            'tr-TR': 'Türkçe',
    'nl-NL': 'Nederlands',        'fi-FI': 'Suomi',
    'sv-SE': 'Svenska',           'nb-NO': 'Norsk',
    'da-DK': 'Dansk',             'cs-CZ': 'Čeština',
    'ro-RO': 'Română',            'hu-HU': 'Magyar',
    'ms-MY': 'Bahasa Melayu',     'th-TH': 'ภาษาไทย',
    'id-ID': 'Bahasa Indonesia',  'vi-VN': 'Tiếng Việt',
  };
  // Short 2-char labels shown on the toggle button while a source is active
  const LOCALE_SHORT = {
    'ja-JP':'JP','en-US':'EN','en-GB':'EN','de-DE':'DE',
    'es-419':'ES','es-ES':'ES','ca-ES':'CA',
    'fr-FR':'FR','pt-BR':'PT','pt-PT':'PT','it-IT':'IT',
    'ru-RU':'RU','ar-ME':'AR','ar-SA':'AR',
    'zh-CN':'ZH','zh-TW':'ZH','hi-IN':'HI','ko-KR':'KO',
    'pl-PL':'PL','tr-TR':'TR','nl-NL':'NL','fi-FI':'FI',
    'sv-SE':'SV','nb-NO':'NO','da-DK':'DA','cs-CZ':'CS',
    'ro-RO':'RO','hu-HU':'HU','ms-MY':'MS','th-TH':'TH',
    'id-ID':'ID','vi-VN':'VI',
  };

  const originalFetch = window.fetch.bind(window);

  // ── Page-chrome state ─────────────────────────────────────────────────────
  // Per-Episode state (subtitle URLs, cues + remaster, JP guid, auth, validation,
  // catalog) lives in lib/episode.js.  The renderer owns its own overlay element
  // and per-frame cue cache (lib/cue-renderer.js).  The vars below are about
  // the player widget on the page — they survive across episodes structurally.
  let videoEl            = null;
  let overlayActive      = false;
  let clickInProgress    = false;
  let buttonInControls   = false;
  let movedToControls    = false;

  // Queue-on-click latch.  When the user clicks JP CC before data is ready
  // (typical right after dub switch, when the new Episode has no playback
  // response yet), handleButtonClick sets this and parks the button in
  // 'loading' instead of failing.  The data-arrival paths
  // (maybePrefetch / playback intercept JP success) fire onJpDataReady
  // to complete the user's click the moment JP data lands.
  let pendingActivate    = false;

  // Timer that proactively resolves a stuck queue when Crunchyroll's player
  // never fires /playback/v3/ for the new dub.  Set when the click is
  // queued; cleared when data arrives or the Episode is torn down.
  let queueResolverTimer = null;
  const QUEUE_RESOLVE_MS = 2000;

  // Settle debounce for rapid dub switching.  Each SPA navigation resets this;
  // when switching pauses for SETTLE_MS, tryAutoActivate fires once more so the
  // dub the user actually landed on gets its JP subtitles, even if earlier
  // half-finished switches dropped their bootstrap.
  let settleTimer = null;
  let settleAttempts = 0;
  const SETTLE_MS  = 400;
  const SETTLE_MAX = 8;

  // Slug → { jpGuid, auth } memory for cross-dub recovery.  A dub switch routes
  // through a slug-less intermediate URL that disposes the episode holding the
  // resolved JP guid, so the same-nav carry can't survive it — this can.  See
  // handleNavigation.  Bounded (MRU on write, evict oldest) so a long browsing
  // session can't grow it without limit.
  const slugJpMemo = new Map();
  const SLUG_MEMO_MAX = 50;
  function rememberSlug(slug, data) {
    slugJpMemo.delete(slug);                 // re-insert at the most-recent end
    slugJpMemo.set(slug, data);
    while (slugJpMemo.size > SLUG_MEMO_MAX) slugJpMemo.delete(slugJpMemo.keys().next().value);
  }

  // Renderer instance — created once at module init, mounted/unmounted per
  // player.  getSubScale is read fresh per render so size-slider changes take
  // effect on the next frame without invalidation.
  const renderer = NS.createCueRenderer({
    getSubScale:       () => getSubScale(),
    getSubBottomFloor: () => getSubBottomFloor(),
  });

  // Source picker menu instance — created once.  Callbacks reach into the
  // page-chrome state and the Episode here, which keeps the module ignorant
  // of overlay activation / JP CC button / Source preference persistence.
  const sourceMenu = NS.createSourceMenu({
    getEpisode:      () => currentEp(),
    isOverlayActive: () => overlayActive,
    localeLabels:    LOCALE_LABELS,
    onSelectLocale:  (locale) => {
      const cur = currentEp();
      if (!cur) return;
      if (cur.activeSource() === locale && overlayActive) return;
      setPendingActivate(false); // explicit selection supersedes any queued click
      if (queueResolverTimer) { clearTimeout(queueResolverTimer); queueResolverTimer = null; }
      if (overlayActive) {
        overlayActive = false;
        stopSync();
      }
      cur.setActiveSource(locale);
      try { localStorage.setItem(LOCALE_PREF_KEY, locale); } catch (_) {}
      cur.clearCues();
      renderer.invalidate();
      const btn = document.getElementById(BTN_ID);
      if (btn) handleButtonClick(btn).catch(() => {});
    },
    onTurnOff: () => {
      setPendingActivate(false); // user explicitly said off — drop any queued click
      if (queueResolverTimer) { clearTimeout(queueResolverTimer); queueResolverTimer = null; }
      const btn = document.getElementById(BTN_ID);
      if (!overlayActive) {
        // Even if overlay was never on (queued click waiting), reset the
        // 'loading' indicator so the button doesn't lie about state.
        if (btn) setButtonState(btn, 'idle');
        return;
      }
      overlayActive = false;
      currentEp()?.setActiveSubUrl(null);
      stopSync();
      syncSubSuppression();   // keep CR subs hidden if "hide official" is on
      if (btn) setButtonState(btn, 'idle');
      setJpStatus(PROTOCOL.STATUS.READY);
    },
  });

  // Local availability check shared by tryAutoActivate and the menu module.
  // Returns true / null / false.
  function localeHasContent(locale) {
    const ep = currentEp();
    if (!ep) return false;
    if (locale === 'ja-JP') {
      if (ep.jpCaptionUrl || ep.jpSubtitleUrl) return true;
      return ep.jpGuid ? null : false;
    }
    return ep.catalog.availability(locale);
  }

  // ── Episode access ────────────────────────────────────────────────────────
  // Helpers that route through the current Episode (lib/episode.js).  Returns
  // the live episode or null when off /watch/.  Disposed Episodes — which exist
  // momentarily after SPA navigation while a stale fetch is still in flight —
  // silently absorb writes via Episode's internal disposed-guard.
  const getEpisodeGuid = () => window.location.pathname.match(/\/watch\/([^/]+)/)?.[1] ?? null;
  const currentEp      = () => EP.current();

  // storeSessionSubs is the most-called catalog op below; route through the
  // current Episode's catalog so the matrix lives with the right viewing.
  const storeSessionSubs = (audioLocale, subs) => {
    const ep = currentEp();
    if (ep) ep.catalog.recordSession(audioLocale, subs);
  };

  // ── Wrong-title detection + recovery (lib/wrong-title.js) ────────────────
  // Detection rule, alternate-session probe, and background validation sweep
  // all live in the wrong-title module.  These wrappers thread in the live
  // videoEl, the fetcher functions (fetchAndParseSubs / fetchSubUrlForSource
  // — defined further down in this file), and the menu-row update callback
  // that has to know about open-menu DOM.

  const validateSubDuration = (cues) =>
    WRONG_TITLE.validate(cues, videoEl?.duration ?? NaN);

  const tryAlternateSession = (lang) => WRONG_TITLE.findReplacement({
    lang,
    ep:                    currentEp(),
    fetchAndParseSubs,
    fetchSubUrlForSource,
    getVideoDurationSec:   () => videoEl?.duration ?? NaN,
    log:                   (msg) => log.info(msg),
  });

  let bgValidatePending = false;
  async function backgroundValidateAll() {
    if (bgValidatePending) return;
    const ep = currentEp();
    if (!ep) return;
    if (!videoEl || !(videoEl.duration >= 60)) {
      if (videoEl) videoEl.addEventListener('loadedmetadata', backgroundValidateAll, { once: true });
      return;
    }
    bgValidatePending = true;
    try {
      await WRONG_TITLE.validateAll({
        ep,
        getVideoDurationSec: () => videoEl?.duration ?? NaN,
        fetchAndParseSubs,
        fetchSubUrlForSource,
        onValidated:         (locale, status) => sourceMenu.updateRow(locale, status),
        log: (msg, level) =>
          level === 'warn' ? log.warn(msg) : log.info(msg),
      });
    } finally {
      bgValidatePending = false;
    }
  }

  // ── Anchor map cache ──────────────────────────────────────────────────────
  // Stores a compact array of {srcTime, refTime} pairs per (episode × srcSession
  // × audioSession).  One map retimes ANY subtitle language for that combination.
  // The cache key is composed by Episode (lib/episode.js) so the episode guid
  // is always read from the live Episode rather than re-derived from the URL.

  function loadAnchorMap(srcSession, audioLocale) {
    const ep = currentEp();
    if (!ep) return null;
    const v = STORAGE.lsGet(ep.anchorMapKey(srcSession, audioLocale));
    if (!v || !Array.isArray(v.anchors) || v.anchors.length < MIN_ANCHORS) return null;
    return { anchors: v.anchors, quality: v.quality, bridge: v.bridge };
  }

  function saveAnchorMap(srcSession, audioLocale, anchors, quality, bridge) {
    const ep = currentEp();
    if (!ep) return;
    STORAGE.lsSet(ep.anchorMapKey(srcSession, audioLocale), { anchors, quality, bridge }, ANCHOR_TTL);
  }

  // Returns the best subtitle URL for the given locale given what's currently
  // playing.  Same-language vs cross-language priority lives in the catalog
  // (lib/subtitle-catalog.js) — see urlFor() there.
  const getSubtitleUrl = (subtitleLocale) => currentEp()?.catalog.urlFor(subtitleLocale) ?? null;

  // Strip CDN auth parameters from a subtitle URL so two URLs for the same file
  // compare equal even when auth tokens differ (same file, re-signed).
  // Handles both Crunchyroll HMAC and AWS CloudFront signed URL formats.
  function subUrlBase(url) {
    if (!url) return '';
    return url
      .replace(/[?&]Policy=[^&]*/i, '')      // CloudFront Policy
      .replace(/[?&]Signature=[^&]*/i, '')   // CloudFront Signature
      .replace(/[?&]Key-Pair-Id=[^&]*/i, '') // CloudFront Key-Pair-Id
      .replace(/[~?&]hmac=[^&]*/i, '')       // HMAC param
      .replace(/[?&]$/, '');                 // trailing ? or &
  }

  // ── Anchor map remaster ────────────────────────────────────────────────────
  //
  // Builds a sparse set of {srcTime, refTime} pairs by text-matching identical
  // subtitle cues from two sessions.  These pairs define a piecewise-linear
  // time-remapping curve: any cue timestamp from the source session can be
  // interpolated onto the audio session's timeline.
  //
  // Unlike a single constant offset, this handles multiple cut points, scene
  // insertions/removals, and gradual timing drift within a single file.
  //
  // The anchor map is keyed by (episode × srcSession × audioSession) so ONE
  // computation retimes every subtitle language for that session pair.

  // ── Subtitle text fetcher ─────────────────────────────────────────────────
  // Pure timing algorithms (buildAnchorMap, interpolateTime, remasterCues,
  // computeMedianDelta) live in lib/remaster.js.  This file keeps the fetcher
  // because it threads through the Episode raw-text cache.

  /**
   * Fetch a subtitle file, parse it, and return cues.  Reuses the Episode's
   * session cache so repeated fetches of the same URL hit memory.
   */
  async function fetchAndParseSubs(url) {
    if (!url) return [];
    const ep = currentEp();
    let text = ep?.getCachedRawText(url);
    if (!text) {
      try {
        const resp = await originalFetch(url);
        if (!resp.ok) return [];
        text = await resp.text();
        ep?.setCachedRawText(url, text);
      } catch (_) { return []; }
    }
    return parseSubtitles(text, url);
  }

  // ── Remaster progress HUD ─────────────────────────────────────────────────
  // The DOM-level HUD primitive lives in lib/overlay-ui.js.  This file owns
  // the message-composition policy: which stats turn into which one-liner.

  let hudCtl = null;
  function ensureHud() {
    if (!hudCtl && renderer.element) hudCtl = UI.makeProgressHud(renderer.element);
    return hudCtl;
  }

  function updateProgress(step, total, desc) {
    ensureHud()?.update(step, total, desc);
  }

  function fadeOutHud() {
    hudCtl?.fade();
    hudCtl = null;
  }

  function showRemasterBadge(success, stats = {}) {
    const hud = ensureHud();
    if (!hud) return;

    if (stats.sameSession || stats.sameFile) {
      const detail = stats.sameSession
        ? `<span style="color:rgba(255,255,255,0.35);font-size:10px;"> — same session</span>`
        : `<span style="color:rgba(255,255,255,0.35);font-size:10px;"> — same video cut</span>`;
      hud.html(`<span style="color:#4caf50;">✓</span>  Subtitles already in sync${detail}`, 4000);
      return;
    }
    if (!success) {
      const reason = stats.reason ? `  <span style="color:rgba(255,255,255,0.4);font-size:10px;">${escapeHtml(String(stats.reason))}</span>` : '';
      hud.html(`<span style="color:#e55;">⚠</span>  Auto-sync unavailable${reason}`, 6000);
      return;
    }

    const cached     = stats.cached ? ' · cached' : '';
    const deltaStr   = stats.medianDelta != null
      ? `${stats.medianDelta >= 0 ? '+' : ''}${stats.medianDelta.toFixed(1)}s · `
      : '';
    const bridgeStr  = stats.bridge ? ` via ${escapeHtml(String(stats.bridge))}` : '';
    hud.html(
      `<div style="color:#ff6b35;font-weight:700;">✓  Auto-sync validated${bridgeStr}</div>` +
      `<div style="color:rgba(255,255,255,0.45);font-size:10px;margin-top:2px;">` +
        `${deltaStr}${stats.count} anchors · ${stats.quality}% coverage${cached}` +
      `</div>`,
      7000
    );
  }

  // ── Master remaster orchestrator ──────────────────────────────────────────
  /**
   * Remaster the current subtitle file to match the audio session's cut.
   *
   * Process:
   *   1. Identify which session the loaded subtitle came from.
   *   2. If same session as audio → no remaster needed.
   *   3. Check localStorage for a cached anchor map.
   *   4. If not cached: find bridging language, fetch both copies, build anchors.
   *   5. Apply anchor map to retime every cue individually (piecewise-linear).
   *   6. Save anchor map to localStorage (30-day TTL).
   *   7. Display progress HUD and completion badge.
   */
  async function runRemaster(cues, loadedUrl, subLang) {
    const ep = currentEp();
    if (!ep) return;
    const catalog     = ep.catalog;
    const audioLocale = catalog.currentAudio();
    if (!audioLocale || !cues.length) return;
    // Stale check: the originalCues array reference may have been replaced by a
    // newer parse (source switch).  If so, this remaster's input is no longer
    // current — bail before clobbering the new state.
    const isStale = () => cues !== ep.originalCues || ep.disposed;

    log.info(`Remaster: starting — audio=[${audioLocale}] sub=[${subLang ?? 'ja-JP'}] cues=${cues.length}`);
    log.info(`Remaster: catalog sessions = [${catalog.entries().map(([s]) => s).join(', ')}]`);
    for (const [sess, row] of catalog.entries()) {
      log.info(`  [${sess}] has: [${Object.keys(row).join(', ')}]`);
    }

    // ── 1. Identify source session ──────────────────────────────────────────
    const found = catalog.findSession(loadedUrl, subUrlBase);
    let srcSession = found?.session ?? null;
    let srcLang    = found?.lang ?? subLang ?? null;
    if (!srcSession) {
      const loadedBase = subUrlBase(loadedUrl);
      const jpBase = subUrlBase(ep.jpSubtitleUrl ?? '') || subUrlBase(ep.jpCaptionUrl ?? '');
      if (jpBase && loadedBase === jpBase) { srcSession = 'ja-JP'; }
      else { log.info('Remaster: source session not found in catalog — cannot sync'); return; }
    }
    log.info(`Remaster: srcSession=[${srcSession}] srcLang=[${srcLang}]`);

    // ── 2. Same session as audio → correct by definition ──────────────────
    if (srcSession === audioLocale) {
      log.info(`Remaster: same session (${srcSession}) — no adjustment`);
      ep.setRemasterForAudio(audioLocale);
      refreshButtonLabel();
      showRemasterBadge(true, { sameSession: true });
      return;
    }

    // ── 3. Check localStorage cache ────────────────────────────────────────
    const cached = loadAnchorMap(srcSession, audioLocale);
    if (cached) {
      log.info(`Remaster: cached anchor map (${cached.anchors.length} anchors, ${cached.quality}% cov)`);
      ep.setRemasteredCues(remasterCues(cues, cached.anchors), audioLocale);
      renderer.invalidate();
      onTimeUpdate();
      refreshButtonLabel();
      showRemasterBadge(true, {
        cached: true, quality: cached.quality,
        count:  cached.anchors.length, bridge: cached.bridge,
        medianDelta: computeMedianDelta(cached.anchors),
      });
      return;
    }

    // ── 4. Full async remaster ─────────────────────────────────────────────
    const sourceRow = catalog.rowFor(srcSession);
    const audioRow  = catalog.rowFor(audioLocale);

    updateProgress(1, 8, 'Detecting session mismatch');
    updateProgress(2, 8, 'Finding reference language');

    const bridge = catalog.findBridge(srcSession, audioLocale);
    log.info(`Remaster: bridge lang = [${bridge ?? 'none'}]  sourceRow=[${Object.keys(sourceRow).join(', ')}]  audioRow=[${Object.keys(audioRow).join(', ')}]`);
    if (!bridge) {
      showRemasterBadge(false, { reason: 'No shared language between sessions' });
      return;
    }

    const srcBridgeUrl = sourceRow[bridge];
    const refBridgeUrl = audioRow[bridge];

    if (subUrlBase(srcBridgeUrl) === subUrlBase(refBridgeUrl)) {
      log.info(`Remaster: bridge files identical → same timing, no adjustment`);
      ep.setRemasterForAudio(audioLocale);
      refreshButtonLabel();
      showRemasterBadge(true, { sameFile: true });
      return;
    }

    updateProgress(3, 8, `Fetching source ref  (${bridge})`);
    const srcBridgeCues = (bridge === srcLang && cues.length)
      ? cues
      : await fetchAndParseSubs(srcBridgeUrl);
    if (isStale()) return;
    if (srcBridgeCues.length < 3) {
      showRemasterBadge(false, { reason: `Source reference unavailable (${bridge})` });
      return;
    }

    updateProgress(4, 8, `Fetching audio ref  (${bridge})`);
    const refBridgeCues = await fetchAndParseSubs(refBridgeUrl);
    if (isStale()) return;

    // ── Sparse-reference fallback ─────────────────────────────────────────
    // Non-JP audio sessions only carry their own native-language subtitle as a
    // signs-only track (< 30 cues), so the bridge reference is always sparse.
    // If we can't get enough text-matching anchors but it looks like the
    // signs-only case, assume Crunchyroll's same-cut policy and accept.
    const isSparseRef = refBridgeCues.length < 30;

    updateProgress(5, 8, `Building timing anchors`);
    const anchorMap = buildAnchorMap(srcBridgeCues, refBridgeCues);

    if (anchorMap.length < MIN_ANCHORS) {
      if (isSparseRef && bridge === audioLocale) {
        log.info(`Remaster: sparse signs-only bridge (${refBridgeCues.length} cues) — assuming same timing`);
        ep.setRemasterForAudio(audioLocale);
        refreshButtonLabel();
        showRemasterBadge(true, { sameFile: true });
        return;
      }
      showRemasterBadge(false, { reason: `Too few anchors (${anchorMap.length}/${MIN_ANCHORS} required)` });
      return;
    }

    updateProgress(6, 8, `Retiming ${cues.length} cues`);
    const remastered = remasterCues(cues, anchorMap);

    updateProgress(7, 8, 'Validating coverage');
    const eligibleSrc = srcBridgeCues.filter(c => normalizeSubText(c.text).length >= 8).length;
    const coverage    = Math.min(100, Math.round(anchorMap.length / Math.max(eligibleSrc, 1) * 100));
    const medianDelta = computeMedianDelta(anchorMap);

    updateProgress(8, 8, 'Saving to local cache');
    saveAnchorMap(srcSession, audioLocale, anchorMap, coverage, bridge);

    ep.setRemasteredCues(remastered, audioLocale);
    renderer.invalidate();
    onTimeUpdate();
    refreshButtonLabel();

    showRemasterBadge(true, { quality: coverage, count: anchorMap.length, bridge, medianDelta });
    log.info(
      `Remaster: ${anchorMap.length} anchors · ${coverage}% cov · Δ${medianDelta.toFixed(2)}s · [${srcSession}→${audioLocale}] via ${bridge}`
    );
  }

  const allKnownSubtitleLocales = () => currentEp()?.catalog.allSubtitleLocales() ?? new Set();

  // ── Settings readers ──────────────────────────────────────────────────────
  // Thin per-key wrappers around SETTINGS.read so call sites stay readable.
  // Schema lives in lib/settings-schema.js.
  const html = document.documentElement;

  const isEnabled              = () => SETTINGS.read(html, 'enabled');
  const isAutoActivate         = () => SETTINGS.read(html, 'autoActivate');
  const isHideOfficialSubs     = () => SETTINGS.read(html, 'hideOfficialSubs');
  const getSubScale            = () => SETTINGS.read(html, 'subScale');
  const getSyncOffset          = () => SETTINGS.read(html, 'subOffset');
  const getSubBottomFloor      = () => SETTINGS.read(html, 'subBottomFloor');
  const isStyleOverride        = () => SETTINGS.read(html, 'styleOverride');
  const getOverrideFont        = () => SETTINGS.read(html, 'overrideFontFamily');
  const getOverrideColor       = () => SETTINGS.read(html, 'overrideTextColor');
  const getOverrideTextOp      = () => SETTINGS.read(html, 'overrideTextOpacity') / 100;
  const getOverrideOutline     = () => SETTINGS.read(html, 'overrideOutlineColor');
  const getOverrideBord        = () => SETTINGS.read(html, 'overrideBord');
  const getOverrideShad        = () => SETTINGS.read(html, 'overrideShad');
  const getOverrideShadStyle   = () => SETTINGS.read(html, 'overrideShadStyle');
  const getOverrideShadOp      = () => SETTINGS.read(html, 'overrideShadOpacity') / 100;
  const isOverrideBgBox        = () => SETTINGS.read(html, 'overrideBgBox');
  const getOverrideBgColor     = () => SETTINGS.read(html, 'overrideBgColor');
  const getOverrideBgOp        = () => SETTINGS.read(html, 'overrideBgOpacity') / 100;
  const getOverrideBgRadius    = () => SETTINGS.read(html, 'overrideBgRadius');
  const getOverrideBgPaddingX  = () => SETTINGS.read(html, 'overrideBgPaddingX');
  const getOverrideBgPaddingY  = () => SETTINGS.read(html, 'overrideBgPaddingY');
  const isOverrideBgGlass      = () => SETTINGS.read(html, 'overrideBgGlass');
  const getOverrideBgGlassBlur = () => SETTINGS.read(html, 'overrideBgGlassBlur');
  const getOverrideBgGlassSat  = () => SETTINGS.read(html, 'overrideBgGlassSat');
  const getOverrideBgGlassHue  = () => SETTINGS.read(html, 'overrideBgGlassHue');

  // hexToRgba lives in lib/cue-style.js — aliased near the top of this file.

  // ── Status reporting ───────────────────────────────────────────────────────
  function setJpStatus(status) {
    html.setAttribute(PROTOCOL.ATTR.JP_STATUS, status);
    html.setAttribute(PROTOCOL.ATTR.JP_ACTIVE, status === PROTOCOL.STATUS.ACTIVE ? 'true' : 'false');
    updateActiveInfo();
  }

  // Write a JSON-encoded snapshot of "what's playing right now" so the
  // popup can show source / audio / remaster state under the status pill.
  // Called whenever any of those change.  Safe to over-call — same JSON
  // string just overwrites the attribute idempotently.
  let _lastActiveInfo = '';
  function updateActiveInfo() {
    const ep = currentEp();
    const info = {
      source:   ep?.activeSource()      ?? null,
      audio:    ep?.catalog.currentAudio() ?? null,
      // remasterForAudio matches currentAudio when remaster has produced
      // cues for the active session.  Anything else means we either
      // didn't need to remaster (same-session) or it failed / isn't done.
      remaster: ep?.remasterForAudio
        ? (ep.remasterForAudio === ep.catalog.currentAudio() ? 'synced' : 'pending')
        : null,
      overlay:  overlayActive ? 'on' : 'off',
    };
    const json = JSON.stringify(info);
    if (json === _lastActiveInfo) return;
    _lastActiveInfo = json;
    html.setAttribute(PROTOCOL.ATTR.ACTIVE_INFO, json);
  }

  setJpStatus(PROTOCOL.STATUS.NONE);
  updateActiveInfo();

  // ── Helpers ────────────────────────────────────────────────────────────────
  function extractAuthHeader(init) {
    const src = init?.headers;
    if (!src) return {};
    const get = k => src instanceof Headers ? src.get(k) : src[k];
    const auth = get('Authorization') || get('authorization');
    return auth ? { Authorization: auth } : {};
  }

  // Strip characters that could break a CSS font-family declaration.
  // Allows letters, digits, spaces, commas, hyphens, apostrophes, and periods —
  // everything a valid font stack needs, nothing a CSS injection attack needs.
  function sanitizeFontFamily(s) {
    if (!s) return '';
    return s.replace(/[^a-zA-Z0-9 ,'\-\.]/g, '').trim();
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── SPA navigation ────────────────────────────────────────────────────────
  // Episode lifecycle (lib/episode.js) drives the per-viewing reset.  Page-chrome
  // teardown (renderer overlay, button DOM, observers) lives here because the
  // Episode does not own DOM.  Disposed Episodes silently absorb any late writes
  // from in-flight fetches via Episode's internal disposed-guard.
  function teardownPageChrome() {
    if (videoEl) videoEl.removeEventListener('play', tryAutoActivate);
    stopSync();
    overlayActive    = false;
    clickInProgress  = false;
    videoEl          = null;
    buttonInControls = false;
    movedToControls  = false;
    subSuppression.deactivate();
    bgValidatePending = false;
    pendingActivate   = false;
    if (queueResolverTimer) { clearTimeout(queueResolverTimer); queueResolverTimer = null; }
    clearTimeout(settleTimer); settleTimer = null;
    sourceMenu.close();
    sourceMenu.removeButton();
    renderer.unmount();
    document.getElementById(BTN_ID)?.remove();
    if (_errorToast) { try { _errorToast.remove(); } catch (_) {} _errorToast = null; }
    hudCtl    = null;
    setJpStatus(PROTOCOL.STATUS.NONE);
  }

  let lastWatchPath = window.location.pathname;
  // Pulls the slug from /watch/<guid>/<slug>.  Used to detect dub switches:
  // every audio dub of the same episode has its own guid but the slug stays
  // the same.  Returns null if the path isn't a /watch/ URL.
  const getWatchSlug = (path) => path.match(/\/watch\/[^/]+\/([^?#/]+)/)?.[1] ?? null;

  function handleNavigation() {
    const newPath  = window.location.pathname;
    if (newPath === lastWatchPath) return;
    const oldPath  = lastWatchPath;
    const wasWatch = oldPath.includes('/watch/');
    const isWatch  = newPath.includes('/watch/');
    lastWatchPath  = newPath;
    if (!wasWatch && !isWatch) return;

    // Cross-dub recovery: if old and new URLs share the same slug, the user
    // just switched audio dub — the underlying episode is identical, and
    // critically the JP guid mapping carries over.  Snapshot it before the
    // old Episode is disposed, then plant it in the new Episode's storage so
    // the next captured auth fetch can trigger a JP prefetch even when
    // Crunchyroll's player doesn't refetch the playback endpoint (it often
    // doesn't on dub switch — it just swaps audio tracks in the loaded
    // DASH manifest, so our PLAYBACK_RE intercept never fires).
    const priorEp        = EP.current();
    const oldSlug        = getWatchSlug(oldPath);
    const newSlug        = getWatchSlug(newPath);
    // Same slug, different guid → audio-dub switch; the Japanese version (and so
    // the JP subtitle source) is shared across every dub of the episode.  Prefer
    // the prior Episode's resolved jpGuid, but fall back to its cached guid-map:
    // when switching FROM the JP dub, jpGuid is often never set (its caption
    // comes straight from the current session), yet the map still points at the
    // JP version — without this fallback the carry is skipped, the new dub's map
    // is never written, and auto-activate has no guid to bootstrap from.
    // Snapshot the prior Episode's JP guid + auth BEFORE it is disposed, then
    // remember it keyed by the episode SLUG.  This is the crux of cross-dub
    // recovery: Crunchyroll routes a dub switch through a TWO-STEP navigation
    // that drops the slug in between — /watch/<slug> → /watch/<newGuid> (no
    // slug) → /watch/<newGuid>/<slug>.  The same-nav carry (oldSlug === newSlug)
    // can NEVER fire across that, and the episode holding the resolved JP guid is
    // disposed on the slug-less hop, so the mapping was lost on every switch.  A
    // slug-keyed memory survives the intermediate hop; the session token is
    // shared across dubs, so the auth carries too.
    const priorJp = priorEp ? (priorEp.jpGuid ?? priorEp.getMappedJpGuid?.() ?? null) : null;
    const priorAuth = priorEp
      ? ((priorEp.capturedAuth && Object.keys(priorEp.capturedAuth).length) ? priorEp.capturedAuth
         : (priorEp.authHeaders && Object.keys(priorEp.authHeaders).length) ? priorEp.authHeaders
         : null)
      : null;
    if (oldSlug && (priorJp || priorAuth)) {
      const prev = slugJpMemo.get(oldSlug) || {};
      rememberSlug(oldSlug, { jpGuid: priorJp || prev.jpGuid || null, auth: priorAuth || prev.auth || null });
    }

    const carryJpGuid = (wasWatch && isWatch && oldSlug && oldSlug === newSlug) ? priorJp : null;

    log.info(`SPA nav ${oldSlug || '-'} → ${newSlug || '-'} | priorJpGuid=${priorEp?.jpGuid || '-'} priorMapped=${priorEp?.getMappedJpGuid?.() || '-'} priorAuth=${!!priorAuth} carry=${carryJpGuid || '-'} memo=${(newSlug && slugJpMemo.get(newSlug)?.jpGuid) || '-'}`);
    teardownPageChrome();
    EP.disposeCurrent();
    const guid = getEpisodeGuid();
    if (guid) {
      const ep = EP.start(guid);
      // Plant the JP guid + auth: prefer the same-nav carry, else the slug memory
      // (which survives the slug-less intermediate hop the carry can't).  A stale
      // token just 401s and we fall back to the reload path.  setMappedJpGuid also
      // caches the guid→jp map, so once a dub is mapped this way it self-heals on
      // its next visit.
      const memo        = newSlug ? slugJpMemo.get(newSlug) : null;
      const plantJpGuid = carryJpGuid || memo?.jpGuid || null;
      const plantAuth   = priorAuth || memo?.auth || null;
      if (plantJpGuid) {
        ep.setMappedJpGuid(plantJpGuid);
        if (plantAuth) { ep.setCapturedAuth(plantAuth); ep.setAuthHeaders(plantAuth); }
        log.info(`Planting JP guid ${plantJpGuid}${plantAuth ? ' + auth' : ''}${carryJpGuid ? ' (carry)' : ' (slug memo)'} (slug=${newSlug || '-'}).`);
        // Prefetch now whenever we can actually fetch it (cached → no auth needed,
        // or we have auth for a live fetch).  Skipping when we have neither avoids
        // latching prefetchTriggered on a doomed attempt.
        if (ep.getCachedJpData?.(plantJpGuid) || plantAuth) {
          maybePrefetch().catch(() => {});
        }
      }
    }
    // Backstop for rapid switching: re-attempt auto-activate once the user
    // stops switching, so the dub they finally landed on always gets its subs.
    scheduleSettle();
  }

  // Bounded retry of auto-activate, reset on every navigation.  Once switching
  // has been quiet for SETTLE_MS it nudges tryAutoActivate (which self-heals
  // from the cached mapping or drives the live fetch), then keeps retrying every
  // SETTLE_MS until the overlay is up or SETTLE_MAX attempts are exhausted —
  // covering metadata-not-ready, in-flight-fetch, and cut-short-bootstrap races
  // from a faster subsequent switch.  Converges instead of giving up after one
  // shot.
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleAttempts = 0;
    settleTimer = setTimeout(settleTick, SETTLE_MS);
  }
  function settleTick() {
    settleTimer = null;
    if (overlayActive) return;                 // subs are up — done
    tryAutoActivate();
    if (overlayActive) return;
    if (++settleAttempts < SETTLE_MAX) {
      settleTimer = setTimeout(settleTick, SETTLE_MS);
    } else {
      // Genuinely couldn't load JP (no auth + no cache → needs a reload).  Clear
      // the 'loading' flash so the button doesn't sit spinning forever.
      const ep = currentEp();
      const btn = document.getElementById(BTN_ID);
      if (btn && btn.dataset.state === 'loading' &&
          (!ep || (!ep.jpCaptionUrl && !ep.jpSubtitleUrl))) {
        log.warn('Settle: JP subs did not load after retries — clearing loading state.');
        applyButtonState(btn, 'idle');
      }
    }
  }

  // Construct the initial Episode at script start so any code that runs before
  // the first SPA navigation (auto-activate, prefetch, fetch intercept) finds a
  // live Episode.  No-op if not on /watch/.
  {
    const initGuid = getEpisodeGuid();
    if (initGuid) EP.start(initGuid);
  }

  const origPushState    = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);
  history.pushState    = function (...a) { origPushState(...a);    handleNavigation(); };
  history.replaceState = function (...a) { origReplaceState(...a); handleNavigation(); };
  window.addEventListener('popstate', handleNavigation);

  // ── Keyboard shortcut relay (from content.js via postMessage) ──────────────
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== PROTOCOL.POST.CR_SUB_TOGGLE || e.data?.token !== TOGGLE_TOKEN) return;
    const btn = document.getElementById(BTN_ID);
    if (btn) handleButtonClick(btn).catch(() => {});
  });

  // ── In-player 'C' shortcut ────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== 'c' && e.key !== 'C') return;
    const tgt = e.target;
    if (tgt.isContentEditable ||
        tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return;
    if (!isEnabled()) return;
    const btn = document.getElementById(BTN_ID);
    if (btn && !clickInProgress) {
      e.preventDefault();
      handleButtonClick(btn).catch(() => {});
    }
  });

  // ── Live re-render on settings changes ────────────────────────────────────
  // content.js writes to the data-cr-* attributes; this observer invalidates
  // the renderer's cue cache so the next timeupdate re-renders at the new
  // style/size.
  new MutationObserver(() => {
    renderer.invalidate();
    if (overlayActive) onTimeUpdate();
    // If autoActivate just flipped on (or was always on but the attribute
    // hadn't been written yet when JP data first landed), give it another
    // shot now that the attribute reflects the real setting.
    tryAutoActivate();
    // Pick up live changes to "hide official subs" (and the master enable
    // toggle) without waiting for the overlay to be touched.
    syncSubSuppression();
  }).observe(html, { attributes: true, attributeFilter: SETTINGS.ATTRS });

  // Called from the playback / JP-first / prefetch success paths after JP
  // data lands.  Does two things:
  //   1. If the button got stuck in 'unavail' from an earlier dub-switch
  //      playback response that didn't list ja-JP (Crunchyroll API quirk),
  //      reset it to 'idle' — JP turned out to be available after all.
  //   2. If the user clicked JP CC while data was loading, fire the queued
  //      activation now.
  function onJpDataReady() {
    const ep = currentEp();
    if (!ep || ep.disposed) { setPendingActivate(false); return; }
    if (!ep.jpCaptionUrl && !ep.jpSubtitleUrl && !ep.jpGuid) return;

    if (queueResolverTimer) { clearTimeout(queueResolverTimer); queueResolverTimer = null; }

    const btn = document.getElementById(BTN_ID);
    if (btn && btn.dataset.state === 'unavail') {
      log.info('JP data arrived — clearing stuck `unavail` button state.');
      setButtonState(btn, 'idle');
      setJpStatus(PROTOCOL.STATUS.READY);
    }

    if (pendingActivate) {
      setPendingActivate(false);
      clickInProgress = false; // released so handleButtonClick can re-enter
      if (btn) {
        log.info('JP data ready — firing queued JP CC click.');
        handleButtonClick(btn).catch(() => {});
      }
    }
  }

  // Queue stuck because Crunchyroll never fired /playback/v3/ for the new
  // dub (a common case — the player swaps audio in the loaded DASH manifest
  // instead of refetching).  After QUEUE_RESOLVE_MS we self-trigger the
  // playback fetch with the current Episode's guid + captured auth.  Our
  // own fetch wrapper sees it (it's the same window.fetch), runs the
  // normal playback intercept logic, populates the catalog and JP data —
  // which fires onJpDataReady and resolves the queue.
  function scheduleQueueResolver() {
    if (queueResolverTimer) return;
    queueResolverTimer = setTimeout(async () => {
      queueResolverTimer = null;
      if (!pendingActivate) return;
      const ep = currentEp();
      if (!ep || ep.disposed) { setPendingActivate(false); return; }

      const auth = ep.authHeaders ?? ep.capturedAuth ?? null;
      if (!auth) {
        log.info('Queue resolver: no captured auth yet — staying queued.');
        return;
      }

      // If we already have a cached JP guid mapping, prefetch directly —
      // cheaper than a full playback request for the current dub.
      if (ep.getMappedJpGuid?.() && !ep.jpCaptionUrl) {
        log.info('Queue resolver: retrying JP prefetch with cached mapping.');
        maybePrefetch().catch(() => {});
        return;
      }

      // No cached JP mapping — self-trigger a playback fetch for the
      // current guid so the catalog gets the data Crunchyroll didn't fetch.
      if (!ep.guid) return;
      log.info(`Queue resolver: self-triggering playback fetch for ${ep.guid}.`);
      try {
        await window.fetch(
          `https://www.crunchyroll.com/playback/v3/${ep.guid}/web/chrome/play`,
          { credentials: 'include', headers: auth }
        );
      } catch (err) {
        log.warn('Queue resolver fetch error:', err);
      }
    }, QUEUE_RESOLVE_MS);
  }

  // ── Auto-activate ──────────────────────────────────────────────────────────
  function tryAutoActivate() {
    const ep = currentEp();
    if (!ep) return;
    if (!isAutoActivate() || !ep.shouldAutoActivate() || overlayActive || clickInProgress) {
      if (!overlayActive) log.info(`autoActivate bail: auto=${isAutoActivate()} should=${ep.shouldAutoActivate()} clicking=${clickInProgress}`);
      return;
    }
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (!ep.jpCaptionUrl && !ep.jpSubtitleUrl) {
      // No JP URLs loaded yet — but if a guid mapping exists (carried across a
      // dub switch, or cached from a prior visit) and we can actually fetch it
      // (cached → no auth needed, or we have captured auth for a live fetch),
      // drive the prefetch now.  This recovers dub switches whose JP fetch never
      // fired (e.g. the playback-vs-pushState ordering race) and, via the settle
      // retry + the released prefetch latch, keeps retrying until it lands —
      // instead of leaving the button idle until a manual reload.  maybePrefetch
      // self-gates and, on success, re-calls tryAutoActivate → which activates.
      const jpGuid = ep.getMappedJpGuid?.();
      const canFetch = !!(jpGuid && (ep.getCachedJpData?.(jpGuid) || ep.capturedAuth));
      log.info(`autoActivate: no JP urls — jpGuid=${jpGuid || '-'} cached=${!!(jpGuid && ep.getCachedJpData?.(jpGuid))} auth=${!!ep.capturedAuth} → ${canFetch ? 'prefetch' : 'WAIT (nothing to fetch)'}`);
      if (canFetch) {
        // Ready cue: show 'loading' so the user sees subs are coming.  Only from
        // idle so we never stomp a 'reload'/'unavail'/'error' message.
        if (btn.dataset.state === 'idle') setButtonState(btn, 'loading');
        maybePrefetch().catch(() => {});
      }
      return;
    }
    // Defer until video metadata is loaded so duration-based subtitle validation
    // has an accurate video length to compare against.
    if (videoEl && !(videoEl.duration >= 60)) {
      videoEl.addEventListener('loadedmetadata', tryAutoActivate, { once: true });
      return;
    }
    log.info(`Auto-activating (audio=${ep.catalog.currentAudio()}, source=${ep.activeSource()}).`);
    // Ready cue: show 'loading' before activating so the flash fires even when JP
    // is already loaded (the min-duration wrapper holds it briefly, then '✓').
    if (btn.dataset.state === 'idle') setButtonState(btn, 'loading');
    // Restore the last-used subtitle locale, but only if it is actually available
    // for this episode.  A saved locale from a different episode (e.g. ca-ES that
    // only some shows carry) must not be applied here — fall back to default JP.
    try {
      const saved = localStorage.getItem(LOCALE_PREF_KEY);
      if (saved && saved !== ep.activeSource()) {
        const avail = localeHasContent(saved);
        if (avail !== false) {          // true (ready) or null (fetchable) — proceed
          ep.setActiveSource(saved);
          ep.clearCues();
          renderer.invalidate();
        } else {
          localStorage.removeItem(LOCALE_PREF_KEY);
        }
      }
    } catch (_) {}
    // Mark only on actual activation success.  Marking optimistically before
    // the click resolved meant a failed/raced activation would still latch
    // autoActivatedFor — and subsequent dub switches would silently bail
    // because shouldAutoActivate() saw the stale latch.
    handleButtonClick(btn).then(() => {
      if (!ep.disposed && overlayActive) ep.markAutoActivated();
    }).catch(() => {});
  }

  // ── Pre-fetch JP data ──────────────────────────────────────────────────────
  async function maybePrefetch() {
    const ep = currentEp();
    if (!ep) return;
    if (ep.prefetchTriggered || ep.jpCaptionUrl) return;
    const jpGuid = ep.getMappedJpGuid();
    if (!jpGuid) return;

    ep.markPrefetchTriggered();
    const auth = ep.capturedAuth ?? {};
    log.info(`Pre-fetching JP data (ep: ${ep.guid}, jp: ${jpGuid})`);
    let loaded = false;
    try {
      const jpData = await fetchAndCacheJpData(jpGuid, auth);
      if (ep.disposed) return;
      if (jpData?.jpRow) storeSessionSubs('ja-JP', jpData.jpRow);
      if (jpData?.captionUrl || jpData?.subtitleUrl) {
        ep.setJpUrls(jpData.captionUrl ?? null, jpData.subtitleUrl ?? null);
        ep.setJpGuid(jpGuid);
        ep.setAuthHeaders(auth);
        setJpStatus(PROTOCOL.STATUS.READY);
        log.info('JP pre-loaded. Caption:', ep.jpCaptionUrl, '| Sub:', ep.jpSubtitleUrl);
        loaded = true;
        tryAutoActivate();
        onJpDataReady();
        backgroundValidateAll().catch(() => {});
      } else {
        log.warn('Pre-fetch: no EN URL — other subtitle languages may still be available.');
      }
    } catch (err) {
      log.warn('Pre-fetch error:', err);
    } finally {
      // Don't strand recovery: if this attempt didn't load JP (no auth yet, or a
      // transient failure on a rapid switch), release the latch so the settle
      // retry — or a later auth capture — can try again.
      if (!loaded && !ep.disposed) ep.clearPrefetchTriggered();
    }
  }

  // ── JP session fetch ───────────────────────────────────────────────────────
  async function releaseSession(jpGuid, token, authHeaders) {
    try {
      await originalFetch(
        `https://www.crunchyroll.com/playback/v1/token/${jpGuid}/${token}`,
        { method: 'DELETE', credentials: 'include', headers: authHeaders }
      );
      log.info('JP session released:', token);
    } catch (_) {}
  }

  async function fetchAndCacheJpData(jpGuid, authHeaders) {
    const ep = currentEp();
    const cached = ep?.getCachedJpData(jpGuid);
    if (cached && 'jpRow' in cached) {
      // If jpRow is empty but we have a subtitle URL, the cache was built before the
      // string-format URL fix. Invalidate once per session so the next visit re-fetches.
      const retryKey = 'crSubFix_jpRowRefreshed_' + jpGuid;
      if (Object.keys(cached.jpRow).length === 0 &&
          (cached.captionUrl || cached.subtitleUrl) &&
          !STORAGE.ssHas(retryKey)) {
        STORAGE.ssSet(retryKey, '1');
        ep?.evictCachedJpData(jpGuid);
        log.info(`Stale empty jpRow for ${jpGuid} — evicting cache for re-fetch.`);
        // Fall through to live fetch below
      } else {
        log.info('JP data from cache.');
        return cached;
      }
    }

    const resp = await originalFetch(
      `https://www.crunchyroll.com/playback/v3/${jpGuid}/web/chrome/play`,
      { credentials: 'include', headers: authHeaders }
    );

    if (!resp.ok) {
      log.warn(`JP session fetch failed (${resp.status}).`);
      return { captionUrl: null, subtitleUrl: null, jpRow: {}, fetchFailed: true };
    }

    const data = await resp.json();
    if (data.token) releaseSession(jpGuid, data.token, authHeaders);

    const captionUrl  = PLAYBACK.pickEn(data.captions);
    const subtitleUrl = PLAYBACK.pickEn(data.subtitles);

    const jpRow = PLAYBACK.subtitleMap(data);

    log.info(`JP session subtitle locales [${Object.keys(jpRow).join(', ') || 'none'}]`);
    if (!captionUrl && !subtitleUrl)
      log.warn('JP session has no EN subtitle/caption track — other languages may still be available.');

    currentEp()?.setCachedJpData(jpGuid, captionUrl, subtitleUrl, jpRow);
    return { captionUrl, subtitleUrl, jpRow, fetchFailed: false };
  }

  // Lazily fetch the subtitle URL for a non-JP dub source.
  // Returns { url, fetchFailed, rateLimited }.
  async function fetchSubUrlForSource(guid, targetLocale, authHeaders) {
    const ep = currentEp();
    const cached = ep?.getCachedSrcUrl(guid, targetLocale);
    if (cached?.url) {
      log.info(`${targetLocale} sub URL from cache.`);
      return { url: cached.url, fetchFailed: false, rateLimited: false };
    }

    const resp = await originalFetch(
      `https://www.crunchyroll.com/playback/v3/${guid}/web/chrome/play`,
      { credentials: 'include', headers: authHeaders }
    );

    if (!resp.ok) {
      const rateLimited = resp.status === 429 || resp.status === 420;
      log.warn(`${targetLocale} session fetch failed (${resp.status}).`);
      return { url: null, fetchFailed: true, rateLimited };
    }

    const data = await resp.json();
    if (data.token) releaseSession(guid, data.token, authHeaders);

    const sessionSubs = PLAYBACK.subtitleMap(data);

    // Store the complete row in the catalog indexed by this session's audio locale.
    const sessionAudio = data.audioLocale ?? targetLocale;
    storeSessionSubs(sessionAudio, sessionSubs);
    log.info(`${sessionAudio} session subtitle locales [${Object.keys(sessionSubs).join(', ') || 'none'}]`);

    const url = sessionSubs[targetLocale] ?? null;
    if (url) currentEp()?.setCachedSrcUrl(guid, targetLocale, url);
    return { url, fetchFailed: false, rateLimited: false };
  }

  // ── DASH manifest swap ─────────────────────────────────────────────────────
  function swapVttInManifest(xml, jpCaptionUrl) {
    return xml.replace(
      /(<AdaptationSet[^>]*mimeType="text\/vtt"[^>]*>[\s\S]*?<BaseURL>)[^<]*([\s\S]*?<\/AdaptationSet>)/,
      (_, before, after) => `${before}${jpCaptionUrl}${after}`
    );
  }

  // "Hide official" path: remove every text/vtt AdaptationSet so Crunchyroll's
  // player has no subtitle track to fetch or render at all.  This is the only
  // reliable way to suppress CR's subs on the newer player, whose renderer lives
  // where our CSS/DOM suppression can't reach — our overlay becomes the sole
  // subtitle display.
  function blankVttInManifest(xml) {
    return xml.replace(
      /<AdaptationSet\b[^>]*mimeType="text\/vtt"[^>]*>[\s\S]*?<\/AdaptationSet>/g,
      ''
    );
  }

  // ── Subtitle parsing ──────────────────────────────────────────────────────
  // ASS / WebVTT parsers, color utils, and normalizeSubText all live in
  // lib/subtitle-parser.js — aliased near the top of this file.

  // ── Subtitle overlay ───────────────────────────────────────────────────────
  // Per-frame Cue render, overlay DOM lifecycle, and the cue-key cache live in
  // lib/cue-renderer.js.  This file owns the timeupdate dispatch and the style
  // context capture — both need access to settings + Episode, which the
  // renderer is deliberately ignorant of.

  function onTimeUpdate() {
    if (!overlayActive || !videoEl) return;
    const ep = currentEp();
    if (!ep) return;
    const offset = getSyncOffset();
    const active = ep.cuesAt(videoEl.currentTime, offset);
    renderer.render(active, videoEl.currentTime + offset, captureStyleCtx());
  }

  // Race fix: the first paint after toggling JP CC on can land BEFORE
  // content.js's async chrome.storage.local.get → SETTINGS.writeAttrs
  // has populated the data-cr-* attributes.  When that happens,
  // captureStyleCtx reads schema defaults and the cue-key cache then
  // suppresses re-renders until the user moves a slider (which
  // triggers a fresh attribute write via the popup → content.js flow).
  //
  // Paint once now, then re-render a few times over the next ~half
  // second so any in-flight attribute writes land before the user
  // notices.  Each retry is cheap: invalidate + capture + render.
  function paintWithSettingsCatchup() {
    onTimeUpdate();
    // Retries extended to 2.5s with more intermediate points — covers
    // slow cold-start storage roundtrips that the previous 500ms ceiling
    // could miss.  Each pass is cheap (attribute reads + SVG element
    // creation for the visible cues).
    [16, 80, 200, 400, 700, 1100, 1700, 2500].forEach(delay => setTimeout(() => {
      if (overlayActive) { renderer.invalidate(); onTimeUpdate(); }
    }, delay));
  }

  function startSync() {
    if (!videoEl) return;
    videoEl.addEventListener('timeupdate', onTimeUpdate);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  function stopSync() {
    if (videoEl) videoEl.removeEventListener('timeupdate', onTimeUpdate);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    renderer.hide();
    // Clearing remaster state on stopSync forces a fresh anchor map calculation
    // on the next activation — preserves the existing behaviour where toggling
    // off and back on after a navigation can re-discover bridge timing.
    currentEp()?.clearRemaster();
  }

  function onFullscreenChange() {
    sourceMenu.close();
    const fsEl = document.fullscreenElement;
    renderer.reparentForFullscreen(fsEl);

    if (!buttonInControls) {
      const btn    = document.getElementById(BTN_ID);
      const btnTgt = fsEl ?? document.body ?? document.documentElement;
      if (btn && btn.parentElement !== btnTgt) btnTgt.appendChild(btn);
    }

    renderer.reposition();
  }

  // ── Toasts ────────────────────────────────────────────────────────────────
  // The DOM-level toast primitive lives in lib/overlay-ui.js.  These wrappers
  // just supply each toast's text, colour theme, and parent.

  const EN_LOCALES_SET = new Set(['ja-JP', 'en-US', 'en-GB', 'en']);
  function showLanguageToast(nativeLocale) {
    if (!nativeLocale || EN_LOCALES_SET.has(nativeLocale)) return;
    const label = LOCALE_LABELS[nativeLocale] ?? nativeLocale;
    UI.showToast({ host: renderer.element ?? document.body, text: `${label} subtitles` });
  }

  function toastHost() {
    return renderer.element?.parentElement ?? videoEl?.parentElement ?? document.body;
  }

  function showRateLimitToast() {
    UI.showToast({
      host:        toastHost(),
      text:        'Rate limited — please try again in a moment',
      color:       'rgba(255,180,50,0.8)',
      borderColor: 'rgba(255,180,50,0.2)',
      fontWeight:  '400',
      duration:    2500,
      zIndex:      2147483641,
    });
  }

  function showNoSubsToast() {
    UI.showToast({
      host:        toastHost(),
      text:        'No subtitle track available for this source',
      color:       'rgba(255,255,255,0.55)',
      borderColor: 'rgba(255,255,255,0.1)',
      fontWeight:  '400',
      duration:    2200,
      zIndex:      2147483641,
    });
  }

  // Actionable error toast with a Retry button.  Used by handleButtonClick
  // when subtitle activation fails — the user can re-trigger the flow
  // without navigating to the button.  Auto-dismisses after 10 s.  Only
  // one toast at a time: dropping a fresh error replaces any pending one.
  let _errorToast = null;
  function showErrorToast(text, onRetry) {
    if (_errorToast) { try { _errorToast.remove(); } catch (_) {} _errorToast = null; }
    const host = toastHost();
    if (!host) return;
    if (host !== document.body && window.getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      position:      'absolute',
      bottom:        '12%',
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(0,0,0,0.78)',
      color:         'rgba(255,200,150,0.95)',
      fontSize:      '12px',
      fontFamily:    'sans-serif',
      fontWeight:    '500',
      padding:       '6px 8px 6px 14px',
      borderRadius:  '20px',
      border:        '1px solid rgba(255,107,53,0.35)',
      zIndex:        '2147483641',
      display:       'flex',
      alignItems:    'center',
      gap:           '10px',
      pointerEvents: 'auto',
      opacity:       '1',
      transition:    'opacity 0.5s ease',
      letterSpacing: '0.3px',
    });
    const span = document.createElement('span');
    span.textContent = text;
    const btn = document.createElement('button');
    btn.textContent = 'Retry';
    Object.assign(btn.style, {
      background:   '#ff6b35',
      color:        '#fff',
      border:       '0',
      borderRadius: '12px',
      padding:      '3px 10px',
      fontSize:     '11px',
      fontWeight:   '700',
      fontFamily:   'inherit',
      cursor:       'pointer',
      letterSpacing: '0.4px',
    });
    const dismiss = () => {
      clearTimeout(timer);
      if (toast.parentElement) {
        toast.style.opacity = '0';
        setTimeout(() => { try { toast.remove(); } catch (_) {} }, 500);
      }
      if (_errorToast === toast) _errorToast = null;
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
      try { onRetry?.(); } catch (_) {}
    });
    toast.appendChild(span);
    toast.appendChild(btn);
    host.appendChild(toast);
    _errorToast = toast;
    const timer = setTimeout(dismiss, 10000);
  }

  // ── Per-render style context ────────────────────────────────────────────────
  // Batches all data-attribute reads into one object per render call.  The
  // renderer treats this as opaque input — it doesn't know about SETTINGS,
  // hexToRgba, or sanitizeFontFamily.
  function captureStyleCtx() {
    if (!isStyleOverride()) return { override: false };
    return {
      override: true,
      color:    hexToRgba(getOverrideColor(), getOverrideTextOp()),
      font:     sanitizeFontFamily(getOverrideFont()),
      bgBox:     isOverrideBgBox(),
      bgCss:     hexToRgba(getOverrideBgColor(), getOverrideBgOp()),
      bgRadius:  getOverrideBgRadius(),
      bgPadX:    getOverrideBgPaddingX(),
      bgPadY:    getOverrideBgPaddingY(),
      bgGlass:   isOverrideBgGlass(),
      bgBlur:    getOverrideBgGlassBlur(),
      bgSat:     getOverrideBgGlassSat(),
      bgHue:     getOverrideBgGlassHue(),
      outline:  getOverrideOutline(),
      bord:     getOverrideBord(),
      shad:     getOverrideShad(),
      soft:     getOverrideShadStyle() === 'soft',
      shadOp:   getOverrideShadOp(),
    };
  }

  // ── Native subtitle suppression ────────────────────────────────────────────
  // The four-layer strategy that hides Crunchyroll's own subtitle renderer while
  // our overlay is active lives in lib/sub-suppression.js.  Public surface:
  // activate(videoEl) / deactivate() / isActive().  OVERLAY_ID is injected so the
  // suppression selectors never hide our own overlay.
  const subSuppression = NS.createSubSuppression({ overlayId: OVERLAY_ID });

  // Native suppression is wanted in two independent cases: while our overlay is
  // showing (so Crunchyroll's own track doesn't render under ours), or whenever
  // the user has opted to always hide Crunchyroll's subtitles ("switch to None").
  // Reconcile both inputs through one helper so toggling either can't strand the
  // other — and bail on no-op transitions so rapid settings writes (slider
  // drags) don't churn the suppression teardown each frame.
  function syncSubSuppression() {
    const want = !!(videoEl && isEnabled() && (overlayActive || isHideOfficialSubs()));
    if (want === subSuppression.isActive()) return;
    if (want) subSuppression.activate(videoEl);
    else      subSuppression.deactivate();
  }

  // ── Button ─────────────────────────────────────────────────────────────────

  function getSourceShortLabel() {
    const loc = currentEp()?.activeSource() ?? 'ja-JP';
    return LOCALE_SHORT[loc] ?? loc.slice(0, 2).toUpperCase();
  }

  // Enforce a brief, visible 'loading' → 'active' flash so a dub switch always
  // shows a "preparing → ready" cue, even when JP loads instantly from cache.
  // Any other state cancels a pending flash.  The deferred apply re-reads the
  // live button (it may have been re-injected) and only commits 'active' if the
  // overlay is actually on.
  const MIN_FLASH_MS = 400;
  let _flashAt = 0, _flashTimer = null;
  function setButtonState(btn, state) {
    if (_flashTimer) { clearTimeout(_flashTimer); _flashTimer = null; }
    if (state === 'loading') { _flashAt = Date.now(); applyButtonState(btn, 'loading'); return; }
    if (state === 'active' && _flashAt) {
      const remain = MIN_FLASH_MS - (Date.now() - _flashAt);
      if (remain > 0) {
        applyButtonState(btn, 'loading');
        _flashTimer = setTimeout(() => {
          _flashTimer = null; _flashAt = 0;
          const b = document.getElementById(BTN_ID);
          if (b && overlayActive) applyButtonState(b, 'active');
        }, remain);
        return;
      }
    }
    _flashAt = 0;
    applyButtonState(btn, state);
  }

  function applyButtonState(btn, state) {
    btn.dataset.state = state;
    const lbl = getSourceShortLabel();
    // Remaster sync status is exposed on the popup status detail line
    // ("Synced") so the button itself stays clean — just locale + ✓.
    const S = {
      idle:    { text: 'B-SUB',      bg: 'transparent', color: '#ff6b35', border: '#ff6b35' },
      loading: { text: `${lbl}…`,    bg: 'transparent', color: '#aaa',    border: '#aaa'    },
      active:  { text: `${lbl} ✓`,   bg: '#ff6b35',     color: '#fff',    border: '#ff6b35' },
      error:   { text: 'B-SUB ✗',    bg: 'transparent', color: '#e55',    border: '#e55'    },
      reload:  { text: '↻ Reload',   bg: 'transparent', color: '#4ea8de', border: '#4ea8de' },
      unavail: { text: 'No subs',    bg: 'transparent', color: '#666',    border: '#555'    },
    };
    const s = S[state] ?? S.idle;
    btn.textContent       = s.text;
    btn.style.background  = s.bg;
    btn.style.color       = s.color;
    btn.style.borderColor = s.border;
  }

  function refreshButtonLabel() {
    const btn = document.getElementById(BTN_ID);
    if (btn && btn.dataset.state === 'active') setButtonState(btn, 'active');
    // Remaster completion / source switch routes through here too.
    updateActiveInfo();
  }

  // ── Source picker menu ────────────────────────────────────────────────────
  // The picker button + dropdown live in lib/source-menu.js.  The instance is
  // created near the top of this file with onSelectLocale / onTurnOff
  // callbacks; everything DOM-side is owned by the module.

  /**
   * Subtitle pipeline: fetch → parse → duration-validate → maybe-replace.
   *
   * Takes a resolved subtitle URL and lang, returns either render-ready cues or
   * a structured failure outcome.  Side effects on the Episode (originalCues,
   * raw-text cache, validation status) happen behind this seam — the caller
   * doesn't need to know the cache key shape, the parse vs validate split, or
   * the replacement-probe procedure.
   *
   * onScanning(lang) is fired when a duration mismatch is detected and the
   * pipeline is about to scan alternate sessions for a working copy.  The HUD
   * uses this to tell the user the wait is intentional — the scan can take
   * several seconds.
   *
   * Outcomes:
   *   { ok: true,  cues, finalUrl, lang, replacedFrom? }
   *     cues are render-ready; finalUrl may differ from input when a
   *     replacement was found in another session (replacedFrom names it).
   *   { ok: false, kind: 'fetch-failed', lang, status }   // HTTP error
   *   { ok: false, kind: 'fetch-error',  lang, message }  // network throw
   *   { ok: false, kind: 'empty',        lang }           // parsed 0 cues
   *   { ok: false, kind: 'wrong-title',  lang }           // duration short, no replacement
   */
  async function loadSubtitleCues(url, lang, ep, onScanning) {
    let rawText = ep.getCachedRawText(url);
    if (rawText) {
      log.info('Subtitle text from session cache.');
    } else {
      let resp;
      try {
        resp = await originalFetch(url);
      } catch (err) {
        return { ok: false, kind: 'fetch-error', lang, message: String(err) };
      }
      if (!resp.ok) return { ok: false, kind: 'fetch-failed', lang, status: resp.status };
      rawText = await resp.text();
      ep.setCachedRawText(url, rawText);
    }

    let cues = parseSubtitles(rawText, url);
    ep.setOriginalCues(cues);
    const fmt = rawText.trimStart().startsWith('[Script Info]') ? 'ASS' : 'VTT';
    log.info(`Parsed ${cues.length} cues (${fmt}).`);

    if (cues.length === 0) return { ok: false, kind: 'empty', lang };

    const verdict = validateSubDuration(cues);
    if (verdict === 'short') {
      const subEnd = cues.reduce((m, c) => Math.max(m, c.end), 0);
      const gap    = Math.round(videoEl.duration - subEnd);
      log.warn(
        `Sub validation: [${lang}] ends ${gap}s before video ` +
        `(sub=${Math.round(subEnd)}s vid=${Math.round(videoEl.duration)}s) — likely wrong title.`
      );

      onScanning?.(lang);

      const replacement = await tryAlternateSession(lang);
      if (replacement) {
        cues = replacement.cues;
        url  = replacement.url;
        ep.setOriginalCues(cues);
        ep.setCachedRawText(url, ep.getCachedRawText(url) ?? '');
        ep.catalog.setValidation(lang, 'ok');
        log.info(
          `Sub validation: replaced [${lang}] with copy from [${replacement.fromSession}] session.`
        );
        return { ok: true, cues, finalUrl: url, lang, replacedFrom: replacement.fromSession };
      }
      ep.catalog.setValidation(lang, 'wrong-title');
      return { ok: false, kind: 'wrong-title', lang };
    }

    if (!ep.catalog.hasValidation(lang)) ep.catalog.setValidation(lang, 'ok');
    return { ok: true, cues, finalUrl: url, lang };
  }

  async function handleButtonClick(btn) {
    if (clickInProgress) return;

    if (btn.dataset.state === 'reload') {
      location.reload();
      return;
    }

    if (btn.dataset.state === 'unavail') return;

    const ep = currentEp();
    if (!ep) return;

    if (overlayActive) {
      overlayActive = false;
      ep.setActiveSubUrl(null);
      stopSync();
      syncSubSuppression();   // keep CR subs hidden if "hide official" is on
      setButtonState(btn, 'idle');
      setJpStatus(PROTOCOL.STATUS.READY);
      return;
    }

    if (ep.hasCues()) {
      overlayActive = true;
      syncSubSuppression();
      setButtonState(btn, 'active');
      setJpStatus(PROTOCOL.STATUS.ACTIVE);
      startSync();
      paintWithSettingsCatchup();
      return;
    }

    clickInProgress = true;
    setButtonState(btn, 'loading');

    // Determine subtitle URL for the active source.
    // activeSource null/'ja-JP' → use JP session (fetched separately).
    // Any other locale → look up via the catalog (already cached from a captured session — no extra API call).
    let subUrl;
    let fetchedNativeLocale = null;
    let srcFetchFailed      = false;
    const catalog   = ep.catalog;
    const srcLocale = ep.activeSource();

    if (srcLocale && srcLocale !== 'ja-JP') {
      subUrl = getSubtitleUrl(srcLocale);
      if (subUrl) {
        fetchedNativeLocale = srcLocale;
        const subBase = subUrlBase(subUrl);
        const fromRow = catalog.entries().find(
          ([, row]) => subUrlBase(row[srcLocale]) === subBase
        )?.[0] ?? 'unknown';
        log.info(`Source subtitle [${srcLocale}] from [${fromRow}] session.`);
      } else {
        // Not yet in any captured session — lazily fetch the audio dub's session.
        const v = catalog.versions().find(v => v.locale === srcLocale);
        if (v?.guid) {
          const result   = await fetchSubUrlForSource(v.guid, srcLocale, ep.authHeaders);
          subUrl         = result.url ?? getSubtitleUrl(srcLocale);
          fetchedNativeLocale = subUrl ? srcLocale : null;
          srcFetchFailed      = result.fetchFailed;
          if (result.rateLimited) {
            log.warn(`Rate limited fetching ${srcLocale} — please wait a moment.`);
            showRateLimitToast();
            setButtonState(btn, 'idle');
            setJpStatus(PROTOCOL.STATUS.READY);
            clickInProgress = false;
            return;
          }
        }
      }
    } else {
      subUrl = ep.jpCaptionUrl || ep.jpSubtitleUrl;
      // Fall back to a carried-forward JP guid mapping if this Episode never
      // got ep.jpGuid set directly (typical right after a dub switch where
      // Crunchyroll didn't refire /playback/v3/ for the new dub).
      const jpGuidForFetch = ep.jpGuid ?? ep.getMappedJpGuid?.();
      if (!subUrl && jpGuidForFetch && ep.authHeaders) {
        const jpData   = await fetchAndCacheJpData(jpGuidForFetch, ep.authHeaders);
        subUrl         = jpData?.captionUrl || jpData?.subtitleUrl || null;
        srcFetchFailed = jpData?.fetchFailed ?? false;
        if (subUrl) {
          ep.setJpUrls(jpData.captionUrl ?? null, jpData.subtitleUrl ?? null);
          if (!ep.jpGuid) ep.setJpGuid(jpGuidForFetch);
        }
      }
    }

    if (!subUrl) {
      if (srcFetchFailed) {
        log.warn('Subtitle session fetch failed — network error.');
        setButtonState(btn, 'error');
        setJpStatus(PROTOCOL.STATUS.ERROR);
        showErrorToast('Subtitle session failed to load.', () => handleButtonClick(btn).catch(() => {}));
      } else if (srcLocale && srcLocale !== 'ja-JP') {
        // Saved locale not available for this episode — clear the stale preference
        // and fall back to JP.
        log.info(`No subtitle track for [${srcLocale}] on this episode — falling back to JP subtitles.`);
        try { localStorage.removeItem(LOCALE_PREF_KEY); } catch (_) {}
        ep.setActiveSource(null);
        ep.clearCues();
        renderer.invalidate();
        clickInProgress = false;
        handleButtonClick(btn).catch(() => {});
        return;
      } else {
        // JP subtitles truly unavailable — check if any other session has subtitle data.
        let fallbackSession = null, fallbackSubLocale = null;
        for (const [sess, row] of catalog.entries()) {
          if (sess === 'ja-JP') continue;
          const first = Object.keys(row)[0];
          if (first) { fallbackSession = sess; fallbackSubLocale = first; break; }
        }
        if (fallbackSubLocale) {
          log.info(`No JP subs — auto-falling back to [${fallbackSubLocale}] from [${fallbackSession}] session.`);
          ep.setActiveSource(fallbackSubLocale);
          ep.clearCues();
          renderer.invalidate();
          clickInProgress = false;
          handleButtonClick(btn).catch(() => {});
          return;
        }
        // Distinguish "confirmed no JP" from "clicked too early".
        //
        // Confirmed unavail = catalog has playback entries (we've seen at
        // least one /playback/v3/ response) AND nothing about that data
        // suggests JP exists for this episode.  Queue otherwise — either
        // playback hasn't landed yet, or it has but we have JP signals
        // (cached mapping from a prior dub, an in-flight JP-first fetch,
        // etc.) that say JP will become available.
        const seenPlayback = catalog.entries().length > 0;
        const hasJpHint    = !!ep.jpCaptionUrl || !!ep.jpSubtitleUrl
                          || !!ep.jpGuid       || !!ep.getMappedJpGuid?.();
        if (hasJpHint || !seenPlayback) {
          // Queue the activation — leave the button in 'loading' as visual
          // feedback that we're waiting for data, and let onJpDataReady
          // re-fire this click when JP data lands.
          log.info('JP CC clicked before data — queued, will auto-activate when JP data arrives.');
          setPendingActivate(true);
          // setButtonState 'loading' was already done above; keep it.
          setJpStatus(PROTOCOL.STATUS.NONE);
          scheduleQueueResolver();
        } else {
          log.warn('No subtitle track for [ja-JP] — not available in any captured session.');
          setPendingActivate(false); // confirmed unavail — clear any queued click
          setButtonState(btn, 'unavail');
          setJpStatus(PROTOCOL.STATUS.UNAVAILABLE);
          showNoSubsToast();
        }
      }
      clickInProgress = false;
      return;
    }

    const lang = srcLocale ?? 'ja-JP';
    try {
      const result = await loadSubtitleCues(subUrl, lang, ep, () => {
        const hud = ensureHud();
        if (hud) {
          hud.html(
            `<span style="color:#ffc107;">⚠</span>  Subtitle mismatch detected` +
            `<span style="color:rgba(255,255,255,0.4);font-size:10px;"> — scanning sessions…</span>`
          );
        }
      });

      if (!result.ok) {
        if (result.kind === 'fetch-failed' || result.kind === 'fetch-error') {
          // Stale URL: evict caches so the next click re-fetches.
          if (lang === 'ja-JP') {
            if (ep.jpGuid) ep.evictCachedJpData(ep.jpGuid);
            ep.clearJpUrls();
          } else {
            catalog.evictUrl(srcLocale);
            const v = catalog.versions().find(v => v.locale === srcLocale);
            if (v?.guid) ep.evictCachedSrcUrl(v.guid, srcLocale);
          }
          const detail = result.kind === 'fetch-failed' ? `HTTP ${result.status}` : result.message;
          log.error(`Subtitle fetch failed: ${detail}`);
          setButtonState(btn, 'error');
          setJpStatus(PROTOCOL.STATUS.ERROR);
          showErrorToast('Subtitle fetch failed.', () => handleButtonClick(btn).catch(() => {}));
          return;
        }
        if (result.kind === 'empty') {
          log.error('Subtitle file parsed but contained no cues.');
          setButtonState(btn, 'error');
          setJpStatus(PROTOCOL.STATUS.ERROR);
          showErrorToast('Subtitle file was empty.', () => handleButtonClick(btn).catch(() => {}));
          return;
        }
        if (result.kind === 'wrong-title') {
          sourceMenu.updateRow(lang, 'wrong-title');
          const hud = ensureHud();
          if (hud) {
            hud.html(
              `<span style="color:#e55;">✗</span>  [${escapeHtml(lang)}] subtitle unavailable` +
              `<span style="color:rgba(255,255,255,0.4);font-size:10px;">` +
              ` — appears to be from a different title</span>`,
              8000
            );
          }
          setButtonState(btn, 'error');
          setJpStatus(PROTOCOL.STATUS.ERROR);
          return;
        }
      }

      if (result.replacedFrom) {
        const hud = ensureHud();
        if (hud) {
          hud.html(
            `<span style="color:#4caf50;">✓</span>  Found valid subtitle` +
            `<span style="color:rgba(255,255,255,0.4);font-size:10px;">` +
            ` — [${escapeHtml(lang)}] sourced from ${escapeHtml(result.replacedFrom)} session</span>`,
            6000
          );
        }
      }

      ep.setActiveSubUrl(result.finalUrl);
      overlayActive = true;
      syncSubSuppression();
      setButtonState(btn, 'active');
      setJpStatus(PROTOCOL.STATUS.ACTIVE);
      startSync();
      paintWithSettingsCatchup();

      runRemaster(ep.originalCues, result.finalUrl, srcLocale).catch(err => {
        log.warn('Remaster error:', err);
        fadeOutHud();
      });

      showLanguageToast(fetchedNativeLocale);
    } catch (err) {
      log.error('Subtitle activation error:', err);
      setButtonState(btn, 'error');
      setJpStatus(PROTOCOL.STATUS.ERROR);
      showErrorToast('Subtitle activation failed.', () => handleButtonClick(btn).catch(() => {}));
    } finally {
      clickInProgress = false;
    }
  }

  // ── Button injection ───────────────────────────────────────────────────────
  function directChildOf(parent, el) {
    while (el && el.parentElement !== parent) el = el.parentElement;
    return el?.parentElement === parent ? el : null;
  }

  function findControlsRow() {
    // Search document-wide for the speed button — Crunchyroll's controls bar
    // lives in a sibling subtree to the video, so scoping to videoEl's ancestor
    // misses it. The /^\d+x$/ pattern is unique enough on an episode page.
    const speedBtn = Array.from(document.querySelectorAll('button'))
      .find(b => /^\d+(\.\d+)?x$/.test(b.textContent.trim()));
    if (!speedBtn) return null;
    let el = speedBtn.parentElement;
    while (el && el.tagName !== 'BODY') {
      const cs = window.getComputedStyle(el);
      if ((cs.display === 'flex' || cs.display === 'inline-flex')
          && el.querySelectorAll('button').length >= 2) {
        return { row: el, speedBtn };
      }
      el = el.parentElement;
    }
    return null;
  }

  function findSubtitleAudioBtn() {
    return Array.from(document.querySelectorAll('button')).find(b => {
      const label = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
      return label.includes('subtitle') || label.includes('audio') || label.includes('caption');
    }) ?? null;
  }

  // Inject a stylesheet that adds:
  //   • Expanded transparent hit-area pseudo-elements (10px vertical,
  //     6px horizontal) so the small buttons aren't fiddly to click.
  //   • Keyframe animations for two button states:
  //     - data-hint     → a one-time orange pulse on a brand new install
  //                       so the user notices the button exists.
  //     - data-queued   → a slow opacity pulse while pendingActivate is
  //                       true, signalling "your click is queued".
  // Idempotent.
  function ensureButtonChromeStyles() {
    const styleId = 'cr-bsub-button-chrome';
    if (document.getElementById(styleId)) return;
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      #${BTN_ID}, #cr-bsub-menu-btn { position: relative; }
      #${BTN_ID}::before, #cr-bsub-menu-btn::before {
        content: ''; position: absolute; inset: -10px -6px;
      }
      @keyframes cr-bsub-hint-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,53,0.65); }
        50%      { box-shadow: 0 0 0 10px rgba(255,107,53,0); }
      }
      #${BTN_ID}[data-hint='1'] {
        animation: cr-bsub-hint-pulse 1.5s ease-in-out infinite;
      }
      @keyframes cr-bsub-queued-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.55; }
      }
      #${BTN_ID}[data-queued='1'] {
        animation: cr-bsub-queued-pulse 1.2s ease-in-out infinite;
      }
    `;
    document.head.appendChild(s);
  }

  // First-run hint: orange pulse on the JP CC button until the user clicks
  // it once or the timeout elapses.  Flag stored in localStorage so it only
  // shows on the first install (or after the user clears extension data).
  const HINT_SEEN_KEY = 'crSubFix_seenJpCcHint';
  const HINT_TIMEOUT_MS = 12000;
  function maybeShowFirstRunHint(btn) {
    try { if (localStorage.getItem(HINT_SEEN_KEY)) return; } catch (_) { return; }
    btn.dataset.hint = '1';
    const dismiss = () => {
      btn.removeAttribute('data-hint');
      btn.removeEventListener('click', dismiss);
      try { localStorage.setItem(HINT_SEEN_KEY, '1'); } catch (_) {}
    };
    btn.addEventListener('click', dismiss);
    setTimeout(dismiss, HINT_TIMEOUT_MS);
  }

  // Reflect pendingActivate as a data-queued attribute so the CSS pulse
  // animation kicks in / out automatically.
  function setQueuedPulse(on) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (on) btn.dataset.queued = '1';
    else    btn.removeAttribute('data-queued');
  }

  // Centralised setter — keeps the DOM data-queued attribute aligned with
  // the pendingActivate flag, so the CSS pulse animation matches state
  // without needing to touch the button at every call-site.
  function setPendingActivate(on) {
    pendingActivate = on;
    setQueuedPulse(on);
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    ensureButtonChromeStyles();

    const btn = document.createElement('button');
    btn.id    = BTN_ID;
    btn.title = 'Toggle subtitles (C / Alt+J)';

    const found = findControlsRow();

    if (found) {
      buttonInControls = true;
      Object.assign(btn.style, {
        background:    'transparent',
        color:         '#ff6b35',
        border:        '1.5px solid #ff6b35',
        borderRadius:  '3px',
        padding:       '3px 7px',
        fontSize:      '11px',
        fontWeight:    '700',
        fontFamily:    'sans-serif',
        lineHeight:    '1',
        cursor:        'pointer',
        letterSpacing: '0.5px',
        userSelect:    'none',
        transition:    'background 0.15s, color 0.15s',
        alignSelf:     'center',
        flexShrink:    '0',
        marginRight:   '6px',
      });
      const subAudioBtn = findSubtitleAudioBtn();
      const refEl = (subAudioBtn && directChildOf(found.row, subAudioBtn))
                 ?? directChildOf(found.row, found.speedBtn);
      if (refEl) found.row.insertBefore(btn, refEl);
      else        found.row.appendChild(btn);
      log.info('JP CC button injected into controls bar.');
    } else {
      buttonInControls = false;
      Object.assign(btn.style, {
        position:      'fixed',
        bottom:        '90px',
        right:         '20px',
        zIndex:        '2147483647',
        background:    'rgba(0,0,0,0.7)',
        color:         '#ff6b35',
        border:        '2px solid #ff6b35',
        borderRadius:  '5px',
        padding:       '5px 10px',
        fontSize:      '12px',
        fontWeight:    '700',
        fontFamily:    'sans-serif',
        lineHeight:    '1',
        cursor:        'pointer',
        letterSpacing: '0.5px',
        userSelect:    'none',
        transition:    'background 0.15s, color 0.15s',
      });
      (document.body || document.documentElement).appendChild(btn);
      log.info('JP CC button injected (fixed fallback).');
    }

    setButtonState(btn, 'idle');
    btn.addEventListener('mouseenter', () => {
      if (!overlayActive) btn.style.background = buttonInControls
        ? 'rgba(255,107,53,0.15)' : 'rgba(255,107,53,0.25)';
    });
    btn.addEventListener('mouseleave', () => {
      if (!overlayActive) btn.style.background = buttonInControls
        ? 'transparent' : 'rgba(0,0,0,0.7)';
    });
    btn.addEventListener('click', e => { e.stopPropagation(); handleButtonClick(btn); });
    if (found) sourceMenu.injectButton(found, btn);
    maybeShowFirstRunHint(btn);
  }

  function setupPlayer(video) {
    if (videoEl === video) return;
    if (videoEl) videoEl.removeEventListener('play', tryAutoActivate);
    // Tear down any suppression bound to the outgoing video (overlay- or
    // "hide official"-driven) before we repoint videoEl at the new one.
    subSuppression.deactivate();
    overlayActive   = false;
    currentEp()?.clearCues();
    movedToControls = false;
    stopSync();
    videoEl   = video;
    renderer.mount(video);
    hudCtl    = null; // overlay was just (re)created — discard stale HUD ref
    injectButton();
    videoEl.addEventListener('play', tryAutoActivate);
    tryAutoActivate();
    syncSubSuppression();   // start hiding CR subs immediately if "hide official" is on
    backgroundValidateAll().catch(() => {});
  }

  function watchForPlayer() {
    const check = debounce(() => {
      if (!isEnabled()) return;
      if (!getEpisodeGuid()) return;   // only active on /watch/ pages
      const video = document.querySelector('video');
      if (!video) return;
      setupPlayer(video);

      // When the same <video> element persists but Crunchyroll rebuilds its player
      // UI (quality change, stream restart, etc.), the injected button and overlay
      // are removed from the DOM while our state variables still think they exist.
      if (videoEl === video && !document.getElementById(BTN_ID)) {
        buttonInControls = false;
        movedToControls  = false;
        injectButton();
        renderer.mount(video);
        hudCtl    = null;
        const btn = document.getElementById(BTN_ID);
        if (btn) {
          if (overlayActive) {
            setButtonState(btn, 'active');
            renderer.show();
            onTimeUpdate();
          } else {
            const attr = document.documentElement.getAttribute(PROTOCOL.ATTR.JP_STATUS) ?? 'idle';
            setButtonState(btn, attr === PROTOCOL.STATUS.ACTIVE ? 'idle' : attr);
          }
        }
      }

      if (!buttonInControls && !movedToControls) {
        const existing = document.getElementById(BTN_ID);
        if (existing && findControlsRow()) {
          movedToControls = true;
          sourceMenu.close();
          existing.remove();
          sourceMenu.removeButton();
          injectButton();
        }
      }
    }, 100);

    new MutationObserver(check).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    check();
  }

  // ── Main fetch intercept ───────────────────────────────────────────────────
  // Crunchyroll and co-installed extensions (ad blockers) fire many requests
  // through our wrapped fetch that get blocked or fail.  When the caller never
  // catches the rejection it surfaces as "Uncaught (in promise) TypeError:
  // Failed to fetch" — and because V8 attributes an unhandled fetch rejection to
  // where fetch was *called*, our wrapper frame gets blamed even though the
  // request and the missing .catch are entirely the caller's.  These are benign
  // network failures, not bugs.  Two layers keep them out of the console:
  //   1. passThrough() marks the promise handled for the common fire-and-forget
  //      caller (one that attaches no .then at all).
  //   2. a page-level unhandledrejection listener silences the exact "Failed to
  //      fetch" TypeError for callers that DO chain .then without .catch — whose
  //      derived promise we have no reference to.  preventDefault() only
  //      suppresses the console log; it does not alter any behaviour.
  // Only playback/manifest URLs are handled async, by intercept{Playback,Manifest}.
  // ── On-error reporting ─────────────────────────────────────────────────────
  // Dormant unless lib/config.js sets REPORT_ENDPOINT.  When OUR code throws,
  // show a one-click "send a report?" nudge near the player; the isolated world
  // (content.js) does the actual POST so Crunchyroll's page CSP can't block it.
  // Crunchyroll throws its own React hydration errors constantly, so we only act
  // on errors whose stack references our own extension URL.
  const REPORT_ENDPOINT = (NS.config && NS.config.REPORT_ENDPOINT) || '';
  const SELF_URL = (() => {
    try { const m = (new Error().stack || '').match(/chrome-extension:\/\/[a-p]{32}\//); return m ? m[0] : null; }
    catch (_) { return null; }
  })();
  const reportSeen = new Set();            // error fingerprints nudged this session
  let reportNudgeOpen = false;
  const isOurError = (s) => !!(SELF_URL && s && String(s).includes(SELF_URL));

  function maybeReport(message, stack) {
    if (!REPORT_ENDPOINT || !isEnabled()) return;
    const fp = String(message || stack || 'error').slice(0, 120);
    if (reportSeen.has(fp)) return;        // one nudge per unique error per session
    reportSeen.add(fp);
    // Record the error + our own top stack frames (extension URLs only — not
    // sensitive) into the trace so the report carries the where, not just the what.
    const frames = String(stack || '').split('\n').slice(0, 4).join(' ');
    log.error('Captured error:', message, frames ? '| ' + frames : '');
    showReportNudge(String(message || 'An error occurred'));
  }

  // Build the redacted report bundle in the MAIN world.  Everything's reachable
  // here (trace, DOM state, settings) except the extension version, which has no
  // chrome.runtime in MAIN — content.js stashes it in sessionStorage for us.
  function buildReportBundle(errMessage) {
    const el = document.documentElement;
    let version = '?';
    try { version = sessionStorage.getItem('crSubFix_version') || '?'; } catch (_) {}
    const lines = [
      `version : ${version}`,
      `error   : ${errMessage || '-'}`,
    ];
    // Respect the user's opt-out: with diagnostics off, send only version + the
    // error message — no page, activity, or settings.
    if (SETTINGS.read(el, 'includeDiagnostics') === false) {
      lines.push('(diagnostics off — page/activity/settings omitted by the user)');
      return lines.join('\n');
    }
    let activeInfo = {};
    try { const raw = el.getAttribute(PROTOCOL.ATTR.ACTIVE_INFO); if (raw) activeInfo = JSON.parse(raw); } catch (_) {}
    lines.push(
      `browser : ${navigator.userAgent}`,
      `page    : ${location.href}`,
      `state   : jpStatus=${el.getAttribute(PROTOCOL.ATTR.JP_STATUS) || '-'} source=${activeInfo.source ?? '-'} audio=${activeInfo.audio ?? '-'}`,
      `settings: enabled=${SETTINGS.read(el, 'enabled')} auto=${SETTINGS.read(el, 'autoActivate')} hideOfficial=${SETTINGS.read(el, 'hideOfficialSubs')}`,
      '--- recent activity (most recent last) ---',
    );
    // Keep the MOST RECENT trace that fits the budget (the Worker's embed holds
    // ~4000) — trimming from the front preserves the lines just before the error.
    const header = lines.join('\n');
    const redact = (s) => s.replace(/(https?:\/\/[^\s|?]+)\?[^\s|]*/gi, '$1?<redacted>');
    let trace = [];
    try { trace = JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]'); } catch (_) {}
    let tail = trace.map(redact).join('\n');
    const room = 3800 - header.length;
    if (tail.length > room) tail = '…(older lines trimmed)\n' + tail.slice(-(room - 25));
    return header + '\n' + (tail || '(no trace)');
  }

  function showReportNudge(message) {
    if (reportNudgeOpen) return;
    reportNudgeOpen = true;
    const wrap = document.createElement('div');
    wrap.id = 'cr-sub-report-nudge';
    wrap.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'display:flex;align-items:center;gap:12px;max-width:92vw;background:#16213e;color:#e0e0e0;' +
      'border:1px solid rgba(255,107,53,0.5);border-radius:10px;padding:11px 14px;' +
      'font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.55);';
    const msg = document.createElement('span');
    msg.textContent = '⚠ Better Subs hit an error. Send a quick report?';
    const send = document.createElement('button');
    send.textContent = 'Send';
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    for (const b of [send, dismiss]) {
      b.type = 'button';
      b.style.cssText = 'font:600 12px inherit;border-radius:6px;padding:5px 12px;cursor:pointer;border:1px solid #333;background:#0f0f1e;color:#aaa;';
    }
    send.style.color = '#ff6b35'; send.style.borderColor = 'rgba(255,107,53,0.6)';
    const host = () => document.fullscreenElement || document.documentElement;
    let done = false, keepAlive = null;
    const close = () => {
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      wrap.remove(); reportNudgeOpen = false;
    };
    send.addEventListener('click', async () => {
      if (done) return; done = true;
      send.disabled = dismiss.disabled = true;
      msg.textContent = 'Sending…';
      let ok = false;
      try {
        const resp = await originalFetch(REPORT_ENDPOINT, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: buildReportBundle(message) }),
        });
        ok = resp.ok;
      } catch (_) { ok = false; }
      msg.textContent = ok ? '✓ Thanks — report sent.' : '✗ Could not send the report.';
      send.style.display = dismiss.style.display = 'none';
      setTimeout(close, 2600);
    });
    dismiss.addEventListener('click', close);
    wrap.append(msg, send, dismiss);
    host().appendChild(wrap);
    // Crunchyroll's React reconciliation detaches nodes added under <body>/the
    // player, so host on <html> and re-attach until the nudge is intentionally
    // closed — otherwise it vanishes before the user can click it.
    keepAlive = setInterval(() => {
      if (!reportNudgeOpen) { clearInterval(keepAlive); keepAlive = null; return; }
      if (!wrap.isConnected) host().appendChild(wrap);
    }, 500);
    setTimeout(() => { if (!done) close(); }, 15000);               // auto-dismiss if ignored
  }

  if (REPORT_ENDPOINT) {
    window.addEventListener('error', (e) => {
      const where = e.filename || (e.error && e.error.stack) || '';
      if (isOurError(where)) maybeReport(e.message || (e.error && e.error.message) || 'error', where);
    });
  }

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r instanceof TypeError && /failed to fetch/i.test(r.message || '')) {
      e.preventDefault();
      return;
    }
    const stack = (r && r.stack) || '';
    if (isOurError(stack)) maybeReport((r && r.message) || String(r), stack);
  });

  function passThrough(args) {
    const p = originalFetch(...args);
    p.catch(() => {});
    return p;
  }

  window.fetch = function (...args) {
    const input = args[0];
    const url   = typeof input === 'string' ? input
                : input instanceof Request  ? input.url : '';

    if (!isEnabled()) return passThrough(args);

    // Snapshot the Episode at request start; writes after dispose() are no-ops.
    // If we're not on /watch/, no Episode exists and we just pass through.
    const ep = currentEp();

    if (ep && !ep.capturedAuth) {
      const auth = extractAuthHeader(args[1] ?? {});
      if (Object.keys(auth).length) {
        ep.setCapturedAuth(auth);
        // If a prior dub's Episode carried a JP guid forward via SPA
        // navigation, we now have auth — proactively prefetch JP data.
        // Without this, dub switches where Crunchyroll doesn't refetch
        // /playback/v3/ would never load JP for the new Episode.
        // maybePrefetch is idempotent and self-gating.
        if (ep.getMappedJpGuid?.()) maybePrefetch().catch(() => {});
      }
    }

    if (PLAYBACK_RE.test(url) && ep) return interceptPlayback(args, url, ep);
    if (MANIFEST_RE.test(url))       return interceptManifest(args, ep);

    // Everything else passes straight through, untouched.
    return passThrough(args);
  };

  // ── Playback JSON intercept ──
  async function interceptPlayback(args, url, ep) {
    const response = await runPlaybackIntercept(args, url, ep);
    // The newer Crunchyroll player renders subtitles from this JSON's
    // captions/subtitles maps (not the DASH manifest text/vtt track), so when
    // "hide official" is on we empty those maps in the copy the player receives,
    // leaving it nothing to render.  Our own catalog/JP logic already read the
    // untouched data from a clone above, and JP/source subtitle data is fetched
    // via originalFetch (which bypasses this wrapper), so the player seeing an
    // empty list never starves the overlay.
    return isHideOfficialSubs() ? stripOfficialSubs(response) : response;
  }

  async function stripOfficialSubs(response) {
    try {
      const data = await response.clone().json();
      if (data && typeof data === 'object') {
        log.info('[hide-official] playback keys:', Object.keys(data).join(','),
                 '| hardSubs:', data.hardSubs ? Object.keys(data.hardSubs).join('/') : (data.hard_subs ? 'snake:' + Object.keys(data.hard_subs).join('/') : 'none'),
                 '| url:', (data.url || '').slice(0, 110));
        // Soft-sub maps (older player rendered from these).
        data.captions  = {};
        data.subtitles = {};
        // The newer player serves HARDSUBBED video — the subtitle is burned into
        // the picture, picked from this hardSubs map by the viewer's subtitle
        // preference.  Empty it so the player falls back to the raw top-level
        // stream URL and the burned-in text never appears.  Only when a raw url
        // exists, so we never strand the player with no stream.
        if (data.url && data.hardSubs)  data.hardSubs  = {};
        if (data.url && data.hardsubs)  data.hardsubs  = {};
        if (data.url && data.hard_subs) data.hard_subs = {};
      }
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
    } catch (_) {
      return response;
    }
  }

  async function runPlaybackIntercept(args, url, ep) {
    const authHdrs = extractAuthHeader(args[1] ?? {});
    if (Object.keys(authHdrs).length) ep.setCapturedAuth(authHdrs);

    const cachedJpGuid = ep.getMappedJpGuid();
    if (cachedJpGuid && !ep.jpCaptionUrl) {
      log.info(`JP-first fetch (ep: ${ep.guid}, jp: ${cachedJpGuid})`);
      try {
        const jpData = await fetchAndCacheJpData(cachedJpGuid, authHdrs);
        if (ep.disposed) { /* navigation happened mid-fetch — drop */ }
        else {
          if (jpData?.jpRow) storeSessionSubs('ja-JP', jpData.jpRow);
          if (jpData?.captionUrl || jpData?.subtitleUrl) {
            ep.setJpUrls(jpData.captionUrl ?? null, jpData.subtitleUrl ?? null);
            ep.setJpGuid(cachedJpGuid);
            ep.setAuthHeaders(authHdrs);
            setJpStatus(PROTOCOL.STATUS.READY);
            log.info('JP-first success. Caption:', ep.jpCaptionUrl, '| Sub:', ep.jpSubtitleUrl);
            tryAutoActivate();
            onJpDataReady();
            backgroundValidateAll().catch(() => {});
          } else {
            log.warn('JP-first: no EN URL — other subtitle languages may still be available.');
          }
        }
      } catch (err) {
        log.warn('JP-first error:', err);
      }
    }

    const response = await originalFetch(...args);

    // Bail if navigation disposed the Episode while waiting on the network.
    if (ep.disposed) return response;

    try {
      const data = await response.clone().json();

      const watchingJP = data.audioLocale === 'ja-JP';
      ep.setCurrentAudio(data.audioLocale ?? null);
      const currentAudio = ep.catalog.currentAudio();
      updateActiveInfo();

      const jpVersion = PLAYBACK.jpVersion(data);
      if (!jpVersion) {
        // Crunchyroll's API sometimes returns a versions list without
        // ja-JP for certain dub variants of an episode that DOES have JP.
        // If we already have JP data (loaded just above by the JP-first
        // fetch, or carried forward from a prior dub of the same episode),
        // don't overwrite that with 'unavail' — JP is still available.
        const haveJpHint = !!ep.jpCaptionUrl || !!ep.jpSubtitleUrl
                        || !!ep.jpGuid || !!ep.getMappedJpGuid?.();
        if (haveJpHint) {
          log.info('Dub response missing ja-JP — keeping prior JP data (cross-dub).');
        } else {
          log.info('No ja-JP version — skipping.');
          setJpStatus(PROTOCOL.STATUS.UNAVAILABLE);
          setPendingActivate(false); // queued click can't succeed — clear it
          const btn = document.getElementById(BTN_ID);
          if (btn) setButtonState(btn, 'unavail');
        }
        return response;
      }

      ep.setMappedJpGuid(jpVersion.guid);
      ep.setAuthHeaders(authHdrs);
      if (!ep.jpGuid) ep.setJpGuid(jpVersion.guid);

      const sessionSubs = PLAYBACK.subtitleMap(data);

      // Store ALL subtitle URLs from this session into the catalog row for this audio locale.
      storeSessionSubs(currentAudio, sessionSubs);
      log.info(`[${currentAudio}] session subtitle locales [${Object.keys(sessionSubs).join(', ') || 'none'}]`);

      // Race-condition fix: JP-first may have activated the overlay before this
      // audio session's subtitle URLs were stored.  Now that the audio row is
      // populated, re-run remaster so it can find the bridging language.
      if (overlayActive && ep.originalCues.length > 0 && ep.activeSubUrl &&
          (!ep.remasteredCues || ep.remasterForAudio !== currentAudio)) {
        ep.clearRemaster();
        renderer.invalidate();
        runRemaster(ep.originalCues, ep.activeSubUrl, ep.activeSource()).catch(() => {});
      }

      tryAutoActivate();
      onJpDataReady();
      backgroundValidateAll().catch(() => {});

      // Auto-reload active subs when the audio session changes and a better-timed
      // subtitle URL is now available for the active locale.
      const active = ep.activeSource();
      if (overlayActive && active && active !== 'ja-JP') {
        const betterUrl = getSubtitleUrl(active);
        if (betterUrl && subUrlBase(betterUrl) !== subUrlBase(ep.activeSubUrl)) {
          log.info(`Audio changed → reloading [${active}] subs for new session.`);
          const reloadBtn = document.getElementById(BTN_ID);
          if (reloadBtn) {
            overlayActive = false;
            ep.setActiveSubUrl(null);
            ep.clearCues();
            renderer.invalidate();
            stopSync();
            handleButtonClick(reloadBtn).catch(() => {});
          }
        }
      }

      // Build the source picker list — JP first, then the other audio dubs.
      const newVersions = [{ locale: 'ja-JP', guid: jpVersion.guid }];
      for (const v of PLAYBACK.audioVersions(data)) {
        if (v.locale !== 'ja-JP') newVersions.push(v);
      }
      // Add every subtitle locale that isn't already represented by an audio dub —
      // covers subtitle-only languages (no separate audio track) carried by the JP session.
      const versionLocales = new Set(newVersions.map(v => v.locale));
      for (const loc of allKnownSubtitleLocales()) {
        if (!versionLocales.has(loc)) { newVersions.push({ locale: loc, guid: null }); versionLocales.add(loc); }
      }
      newVersions.sort((a, b) => {
        if (a.locale === 'ja-JP') return -1;
        if (b.locale === 'ja-JP') return 1;
        return a.locale.localeCompare(b.locale);
      });
      ep.catalog.setVersions(newVersions);
      sourceMenu.updateButtonVisibility();
      log.info(`Source picker: ${newVersions.map(v => v.locale).join(', ')}`);

      // Auto-recover the button from a premature-click 'unavail' state.
      // The user clicked JP CC during the gap between dub-switch SPA
      // navigation and this playback response arriving, so the catalog
      // was empty at the time and we marked it unavailable.  Now that we
      // have data, return the button to 'idle' so a second click works.
      {
        const stuckBtn = document.getElementById(BTN_ID);
        if (stuckBtn && stuckBtn.dataset.state === 'unavail') {
          log.info('Catalog populated — clearing stuck `unavail` button state.');
          setButtonState(stuckBtn, 'idle');
          setJpStatus(PROTOCOL.STATUS.NONE);
        }
      }

      if (watchingJP) {
        if (!ep.jpCaptionUrl && !ep.jpSubtitleUrl && ep.jpGuid) {
          maybePrefetch();
        }
        return response;
      }

      log.info(`Found ja-JP version: ${jpVersion.guid}`);

      if (data.token) {
        const enGuid  = url.match(PLAYBACK_RE)[1];
        const enToken = data.token;
        // Episode handles deregistering any prior beforeunload handler before
        // registering this new one — quality changes and stream restarts
        // re-trigger this block, and stale handlers would fire multiple
        // DELETEs for outdated tokens on page unload.
        const handler = () => {
          originalFetch(
            `https://www.crunchyroll.com/playback/v1/token/${enGuid}/${enToken}`,
            { method: 'DELETE', credentials: 'include', headers: authHdrs, keepalive: true }
          ).catch(() => {});
        };
        ep.setEnSessionCleanup(handler);
        window.addEventListener('beforeunload', handler, { once: true });
        log.info('EN session cleanup registered.');
      }

      if (!ep.jpCaptionUrl && !ep.jpSubtitleUrl) {
        // JP guid just discovered — need a reload so the JP-first path can fetch
        // subtitle data with the correct auth on the next load.
        const reloadKey = 'crSubFix_reloaded_' + ep.guid;
        const btn       = document.getElementById(BTN_ID);
        if (!STORAGE.ssHas(reloadKey)) {
          log.info('JP guid cached — reloading for JP subs.');
          if (btn) setButtonState(btn, 'reload');
          // Set the guard BEFORE scheduling the reload. If setItem throws
          // (quota full / storage blocked), cancel the reload to avoid an
          // infinite reload loop.
          if (STORAGE.ssSet(reloadKey, '1')) {
            setTimeout(() => location.reload(), 600);
          } else {
            log.warn('sessionStorage unavailable — reload skipped.');
            if (btn) setButtonState(btn, 'idle');
          }
        } else {
          log.info('JP guid known — reload already done this session.');
          if (btn) setButtonState(btn, 'idle');
        }
      }
    } catch (err) {
      log.error('Playback interceptor error:', err);
    }

    return response;
  }

  // ── DASH manifest intercept ──
  async function interceptManifest(args, ep) {
    const response = await originalFetch(...args);
    const hideOfficial = isHideOfficialSubs();
    const jpCap = ep?.jpCaptionUrl;
    // Nothing to do unless we're hiding CR's subs or swapping in the JP caption.
    if (!hideOfficial && !jpCap) return response;
    try {
      const xml      = await response.clone().text();
      // Hide-official wins: strip CR's subtitle track entirely so its renderer
      // has nothing to show.  Otherwise swap CR's text/vtt to the JP caption so
      // CR's own renderer displays the replacement (the in-player path).
      const modified = hideOfficial ? blankVttInManifest(xml) : swapVttInManifest(xml, jpCap);
      if (modified === xml) {
        log.warn(hideOfficial ? 'Manifest: no text/vtt AdaptationSet to remove.' : 'Manifest swap: no text/vtt BaseURL found.');
        return response;
      }
      log.info(hideOfficial ? 'Manifest text/vtt track removed (hide official).' : 'Manifest text/vtt swapped to JP caption.');
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      return new Response(modified, { status: response.status, statusText: response.statusText, headers });
    } catch (err) {
      log.error('Manifest interceptor error:', err);
      return response;
    }
  }

  watchForPlayer();
  log.info('Fetch interceptor + JP CC button installed.');
  } catch (err) {
    console.error('[CR Sub Fix] interceptor.js threw at module level:', err, err?.stack);
    // Best-effort persist to the trace (log may not be initialised if the throw
    // was early) so a later report still carries the load failure.
    try {
      const arr = JSON.parse(sessionStorage.getItem('crSubFix_trace') || '[]');
      arr.push(`${Date.now()} [E] module-level throw: ${err && err.message} | ` +
        String((err && err.stack) || '').split('\n').slice(0, 4).join(' '));
      while (arr.length > 400) arr.shift();
      sessionStorage.setItem('crSubFix_trace', JSON.stringify(arr));
    } catch (_) {}
  }
})();
