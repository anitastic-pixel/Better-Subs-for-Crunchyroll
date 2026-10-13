/**
 * lib/sub-suppression.js — hides Crunchyroll's own subtitle renderer while our
 * overlay is active.
 *
 * Crunchyroll renders subtitles through its own JS renderer (not the browser's
 * native TextTrack API), so setting track.mode = 'disabled' alone is not enough.
 * Suppression is a four-layer strategy:
 *   1. Disable all TextTrack objects (native API), kept disabled via the
 *      TextTrackList 'change'/'addtrack' events so CR re-enabling a track is
 *      reverted the instant it happens (native cues are the one thing CSS
 *      can't reach — they render in the video's UA shadow DOM)
 *   2. Inject a <style> with broad class-pattern selectors (CSS layer)
 *   3. DOM-level visibility:hidden on the found container (strongest)
 *   4. Poll as a backstop to re-apply if anything slips through (300 ms
 *      until the CSS layer is in place, 2 s after)
 *
 * All bitmovin-race handling, observer + poll lifecycle, track-mode save/restore,
 * and CSS injection live behind this seam — callers don't need to know any of it.
 *
 * Public surface:
 *   const s = CRSubFix.createSubSuppression({ overlayId })
 *   s.activate(videoEl)   — start suppressing native subs for this video
 *   s.deactivate()        — restore native subs and tear down observers/poll
 *   s.isActive()          — boolean
 *   s._suppressId         — the injected <style> id (for a caller's defensive sweep)
 *   s.buildSuppressCSS()  — the injected stylesheet text (exposed for tests)
 *
 * overlayId is our own overlay's element id, excluded from every suppression
 * selector so we never hide ourselves.
 */
