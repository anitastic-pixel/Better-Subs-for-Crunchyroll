/**
 * content.js — isolated world (has Chrome API access).
 *
 * Bridges chrome.storage settings → <html> data attributes readable by
 * interceptor.js (MAIN world) via the shared schema in lib/settings-schema.js.
 * Also relays messages between popup/background and interceptor.js.
 *
 * Status attributes read here (written by interceptor.js):
 *   data-cr-jp-status   "none"|"ready"|"active"|"error"|"unavailable"
 *   data-cr-jp-active   "true" | "false"
 */

(function () {
  'use strict';

  // Diagnostic: log bail reason so we can see why content.js stops in DevTools.
  if (!self.CRSubFix) {
    console.warn('[CR Sub Fix] content.js bail: self.CRSubFix is undefined');
    return;
  }
  if (!self.CRSubFix.settings) {
    console.warn('[CR Sub Fix] content.js bail: CRSubFix.settings missing. Keys:', Object.keys(self.CRSubFix));
    return;
  }
  if (!self.CRSubFix.protocol) {
    console.warn('[CR Sub Fix] content.js bail: CRSubFix.protocol missing. Keys:', Object.keys(self.CRSubFix));
    return;
  }

  const SETTINGS = self.CRSubFix.settings;
  const { ATTR, STATUS, MSG, POST } = self.CRSubFix.protocol;

  // CR's framework strips our custom data-* attribute off <html> during
  // hydration, which would null the toggle token and make us reject every
  // cross-world message (signs, MT RPC, toggle).  Cache the last non-null value
  // so a transient strip can't break validation — there is only ever one token
  // per page load, and a fresh load re-runs this script, so the cache can't go
  // stale across episodes.
  let cachedToggleToken = null;
  function toggleToken() {
    const t = document.documentElement.getAttribute(ATTR.TOGGLE_TOKEN);
    if (t) cachedToggleToken = t;
    return cachedToggleToken;
  }

  // Cache the latest settings so the restore observer can re-apply them
  // without going back to chrome.storage on every wipe.
  let latestSettings     = SETTINGS.defaults();
  let latestMtConfigured = false;
  let lastSignStyleKey   = null;   // signature of all sign-style overrides (libass live re-render)

  function applySettings(s) {
    latestSettings = s;
    SETTINGS.writeAttrs(document.documentElement, s);
    // Re-init libass when ANY sign style override changes so the new look applies
    // live (the CSS dialogue style is handled by the renderer via writeAttrs).
    const key = [s.sign_styleOverride, s.sign_overrideFontFamily, s.sign_overrideTextColor,
                 s.sign_overrideTextOpacity, s.sign_overrideOutlineColor, s.sign_overrideBord,
                 s.sign_overrideShad, s.sign_overrideShadOpacity, s.sign_overrideBgBox,
                 s.sign_overrideBgColor, s.sign_overrideBgOpacity, s.sign_overrideBgPaddingX,
                 s.sign_overrideBgPaddingY, s.sign_forceColor, s.sign_textScale].join('|');
    if (lastSignStyleKey !== null && key !== lastSignStyleKey) refreshOctopusStyle();
    lastSignStyleKey = key;
  }

  // Mirror only a DERIVED boolean of "is an MT key stored" into the page — never
  // the key itself, which a page script could read off the DOM.  The key stays
  // in chrome.storage and is read only by the service worker.
  function writeMtConfigured() {
    document.documentElement.setAttribute(ATTR.MT_CONFIGURED, latestMtConfigured ? 'true' : 'false');
  }
  function refreshMtConfigured() {
    chrome.storage.local.get('mtApiKey', (o) => {
      latestMtConfigured = !!(o && o.mtApiKey);
      writeMtConfigured();
    });
  }

  chrome.storage.local.get(SETTINGS.defaults(), applySettings);
  refreshMtConfigured();

  // Keep in sync with popup changes in real time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get(SETTINGS.defaults(), applySettings);
    if ('mtApiKey' in changes) refreshMtConfigured();
  });

  // Crunchyroll's React hydration recovery (errors #418 / #423 in the
  // console before each SPA nav) removes the data-* attributes we write
  // on <html>.  Without this restore observer, the interceptor reads
  // every setting as its default (autoActivate=false) after the first
  // SPA nav, which is why auto-activate only worked on initial page load.
  //
  // Watch our attrs for removal (getAttribute returns null when the attr
  // has been deleted) and re-apply the cached bundle in a microtask.  The
  // microtask flag coalesces bursts so we re-write at most once per task.
  let reapplyScheduled = false;
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (document.documentElement.getAttribute(m.attributeName) !== null) continue;
      if (reapplyScheduled) return;
      reapplyScheduled = true;
      queueMicrotask(() => {
        reapplyScheduled = false;
        SETTINGS.writeAttrs(document.documentElement, latestSettings);
        writeMtConfigured();
      });
      return;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: SETTINGS.ATTRS.concat([ATTR.MT_CONFIGURED]),
  });

  // ── MAIN-world RPC relay ───────────────────────────────────────────────────
  // The interceptor (MAIN world) can't address the service worker directly, so
  // it posts token-guarded RPC requests here; we forward to the SW and post the
  // result back.  Token + same-window check reject unrelated/forged messages
  // (the guarded action — spending the user's own translation quota — is low
  // stakes, matching the toggle token's threat model).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== POST.RPC_REQ) return;
    const token = toggleToken();
    if (!token || data.token !== token) return;
    const reply = (body) =>
      window.postMessage({ type: POST.RPC_RES, id: data.id, ...body }, window.location.origin);
    if (data.method === 'translate') {
      try {
        chrome.runtime.sendMessage({ type: MSG.MT_TRANSLATE, payload: data.payload }, (res) => {
          const err = chrome.runtime.lastError;
          reply({
            ok:           !err && !!(res && res.ok),
            translations: res && res.translations,
            error:        err ? err.message : (res && res.ok ? null : res && res.error),
          });
        });
      } catch (e) {
        reply({ ok: false, error: String(e && e.message) });
      }
    } else {
      reply({ ok: false, error: 'unknown-method' });
    }
  });

  // ── libass (SubtitlesOctopus) sign renderer ────────────────────────────────
  // The MAIN world posts a "signs-only" .ass (the \pos typeset cues) here; we
  // render it with REAL libass (wasm) so the 3-D typeset matches CR's own
  // server-side libass exactly.  Dialogue stays on the MAIN world's CSS overlay.
  // Runs in the isolated world so the worker + wasm load from extension URLs.
  let octopus = null, octopusAss = null, octopusVideo = null, octopusSeq = 0, octopusBlobUrl = null;
  let octopusFontKey = null;   // JSON of the font opts the live octopus was built with

  // Verbose logs only when crSubFixDebug.on() set the shared debug flag.
  const dlog = (() => {
    let dbg = false; try { dbg = localStorage.getItem('crSubFix_debug') === '1'; } catch (_) {}
    return dbg ? (...a) => console.info(...a) : () => {};
  })();
  // libass reads fonts off its virtual FS, so it can only use the TTFs we bundle
  // (Tinos ≈ Times New Roman / serif, Arimo ≈ Arial / sans, Cousine ≈ Courier /
  // mono).  All must be TTF/OTF — FreeType can't parse woff2.
  const FONT_URL   = (f) => chrome.runtime.getURL('lib/octopus/' + f);
  const FONT_TIMES = () => FONT_URL('Tinos-Regular.ttf');
  const FONT_SANS  = () => FONT_URL('Arimo.ttf');
  const FONT_MONO  = () => FONT_URL('Cousine-Regular.ttf');
  // CJK sign layers are routed to the CSS overlay (system fonts) by interceptor.js
  // — libass never receives them here — so no CJK font is bundled.
  // "Original" path: map the .ass's own font names to bundled equivalents so
  // signs keep CR's serif/sans intent; unmatched names fall back to Tinos.
  const AVAILABLE_FONTS = () => ({
    'times new roman': FONT_TIMES(), 'times': FONT_TIMES(), 'serif': FONT_TIMES(),
    'arial': FONT_SANS(), 'helvetica': FONT_SANS(), 'verdana': FONT_SANS(),
    'trebuchet ms': FONT_SANS(), 'tahoma': FONT_SANS(), 'sans-serif': FONT_SANS(),
    'courier new': FONT_MONO(), 'courier': FONT_MONO(), 'monospace': FONT_MONO(),
  });
  // Resolve the user's chosen sign font (a CSS family string from the popup's
  // fixed <select>) to a bundled TTF, by serif / mono / sans bucket.
  function signFontFileUrl(cssFont) {
    const n = (cssFont || '').toLowerCase();
    if (/courier|mono/.test(n))         return FONT_MONO();
    if (/sans/.test(n))                 return FONT_SANS();   // Arial/Trebuchet/Verdana/Impact list "sans-serif"
    if (/times|georgia|serif/.test(n))  return FONT_TIMES();
    return FONT_SANS();
  }
  // libass font options from the current sign style profile.  When the user has
  // picked a sign font (sign_styleOverride + sign_overrideFontFamily), force
  // EVERY sign into that one face (omit availableFonts → all use fallbackFont);
  // otherwise keep the "Original" per-name mapping that matches CR.
  function octopusFontOpts() {
    const s = latestSettings || {};
    if (s.sign_styleOverride && s.sign_overrideFontFamily) {
      return { fallbackFont: signFontFileUrl(s.sign_overrideFontFamily) };
    }
    return { fallbackFont: FONT_TIMES(), availableFonts: AVAILABLE_FONTS() };
  }

  // CSS #rrggbb + 0-100 opacity → ASS &HAABBGGRR (alpha inverted: 00=opaque).
  function assColor(hex, opacityPct) {
    const h = String(hex || '#ffffff').replace(/[^0-9a-fA-F]/g, '').padStart(6, '0').slice(-6);
    const aa = Math.round((1 - (opacityPct == null ? 100 : Number(opacityPct)) / 100) * 255)
                 .toString(16).padStart(2, '0');
    return ('&H' + aa + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase();
  }

  // Apply the sign style profile to libass by rewriting the [V4+ Styles] before
  // feeding the .ass.  Two independent paths: sign_textScale always multiplies the
  // Style Fontsize (resize without the override); the colour / outline / shadow /
  // box fields apply only when sign_styleOverride is on.  Outline, shadow and box
  // apply to every sign; text colour wins except on signs that animate their own
  // colour via \t (those keep CR's typeset colour unless Force colour is set).
  // No-op only when scale === 1 AND the override is off.
  function styleSignsAss(ass) {
    const s = latestSettings || {};
    if (!ass) return ass;
    const scale    = Number(s.sign_textScale) || 1;   // independent of the override
    const override = !!s.sign_styleOverride;
    if (scale === 1 && !override) return ass;
    const box  = override && !!s.sign_overrideBgBox;
    const padX = Math.max(0, +s.sign_overrideBgPaddingX || 0);
    const padY = Math.max(0, +s.sign_overrideBgPaddingY || 0);
    const prim = assColor(s.sign_overrideTextColor, s.sign_overrideTextOpacity);
    // BorderStyle 3 (opaque box) fills the box with OutlineColour.  Its single
    // Outline field is UNIFORM, so independent X/Y padding is injected per line
    // below via libass \xbord/\ybord (this Style value is just a fallback).
    const outl = box ? assColor(s.sign_overrideBgColor, s.sign_overrideBgOpacity)
                     : assColor(s.sign_overrideOutlineColor, 100);
    const back = assColor('#000000', s.sign_overrideShadOpacity);   // shadow colour
    const bord = box ? Math.max(padX, padY) : s.sign_overrideBord;
    const shad  = box ? 0 : s.sign_overrideShad;
    const force = override && !!s.sign_forceColor;   // strip \t/\c so the override text colour wins
    const padTag = box ? `{\\xbord${padX}\\ybord${padY}}` : '';   // independent box padding
    const lines = ass.split('\n');
    let fmt = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fmt === null && /^Format\s*:/i.test(line) && /PrimaryColour/i.test(line)) {
        fmt = {};
        line.slice(line.indexOf(':') + 1).split(',').forEach((n, idx) => { fmt[n.trim().toLowerCase()] = idx; });
        continue;
      }
      if (fmt && /^Style\s*:/i.test(line)) {
        const vals = line.slice(line.indexOf(':') + 1).split(',');
        const set = (n, v) => { const k = fmt[n]; if (k != null && k < vals.length) vals[k] = String(v); };
        if (scale !== 1 && fmt['fontsize'] != null && fmt['fontsize'] < vals.length) {
          vals[fmt['fontsize']] = String(+((parseFloat(vals[fmt['fontsize']]) || 0) * scale).toFixed(2));
        }
        if (override) {
          set('primarycolour', prim);
          set('outlinecolour', outl);
          set('backcolour',    back);
          set('outline',       bord);
          set('shadow',        shad);
          set('borderstyle',   box ? 3 : 1);
        }
        lines[i] = 'Style:' + vals.join(',');
      } else if ((force || box || scale !== 1) && /^Dialogue\s*:/i.test(line)) {
        let l = line;
        // Scale inline \fs too: typeset signs usually set their own size (which
        // OVERRIDES the Style Fontsize), so scaling the Style alone leaves them
        // unchanged.  \fscx/\fscy ride on \fs, so this resizes them proportionally.
        if (scale !== 1) l = l.replace(/\\fs(\d+(?:\.\d+)?)/g, (_, n) => '\\fs' + +(parseFloat(n) * scale).toFixed(2));
        // Force-colour: drop the sign's own primary colour so the override wins
        // (\t(...) colour/transform animations + static \c / \1c).
        if (force) l = l.replace(/\\t\([^)]*\)/g, '').replace(/\\1?c&H[0-9a-fA-F]+&/gi, '');
        // Independent box padding: prepend \xbord/\ybord to the Text field (the
        // 10th comma-separated field — Text is the only one that can hold commas).
        if (box) { const m = l.match(/^(Dialogue\s*:(?:[^,]*,){9})(.*)$/i); if (m) l = m[1] + padTag + m[2]; }
        lines[i] = l;
      }
    }
    return lines.join('\n');
  }

  function destroyOctopus() {
    if (octopus) { try { octopus.dispose(); } catch (_) {} }
    octopus = null; octopusAss = null; octopusVideo = null;
  }

  // Re-apply the sign style on any popup change.  Colour/outline/box live in the
  // .ass, so re-feed via setTrack (no worker rebuild → no resize race, no flicker);
  // only a FONT change needs a full rebuild (fallbackFont is fixed at construction).
  function refreshOctopusStyle() {
    if (!octopus || !octopusAss) return;
    const ass = octopusAss;
    if (JSON.stringify(octopusFontOpts()) !== octopusFontKey) { destroyOctopus(); setOctopusAss(ass); return; }
    try {
      octopus.setTrack(styleSignsAss(ass));
      // setTrack only queues the new .ass to the worker; libass repaints only on
      // a video time change — so nudge it to render NOW, otherwise the signs don't
      // update until the next scrub/play (i.e. nothing happens while paused).
      // octopusVideo can be null during a teardown race; fall back to the live
      // element so the repaint nudge (the whole point of this line) still fires.
      const vEl = octopusVideo || document.querySelector('video');
      try { if (vEl) octopus.setCurrentTime(vEl.currentTime); } catch (_) {}
    } catch (_) { destroyOctopus(); setOctopusAss(ass); }
  }

  // A chrome-extension worker URL is cross-origin to the page, so new Worker()
  // is refused with a SecurityError.  Wrap the worker in a SAME-ORIGIN blob and
  // inject a Module.locateFile (the Emscripten worker honours a pre-set Module)
  // so it still loads the .wasm from the web-accessible extension URL.  The blob
  // worker runs at the page's origin, so its fetch of the extension .wasm is
  // permitted by web_accessible_resources.
  async function octopusWorkerUrl() {
    if (octopusBlobUrl) return octopusBlobUrl;
    const workerSrc = chrome.runtime.getURL('lib/octopus/subtitles-octopus-worker.js');
    const wasmUrl   = chrome.runtime.getURL('lib/octopus/subtitles-octopus-worker.wasm');
    const text = await (await fetch(workerSrc)).text();
    const head = 'var Module={locateFile:function(p){return /\\.wasm$/.test(p)?' + JSON.stringify(wasmUrl) + ':p}};\n';
    octopusBlobUrl = URL.createObjectURL(new Blob([head + text], { type: 'application/javascript' }));
    return octopusBlobUrl;
  }

  // True only while our extension context is alive.  After the extension is
  // reloaded or updated, the content script in an already-open tab keeps running
  // but every chrome.* call (including getURL) throws "Extension context
  // invalidated".  libass init pulls its worker/wasm/fonts via getURL, so we
  // guard that whole path and fail quietly — reloading the page re-injects a
  // fresh content script.  This is benign lifecycle, NOT a bug worth reporting.
  function extensionAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }
  const isCtxDead = (e) => /context invalidated/i.test(String((e && e.message) || e));

  async function setOctopusAss(ass) {
    const seq = ++octopusSeq;
    const SO = self.SubtitlesOctopus || (typeof SubtitlesOctopus !== 'undefined' ? SubtitlesOctopus : null);
    const video = document.querySelector('video');
    if (!ass) { destroyOctopus(); return; }
    if (!extensionAlive()) return;   // extension reloaded under an open tab — getURL is dead; a page reload fixes it
    if (!SO)    { console.warn('[CR Sub Fix] SubtitlesOctopus not loaded — signs fall back to CSS'); return; }
    if (!video) { console.warn('[CR Sub Fix] no <video> for libass yet'); return; }
    if (octopus && octopusAss === ass && octopusVideo === video) return;       // unchanged
    if (octopus && octopusVideo === video) {                                   // same video, new track
      // Same font set → just re-feed the track; only a sign-FONT change (the
      // user's chosen sign font) needs a full rebuild — fallbackFont is fixed
      // at construction.
      if (JSON.stringify(octopusFontOpts()) === octopusFontKey) {
        try { octopus.setTrack(styleSignsAss(ass)); octopusAss = ass; return; } catch (_) { destroyOctopus(); }
      } else {
        destroyOctopus();
      }
    }
    let workerUrl;
    try { workerUrl = await octopusWorkerUrl(); }
    catch (e) { if (!isCtxDead(e)) console.warn('[CR Sub Fix] octopus worker load failed', e); return; }
    if (seq !== octopusSeq) return;                                           // superseded while awaiting
    const v = document.querySelector('video');
    if (!ass || !v) { destroyOctopus(); return; }
    destroyOctopus();
    octopusVideo = v; octopusAss = ass;
    try {
      dlog('[CR Sub Fix] starting libass (' + ass.length + ' chars of signs)…');
      const fontOpts = octopusFontOpts();
      octopusFontKey = JSON.stringify(fontOpts);
      octopus = new SO({
        video: v,
        subContent: styleSignsAss(ass),   // applies the sign colour/outline/box override
        workerUrl,
        ...fontOpts,            // fallbackFont (+ availableFonts for the "Original" mapping)
        onError: (e) => console.warn('[CR Sub Fix] octopus error', e),
        // Ignore the ready callback if a newer push has already superseded this
        // build — otherwise a stale instance nudges a frame it no longer owns.
        onReady: () => { if (seq !== octopusSeq) return; dlog('[CR Sub Fix] libass ready ✓'); try { octopus && octopus.setCurrentTime(v.currentTime); } catch (_) {} },
      });
    } catch (e) {
      if (!isCtxDead(e)) console.warn('[CR Sub Fix] octopus init failed', e);
      octopus = null; octopusAss = null; octopusVideo = null;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== POST.SIGN_ASS) return;
    const token = toggleToken();
    if (!token || data.token !== token) { console.warn('[CR Sub Fix] sign msg rejected — token mismatch'); return; }
    dlog('[CR Sub Fix] sign layer ←', data.ass ? (data.ass.length + ' chars') : 'cleared');
    setOctopusAss(data.ass || null);   // async; fire-and-forget
  });

  // ── Message relay ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Keyboard shortcut from background → forward to MAIN world
    if (msg.type === MSG.TOGGLE_JP_CC) {
      const token = toggleToken();
      window.postMessage({ type: POST.CR_SUB_TOGGLE, token }, window.location.origin);
      return;
    }

    // Status query from popup → read DOM attributes set by interceptor.js
    if (msg.type === MSG.GET_STATUS) {
      let activeInfo = null;
      try {
        const raw = document.documentElement.getAttribute(ATTR.ACTIVE_INFO);
        if (raw) activeInfo = JSON.parse(raw);
      } catch (_) {}
      sendResponse({
        jpStatus:   document.documentElement.getAttribute(ATTR.JP_STATUS) ?? STATUS.NONE,
        jpActive:   document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true',
        activeInfo,
      });
      return true; // keep sendResponse channel open
    }

    // Diagnostics bundle for the popup's "Report an issue".  Assembled here in
    // the isolated world, which shares the page's sessionStorage + DOM with the
    // interceptor.  The trace is redacted of signed CDN tokens before it leaves —
    // the bundle ends up in a public GitHub issue.
    if (msg.type === MSG.GET_DIAG) {
      let trace = '';
      try { trace = JSON.parse(sessionStorage.getItem('crSubFix_trace') || '[]').join('\n'); } catch (_) {}
      trace = trace
        .replace(/(https?:\/\/[^\s|?]+)\?[^\s|]*/gi, '$1?<redacted>')   // strip signed-URL query
        .replace(/[^\s@|]+@[^\s@|]+\.[^\s@|]+/g, '<email>')             // emails
        .replace(/\b[0-9a-f]{32,}\b/gi, '<id>');                        // long hex (tokens/ids)
      if (trace.length > 5000) trace = '…(older trimmed)\n' + trace.slice(-5000);  // keep most recent
      let activeInfo = null;
      try {
        const raw = document.documentElement.getAttribute(ATTR.ACTIVE_INFO);
        if (raw) activeInfo = JSON.parse(raw);
      } catch (_) {}
      let settings = {};
      try { settings = SETTINGS.readAll(document.documentElement); } catch (_) {}
      sendResponse({
        url:          location.href,
        jpStatus:     document.documentElement.getAttribute(ATTR.JP_STATUS) ?? STATUS.NONE,
        jpActive:     document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true',
        mtConfigured: document.documentElement.getAttribute(ATTR.MT_CONFIGURED) ?? '-',
        activeInfo,
        settings,
        trace,
      });
      return true; // async sendResponse
    }
  });

  // ── Badge relay ──────────────────────────────────────────────────────────
  // Watch interceptor.js-controlled attribute and notify background to update badge
  new MutationObserver(() => {
    const active = document.documentElement.getAttribute(ATTR.JP_ACTIVE) === 'true';
    try { chrome.runtime.sendMessage({ type: MSG.SET_BADGE, active }).catch(() => {}); } catch (_) {}
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR.JP_ACTIVE],
  });

  // ── Version stash for error reports ────────────────────────────────────────
  // The MAIN world (interceptor.js) builds + sends the error report but has no
  // chrome.runtime, so it can't read the manifest version.  Stash it in
  // sessionStorage — shared across worlds, survives Crunchyroll's DOM churn — for
  // it to read.
  try { sessionStorage.setItem('crSubFix_version', chrome.runtime.getManifest().version); } catch (_) {}
})();