(function () {
  'use strict';

  function createSubSuppression({ overlayId }) {
    const SUPPRESS_ID = 'cr-sub-fix-suppress';

    let active          = false;
    let video           = null;
    let savedTrackModes = [];
    let savedCRSubEl    = null;
    let pollTimer       = null;
    let observer        = null;
    let onTrackChange   = null;   // TextTrackList listeners bound to the active video
    let onTrackAdd      = null;

    // Broad class patterns for CR's subtitle container.  Each excludes our own
    // overlay and asbplayer's (its "asbplayer-subtitles-container-bottom"
    // matches the subtitle+container pattern — users pair it with hide-official).
    const SUB_SELECTORS = [
      '[class*="subtitle"][class*="container"]', '[class*="subtitle"][class*="render"]',
      '[class*="subtitle"][class*="wrapper"]',   '[class*="subtitle"][class*="display"]',
      '[class*="Subtitle"]',                     '[class*="subtitles--"]',
      '[class*="player-subtitles"]',             '[class*="CaptionRenderer"]',
      '[class*="caption"][class*="container"]',  '[data-testid*="subtitle"]',
      '[data-testid*="caption"]',                '[class*="vilos"]',
    ].map(s => `${s}:not(#${overlayId}):not([class*="asbplayer"])`);

    function buildSuppressCSS() {
      const patterns = [`.bitmovinplayer-container > div:not([class]):not([id])`, ...SUB_SELECTORS];
      return patterns.join(',\n') + ' { visibility: hidden !important; }';
    }

    function injectCSS() {
      if (document.getElementById(SUPPRESS_ID)) return;
      const s = document.createElement('style');
      s.id = SUPPRESS_ID;
      s.textContent = buildSuppressCSS();
      document.head.appendChild(s);
    }

    function findCRSubContainer() {
      const bitmovin = document.querySelector('.bitmovinplayer-container > div:not([class]):not([id])');
      if (bitmovin) return bitmovin;

      const root = video?.closest('[class*="player"]') ?? video?.parentElement;
      if (!root) return null;
      // One tree scan instead of one per selector, but keep the selector-order
      // priority (document order could pick an outer wrapper that contains
      // our overlay): the first element matching the earliest selector wins.
      const hits = root.querySelectorAll(SUB_SELECTORS.join(','));
      for (const sel of SUB_SELECTORS) {
        for (const el of hits) if (el.matches(sel)) return el;
      }
      return null;
    }

    // Save a track's pre-suppression mode once (so deactivate can restore it),
    // then force it disabled.  Re-disabling an already-disabled track is skipped
    // so our own write never fires a redundant 'change' event.
    function rememberAndDisable(track) {
      if (!savedTrackModes.some(s => s.track === track)) {
        savedTrackModes.push({ track, mode: track.mode });
      }
      if (track.mode !== 'disabled') track.mode = 'disabled';
    }

    function disableAllTracks() {
      for (const track of video?.textTracks ?? []) rememberAndDisable(track);
    }

    function applyOnce() {
      disableAllTracks();
      const found = findCRSubContainer();
      if (found) {
        savedCRSubEl = found;
        found.style.setProperty('visibility', 'hidden', 'important');
      } else if (savedCRSubEl && savedCRSubEl.isConnected) {
        savedCRSubEl.style.setProperty('visibility', 'hidden', 'important');
      }
    }

    function startObserver() {
      if (observer) return;
      const container = document.querySelector('.bitmovinplayer-container');
      if (!container) return;
      observer = new MutationObserver(() => { if (active) applyOnce(); });
      observer.observe(container, { childList: true });
    }

    function activate(videoEl) {
      if (active || !videoEl) return;
      active = true;
      video  = videoEl;
      savedTrackModes = [];
      disableAllTracks();
      // Event-driven disabling closes the window between Crunchyroll
      // re-enabling a native track (stream (re)start, quality change, seek) and
      // the next poll: 'change' fires the instant a mode flips, 'addtrack' catches
      // tracks created after activation.  The poll below stays as a backstop.
      onTrackChange = () => { if (active) disableAllTracks(); };
      onTrackAdd    = (e) => { if (active && e.track) rememberAndDisable(e.track); };
      try {
        video.textTracks.addEventListener('change',   onTrackChange);
        video.textTracks.addEventListener('addtrack', onTrackAdd);
      } catch (_) {}
      injectCSS();
      applyOnce();
      startObserver();
      clearTimeout(pollTimer);
      const tick = () => {
        if (!active) { pollTimer = null; return; }
        // If the player container wasn't in the DOM at activate() time, the
        // event-driven observer never attached — retry here (self-guards on the
        // existing observer) so we don't fall back to poll-only forever.
        startObserver();
        const hadCSS = !!document.getElementById(SUPPRESS_ID);
        if (!hadCSS) injectCSS();
        applyOnce();
        // The CSS layer already hides every container this poll can find, so
        // once it's in place the poll is only a slow backstop.
        pollTimer = setTimeout(tick, hadCSS ? 2000 : 300);
      };
      pollTimer = setTimeout(tick, 300);
    }

    function deactivate() {
      active = false;
      clearTimeout(pollTimer);
      pollTimer = null;
      observer?.disconnect();
      observer = null;
      // Detach track listeners before restoring modes, so our restore writes
      // don't bounce back through the 'change' handler.
      if (video && onTrackChange) {
        try {
          video.textTracks.removeEventListener('change',   onTrackChange);
          video.textTracks.removeEventListener('addtrack', onTrackAdd);
        } catch (_) {}
      }
      onTrackChange = onTrackAdd = null;
      document.getElementById(SUPPRESS_ID)?.remove();
      for (const { track, mode } of savedTrackModes) {
        try { track.mode = mode; } catch (_) {}
      }
      savedTrackModes = [];
      document.querySelectorAll('.bitmovinplayer-container > div:not([class]):not([id])')
        .forEach(el => el.style.removeProperty('visibility'));
      if (savedCRSubEl) {
        savedCRSubEl.style.removeProperty('visibility');
        savedCRSubEl = null;
      }
      video = null;
    }

    return {
      activate,
      deactivate,
      isActive: () => active,
      _suppressId: SUPPRESS_ID,  // exposed for the caller's defensive teardown sweep
      buildSuppressCSS,
    };
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.createSubSuppression = createSubSuppression;
})();
